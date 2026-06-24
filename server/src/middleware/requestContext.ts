import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger, type Logger } from "../config/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id for this request (echoed as `x-request-id`). */
      id: string;
      /** Request-scoped child logger carrying the correlation id. */
      log: Logger;
    }
  }
}

/**
 * Assigns each request a correlation id (honoring an inbound `x-request-id`, or
 * minting one), exposes a request-scoped child logger as `req.log`, echoes the
 * id back on the response, and logs one structured line per completed request.
 * Downstream handlers and the error handler tag their logs with the same id, so
 * a single request's activity can be stitched together end to end.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const headerId = req.headers["x-request-id"];
  const id = (typeof headerId === "string" && headerId) || randomUUID();
  req.id = id;
  req.log = logger.child({ reqId: id });
  res.setHeader("x-request-id", id);

  const start = Date.now();
  res.on("finish", () => {
    req.log.info(
      { method: req.method, url: req.originalUrl, status: res.statusCode, ms: Date.now() - start },
      "request.completed",
    );
  });

  next();
}
