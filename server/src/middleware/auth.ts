import type { NextFunction, Request, Response } from "express";
import type { ApiError } from "../types/api";
import { verifyAccessToken } from "../services/jwt";
import { prisma } from "../services/prisma";

/** Minimal authenticated-user view attached to the request by `requireAuth`. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function sendUnauthorized(res: Response, message: string): void {
  const body: ApiError = { error: { message, code: "UNAUTHORIZED" } };
  res.status(401).json(body);
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/** Returns the authenticated user's id. Only call on routes mounted behind `requireAuth`. */
export function currentUserId(req: { user?: AuthUser }): string {
  return (req.user as AuthUser).id;
}

/** Verifies the JWT from the Authorization header and attaches the user to the request. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendUnauthorized(res, "Authentication required");
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      sendUnauthorized(res, "User no longer exists");
      return;
    }
    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  } catch {
    sendUnauthorized(res, "Invalid or expired token");
  }
}
