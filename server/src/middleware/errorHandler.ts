import type { NextFunction, Request, Response } from "express";
import type { ApiError } from "../types/api";
import { HttpError } from "../errors/HttpError";

/** 404 handler for unmatched routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  const body: ApiError = { error: { message: "Not found", code: "NOT_FOUND" } };
  res.status(404).json(body);
}

/**
 * Centralized error handler. Must keep the 4-argument signature so Express
 * recognizes it as an error-handling middleware.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    const body: ApiError = { error: { message: err.message, code: err.code } };
    res.status(err.status).json(body);
    return;
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  // eslint-disable-next-line no-console
  console.error("[error]", err);
  const body: ApiError = { error: { message, code: "INTERNAL_ERROR" } };
  res.status(500).json(body);
}
