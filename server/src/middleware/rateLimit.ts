import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";
import type { ApiError } from "../types/api";

/**
 * Builds an in-memory fixed-window rate limiter that responds with the app's
 * standard `{ error: { message, code } }` envelope (HTTP 429) instead of the
 * library default, so clients parse throttling like any other API error.
 * Keyed per client IP. Used to protect abuse-prone surfaces — auth and the
 * public webhook endpoint.
 */
export function createRateLimiter(opts: { windowMs: number; max: number; message?: string }): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const body: ApiError = {
        error: { message: opts.message ?? "Too many requests, please try again later", code: "RATE_LIMITED" },
      };
      res.status(429).json(body);
    },
  });
}
