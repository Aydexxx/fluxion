import pino from "pino";
import { env } from "./env";

/**
 * Process-wide structured logger. JSON lines in production (easy to ship to a
 * log aggregator), silent under test. `base: undefined` drops pid/hostname
 * noise; correlation ids (request id, run id) are attached per call site via
 * `logger.child({ ... })` so every line can be traced back to a request or run.
 */
export const logger = pino({
  level: env.log.level,
  base: undefined,
});

export type Logger = typeof logger;
