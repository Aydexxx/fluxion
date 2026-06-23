import IORedis, { type Redis, type RedisOptions } from "ioredis";
import { env } from "../config/env";

/**
 * Creates an ioredis connection for BullMQ. `maxRetriesPerRequest: null` is
 * required by BullMQ's blocking commands; without it the worker's long-poll
 * `BRPOPLPUSH` would error out.
 */
export function createRedisConnection(overrides: RedisOptions = {}): Redis {
  return new IORedis(env.redisUrl, { maxRetriesPerRequest: null, ...overrides });
}
