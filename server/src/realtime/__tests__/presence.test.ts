import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Server as IOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import {
  GRAPH_APPLY,
  PRESENCE_EDITING,
  PRESENCE_JOIN,
  PRESENCE_JOINED,
  PRESENCE_LEFT,
  PRESENCE_SELECTION,
  PRESENCE_SYNC,
  registerPresenceHandlers,
  type PresenceDeps,
} from "../presence";

/**
 * Exercises the presence contract end-to-end over real sockets, but with an
 * in-memory Socket.IO server and stubbed deps — so it needs neither Redis nor
 * Postgres and stays fast and deterministic.
 */

const WORKFLOW = "wf_1";

const allowAll: PresenceDeps = {
  authorize: async () => true,
  resolveIdentity: async (userId) => ({ name: `User ${userId}`, avatarUrl: null }),
};

let httpServer: HttpServer;
let io: IOServer;
let port: number;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  httpServer = createServer();
  io = new IOServer(httpServer);
  // Trust a userId passed in the handshake (the real server verifies a JWT).
  io.use((socket, next) => {
    const userId = socket.handshake.auth?.userId as string | undefined;
    if (!userId) return next(new Error("no user"));
    (socket.data as { userId: string }).userId = userId;
    next();
  });
  io.on("connection", (socket) => registerPresenceHandlers(io, socket, allowAll));
  await new Promise<void>((resolve) => httpServer.listen(() => resolve()));
  port = (httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

/** Connect a client as `userId` and resolve once connected. */
async function connect(userId: string): Promise<ClientSocket> {
  const socket = ioClient(`http://localhost:${port}`, { auth: { userId }, transports: ["websocket"] });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", reject);
  });
  return socket;
}

/** Resolve with the next payload for `event`, or reject after `ms`. */
function next<T = unknown>(socket: ClientSocket, event: string, ms = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("presence join/leave", () => {
  it("announces a joiner to existing room members", async () => {
    const a = await connect("alice");
    a.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });
    await next(a, PRESENCE_SYNC); // alice is in the room

    const b = await connect("bob");
    const joined = next<{ participant: { userId: string; name: string; color: string } }>(a, PRESENCE_JOINED);
    b.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });

    const payload = await joined;
    expect(payload.participant.userId).toBe("bob");
    expect(payload.participant.name).toBe("User bob");
    expect(payload.participant.color).toMatch(/^#/);
  });

  it("hands a joiner the existing roster via sync", async () => {
    const a = await connect("alice");
    a.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });
    await next(a, PRESENCE_SYNC);

    const b = await connect("bob");
    const sync = next<{ participants: Array<{ userId: string }> }>(b, PRESENCE_SYNC);
    b.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });

    const payload = await sync;
    expect(payload.participants.map((p) => p.userId)).toEqual(["alice"]);
  });

  it("notifies the room when a participant disconnects", async () => {
    const a = await connect("alice");
    a.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });
    await next(a, PRESENCE_SYNC);

    const b = await connect("bob");
    b.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });
    await next(a, PRESENCE_JOINED);

    const left = next<{ userId: string }>(a, PRESENCE_LEFT);
    b.disconnect();
    expect((await left).userId).toBe("bob");
  });

  it("does not leak presence across different workflow rooms", async () => {
    const a = await connect("alice");
    a.emit(PRESENCE_JOIN, { workflowId: "wf_a" });
    await next(a, PRESENCE_SYNC);

    const b = await connect("bob");
    b.emit(PRESENCE_JOIN, { workflowId: "wf_b" });

    // Alice must NOT hear about bob, who is in a different room.
    await expect(next(a, PRESENCE_JOINED, 250)).rejects.toThrow(/timeout/);
  });
});

describe("edit-lock signaling", () => {
  it("relays a node's editing state to other members", async () => {
    const a = await connect("alice");
    a.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });
    await next(a, PRESENCE_SYNC);

    const b = await connect("bob");
    b.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });
    await next(a, PRESENCE_JOINED);

    const editing = next<{ nodeId: string | null; userId: string; name: string }>(a, PRESENCE_EDITING);
    b.emit(PRESENCE_EDITING, { workflowId: WORKFLOW, nodeId: "node_42" });
    const lock = await editing;
    expect(lock).toMatchObject({ nodeId: "node_42", userId: "bob", name: "User bob" });

    const cleared = next<{ nodeId: string | null }>(a, PRESENCE_EDITING);
    b.emit(PRESENCE_EDITING, { workflowId: WORKFLOW, nodeId: null });
    expect((await cleared).nodeId).toBeNull();
  });

  it("includes editing/selection state in the roster a late joiner receives", async () => {
    const a = await connect("alice");
    a.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });
    await next(a, PRESENCE_SYNC);
    a.emit(PRESENCE_SELECTION, { workflowId: WORKFLOW, nodeIds: ["n1", "n2"] });
    a.emit(PRESENCE_EDITING, { workflowId: WORKFLOW, nodeId: "n1" });

    // Small settle so the server records alice's state before bob joins.
    await new Promise((r) => setTimeout(r, 50));

    const b = await connect("bob");
    const sync = next<{ participants: Array<{ userId: string; selection: string[]; editingNodeId: string | null }> }>(
      b,
      PRESENCE_SYNC,
    );
    b.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });

    const roster = (await sync).participants;
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ userId: "alice", selection: ["n1", "n2"], editingNodeId: "n1" });
  });

  it("relays applied graph ops to other members but not the sender", async () => {
    const a = await connect("alice");
    a.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });
    await next(a, PRESENCE_SYNC);

    const b = await connect("bob");
    b.emit(PRESENCE_JOIN, { workflowId: WORKFLOW });
    await next(a, PRESENCE_JOINED);

    const ops = [{ t: "move", positions: [{ id: "n1", x: 10, y: 20 }] }];
    const relayed = next<{ from: string; ops: unknown[] }>(a, GRAPH_APPLY);
    // Sender must not receive its own echo.
    const echo = next(b, GRAPH_APPLY, 250);
    b.emit(GRAPH_APPLY, { workflowId: WORKFLOW, ops });

    expect((await relayed).ops).toEqual(ops);
    await expect(echo).rejects.toThrow(/timeout/);
  });
});
