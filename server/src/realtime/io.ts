import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "../config/env";
import { createRedisConnection } from "../queue/connection";
import { verifyAccessToken } from "../services/jwt";
import { requireWorkspaceMember, resolveWorkflowWorkspaceId } from "../services/authorization";
import { prisma } from "../services/prisma";
import { RUN_SUBSCRIBE, RUN_UNSUBSCRIBE, runRoom } from "./events";
import { registerPresenceHandlers, type PresenceDeps, type SocketData } from "./presence";

/** Real presence dependencies: authorize against workspace membership, resolve names from the DB. */
const presenceDeps: PresenceDeps = {
  authorize: (workflowId, userId) => canAccessWorkflow(workflowId, userId),
  resolveName: async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name ?? "Someone";
  },
};

/**
 * Attaches a Socket.IO server to the API's HTTP server.
 *
 * - Cross-process delivery uses the Redis adapter, so events emitted by the
 *   worker process reach clients connected here.
 * - Handshakes are authenticated with the same JWT as the REST API.
 * - A client subscribes to a run by id; we authorize that the user is a member
 *   of the run's workspace before joining them to the run's room.
 */
export function attachRealtime(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: { origin: env.clientUrl, credentials: true },
  });

  const pub = createRedisConnection();
  const sub = pub.duplicate();
  io.adapter(createAdapter(pub, sub));

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Authentication required"));
    try {
      const { sub: userId } = verifyAccessToken(token);
      (socket.data as SocketData).userId = userId;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    socket.on(RUN_SUBSCRIBE, async (payload: { runId?: string }) => {
      const runId = payload?.runId;
      if (!runId) return;
      if (await canAccessRun(runId, (socket.data as SocketData).userId)) {
        await socket.join(runRoom(runId));
      }
    });

    socket.on(RUN_UNSUBSCRIBE, (payload: { runId?: string }) => {
      if (payload?.runId) void socket.leave(runRoom(payload.runId));
    });

    // Real-time multi-user awareness (live cursors, selection, edit locks, graph sync).
    registerPresenceHandlers(io, socket, presenceDeps);
  });

  return io;
}

async function canAccessRun(runId: string, userId: string): Promise<boolean> {
  try {
    const run = await prisma.workflowRun.findUnique({ where: { id: runId }, select: { workflowId: true } });
    if (!run) return false;
    return await canAccessWorkflow(run.workflowId, userId);
  } catch {
    return false;
  }
}

/** True when `userId` is a member of the workspace that owns `workflowId`. */
async function canAccessWorkflow(workflowId: string, userId: string): Promise<boolean> {
  try {
    const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
    await requireWorkspaceMember(workspaceId, userId);
    return true;
  } catch {
    return false;
  }
}
