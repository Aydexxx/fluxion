import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import type { ApiError } from "../types/api";

function sendValidationError(res: Response, message: string): void {
  const body: ApiError = { error: { message, code: "VALIDATION_ERROR" } };
  res.status(400).json(body);
}

/** Validates `req.body` against a zod schema, replacing it with the parsed data on success. */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendValidationError(res, result.error.issues.map((issue) => issue.message).join("; "));
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validates `req.query` against a zod schema.
 *
 * Unlike `validateBody`, this does not write the parsed result back onto
 * the request: Express 5 defines `req.query` as a read-only getter
 * recomputed from `req.url`, so it can't be reassigned. Downstream code
 * reads `req.query` as-is (already validated by this middleware).
 */
export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      sendValidationError(res, result.error.issues.map((issue) => issue.message).join("; "));
      return;
    }
    next();
  };
}
