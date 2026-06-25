import { Emitter } from "@socket.io/redis-emitter";
import type { Redis } from "ioredis";
import { createRedisConnection } from "../queue/connection";
import type { RunEventSink, RunLogSink } from "../engine/events";
import { RUN_EVENT, RUN_LOG, runRoom } from "./events";

/**
 * Builds the run event + log sinks that publish to the Socket.IO room for a run
 * via the Redis emitter. The worker runs in a separate process from the API's
 * Socket.IO server, so it can't emit directly — the Redis adapter on the API
 * side delivers these to subscribed clients (editor + run detail view).
 */
export function createRunEventEmitter(): { sink: RunEventSink; logSink: RunLogSink; close: () => Promise<void> } {
  const redis: Redis = createRedisConnection();
  const emitter = new Emitter(redis);

  const sink: RunEventSink = (event) => {
    emitter.to(runRoom(event.runId)).emit(RUN_EVENT, event);
  };

  const logSink: RunLogSink = (runId, entry) => {
    emitter.to(runRoom(runId)).emit(RUN_LOG, { runId, entry });
  };

  return {
    sink,
    logSink,
    close: async () => {
      await redis.quit();
    },
  };
}
