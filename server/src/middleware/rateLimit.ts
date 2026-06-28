import rateLimit from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import type { ApiError } from "../types/api";

/**
 * Builds an in-memory fixed-window rate limiter that responds with the app's
 * standard `{ error: { message, code } }` envelope (HTTP 429) instead of the
 * library default, so clients parse throttling like any other API error.
 * Keyed per client IP by default; pass `keyGenerator` to throttle by something
 * else (e.g. the API key id, for per-key public-API limits). Used to protect
 * abuse-prone surfaces — auth, the public webhook endpoint, and `/api/v1`.
 */
export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  message?: string;
  /** Overrides the default per-IP key (return a stable id to throttle per caller). */
  keyGenerator?: (req: Request) => string;
}): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(opts.keyGenerator ? { keyGenerator: opts.keyGenerator } : {}),
    handler: (_req, res) => {
      const body: ApiError = {
        error: { message: opts.message ?? "Too many requests, please try again later", code: "RATE_LIMITED" },
      };
      res.status(429).json(body);
    },
  });
}
