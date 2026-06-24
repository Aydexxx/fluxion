import type { NextFunction, Request, Response } from "express";
import type { ApiError } from "../types/api";
import { HttpError } from "../errors/HttpError";
import { logger } from "../config/logger";

/** 404 handler for unmatched routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  const body: ApiError = { error: { message: "Not found", code: "NOT_FOUND" } };
  res.status(404).json(body);
}

/**
 * Centralized error handler. Must keep the 4-argument signature so Express
 * recognizes it as an error-handling middleware.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Expected, client-facing errors carry a safe message + code.
  if (err instanceof HttpError) {
    const body: ApiError = { error: { message: err.message, code: err.code } };
    res.status(err.status).json(body);
    return;
  }

  // Unexpected error: log the full detail server-side (with the correlation id),
  // but never surface the raw message/stack to the client — return a generic 500.
  (req.log ?? logger).error({ err, reqId: req.id }, "unhandled.error");
  const body: ApiError = { error: { message: "Internal server error", code: "INTERNAL_ERROR" } };
  res.status(500).json(body);
}
