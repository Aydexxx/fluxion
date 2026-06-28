import { Emitter } from "@socket.io/redis-emitter";
import type { Redis } from "ioredis";
import { createRedisConnection } from "../queue/connection";
import { userRoom, type NotificationPublisher } from "./notifications";

/**
 * Builds a {@link NotificationPublisher} that delivers to a user's Socket.IO
 * room via the Redis emitter. Both the API and the worker process construct one
 * and register it with {@link setNotificationPublisher}, so a notification
 * created in either process reaches the user's connected tabs (the Redis adapter
 * on the API side fans it out to the actual sockets).
 */
export function createNotificationEmitter(): { publisher: NotificationPublisher; close: () => Promise<void> } {
  const redis: Redis = createRedisConnection();
  const emitter = new Emitter(redis);

  const publisher: NotificationPublisher = (userId, event, payload) => {
    emitter.to(userRoom(userId)).emit(event, payload);
  };

  return {
    publisher,
    close: async () => {
      await redis.quit();
    },
  };
}
