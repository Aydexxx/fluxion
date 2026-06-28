import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Server as IOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import {
  NOTIFICATION_NEW,
  NOTIFICATION_UNREAD,
  publishNotification,
  setNotificationPublisher,
  userRoom,
} from "../notifications";

/**
 * Exercises the per-user notification channel end-to-end over real sockets with
 * an in-memory Socket.IO server. The notification *bus* (setNotificationPublisher
 * + publishNotification) is wired to emit into the user's room, mirroring how the
 * Redis emitter delivers in production — so this needs neither Redis nor Postgres.
 */

let httpServer: HttpServer;
let io: IOServer;
let port: number;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  httpServer = createServer();
  io = new IOServer(httpServer);
  io.use((socket, next) => {
    const userId = socket.handshake.auth?.userId as string | undefined;
    if (!userId) return next(new Error("no user"));
    (socket.data as { userId: string }).userId = userId;
    next();
  });
  // Mirror the production io.ts: every connection joins its own user room.
  io.on("connection", (socket) => {
    void socket.join(userRoom((socket.data as { userId: string }).userId));
  });

  // Route the notification bus through this in-memory server's user rooms.
  setNotificationPublisher((userId, event, payload) => {
    io.to(userRoom(userId)).emit(event, payload);
  });

  await new Promise<void>((resolve) => httpServer.listen(() => resolve()));
  port = (httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  setNotificationPublisher(() => {});
  for (const c of clients.splice(0)) c.disconnect();
  await io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

async function connect(userId: string): Promise<ClientSocket> {
  const socket = ioClient(`http://localhost:${port}`, { auth: { userId }, transports: ["websocket"] });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", reject);
  });
  return socket;
}

function next<T = unknown>(socket: ClientSocket, event: string, ms = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("per-user notification delivery", () => {
  it("delivers a new notification to its recipient's channel", async () => {
    const alice = await connect("alice");
    // Give the server a tick to process the room join before publishing.
    await new Promise((r) => setTimeout(r, 30));

    const received = next<{ id: string; title: string }>(alice, NOTIFICATION_NEW);
    publishNotification("alice", NOTIFICATION_NEW, { id: "n1", title: "You were invited to Acme" });

    expect((await received).title).toBe("You were invited to Acme");
  });

  it("does not deliver one user's notification to another user", async () => {
    const alice = await connect("alice");
    const bob = await connect("bob");
    await new Promise((r) => setTimeout(r, 30));

    const bobHears = next(bob, NOTIFICATION_NEW, 250);
    publishNotification("alice", NOTIFICATION_NEW, { id: "n1", title: "Private to Alice" });

    await expect(bobHears).rejects.toThrow(/timeout/);
    void alice;
  });

  it("pushes unread-count updates to the user", async () => {
    const alice = await connect("alice");
    await new Promise((r) => setTimeout(r, 30));

    const count = next<{ count: number }>(alice, NOTIFICATION_UNREAD);
    publishNotification("alice", NOTIFICATION_UNREAD, { count: 3 });

    expect((await count).count).toBe(3);
  });
});
