import { Emitter } from "@socket.io/redis-emitter";
import type { Redis } from "ioredis";
import { createRedisConnection } from "../queue/connection";
import type { RunEventSink } from "../engine/events";
import { RUN_EVENT, runRoom } from "./events";

/**
 * Builds a `RunEventSink` that publishes run events to the Socket.IO room for
 * that run via the Redis emitter. The worker runs in a separate process from
 * the API's Socket.IO server, so it can't emit directly — the Redis adapter on
 * the API side delivers these to subscribed editor clients.
 */
export function createRunEventEmitter(): { sink: RunEventSink; close: () => Promise<void> } {
  const redis: Redis = createRedisConnection();
  const emitter = new Emitter(redis);

  const sink: RunEventSink = (event) => {
    emitter.to(runRoom(event.runId)).emit(RUN_EVENT, event);
  };

  return {
    sink,
    close: async () => {
      await redis.quit();
    },
  };
}
