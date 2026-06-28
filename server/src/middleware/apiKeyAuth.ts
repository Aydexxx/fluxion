import type { NextFunction, Request, Response } from "express";
import type { ApiError } from "../types/api";
import { verifyApiKey, type ApiKeyIdentity, type ApiScope } from "../services/apiKeys";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireApiKey` on the public `/api/v1` surface. */
      apiKey?: ApiKeyIdentity;
    }
  }
}

function sendError(res: Response, status: number, message: string, code: string): void {
  const body: ApiError = { error: { message, code } };
  res.status(status).json(body);
}

/**
 * Pulls the API key from the request. Prefers the dedicated `X-API-Key` header
 * (keeping it cleanly separate from the app's session `Authorization: Bearer`
 * JWT), but also accepts `Authorization: Bearer <key>` for clients that only
 * speak bearer auth.
 */
function extractApiKey(req: Request): string | null {
  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim() !== "") return headerKey.trim();

  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token !== "") return token;
  }
  return null;
}

/**
 * Authenticates a public-API request by its API key, attaching the resolved
 * `{ id, workspaceId, scopes }` to the request. Rejects a missing, unknown, or
 * revoked key with 401. Must run before any scope check or per-key rate limit.
 */
export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = extractApiKey(req);
  if (!key) {
    sendError(res, 401, "API key required. Pass it in the X-API-Key header.", "UNAUTHORIZED");
    return;
  }

  const identity = await verifyApiKey(key);
  if (!identity) {
    sendError(res, 401, "Invalid or revoked API key", "UNAUTHORIZED");
    return;
  }

  req.apiKey = identity;
  next();
}

/** The workspace bound to the authenticated key. Only call behind `requireApiKey`. */
export function apiKeyWorkspaceId(req: Request): string {
  return (req.apiKey as ApiKeyIdentity).workspaceId;
}

/**
 * Guards a route behind a scope: the authenticated key must carry `scope` or the
 * request is rejected 403. This is the key's RBAC — a read-only key can't trigger
 * runs, a run-only key can't read other workflows, etc.
 */
export function requireScope(scope: ApiScope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = req.apiKey;
    if (!identity) {
      sendError(res, 401, "API key required", "UNAUTHORIZED");
      return;
    }
    if (!identity.scopes.includes(scope)) {
      sendError(res, 403, `This API key is missing the required "${scope}" scope`, "FORBIDDEN");
      return;
    }
    next();
  };
}
