import type { ApiKey as PrismaApiKey } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { generateApiKey, hashApiKey } from "./token";
import { requireWorkspaceRole } from "./authorization";
import { AUDIT_ACTIONS, safeRecordAudit } from "./audit";
import { NotFoundError, ValidationError } from "../errors/HttpError";

/**
 * The capability scopes an API key can carry — the key's RBAC. Deliberately
 * coarse and read/run-oriented (the public API is read + trigger only):
 *   workflows:read  list/get workflows, list/get runs + their output (viewer-equiv)
 *   workflows:run   trigger a workflow run (editor-equiv, for running only)
 */
export const API_SCOPES = ["workflows:read", "workflows:run"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/** Client-safe view of a key — never includes the secret or its hash. */
export interface SafeApiKey {
  id: string;
  name: string;
  /** Non-secret display slice (e.g. "flux_AbC123"). */
  prefix: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** A freshly-created key, returned exactly once with its plaintext secret. */
export interface CreatedApiKey extends SafeApiKey {
  /** The full key — shown once, on creation, and never retrievable again. */
  key: string;
}

/** The resolved identity of an authenticated API request. */
export interface ApiKeyIdentity {
  id: string;
  workspaceId: string;
  scopes: ApiScope[];
}

/** Re-write lastUsedAt at most this often, so per-request auth doesn't write on every call. */
const LAST_USED_THROTTLE_MS = 60_000;

function toSafe(row: PrismaApiKey): SafeApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes.filter(isApiScope),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Lists a workspace's active (non-revoked) keys, newest first. Admin-tier. */
export async function listApiKeys(workspaceId: string, userId: string): Promise<SafeApiKey[]> {
  await requireWorkspaceRole(workspaceId, userId, "admin");
  const rows = await prisma.apiKey.findMany({
    where: { workspaceId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSafe);
}

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiScope[];
}

/**
 * Creates a scoped key for a workspace and returns it once, plaintext included.
 * Managing programmatic access is an admin-tier action (like managing members),
 * since a key grants standing, user-independent access to the workspace.
 */
export async function createApiKey(
  workspaceId: string,
  userId: string,
  input: CreateApiKeyInput,
): Promise<CreatedApiKey> {
  await requireWorkspaceRole(workspaceId, userId, "admin");

  const name = input.name.trim();
  if (name === "") throw new ValidationError("API key name is required");
  const scopes = [...new Set(input.scopes)];
  if (scopes.length === 0) throw new ValidationError("At least one scope is required");
  if (!scopes.every(isApiScope)) throw new ValidationError("Unknown scope requested");

  const { plaintext, hashedKey, prefix } = generateApiKey();
  const actor = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

  const row = await prisma.apiKey.create({
    data: { workspaceId, name, hashedKey, prefix, scopes, createdById: userId, createdByName: actor?.name ?? null },
  });

  await safeRecordAudit({
    workspaceId,
    action: AUDIT_ACTIONS.apiKeyCreated,
    actorId: userId,
    targetType: "api_key",
    targetId: row.id,
    targetName: row.name,
    metadata: { scopes },
  });

  return { ...toSafe(row), key: plaintext };
}

/**
 * Revokes a key (soft delete): it can never authenticate again, but the row is
 * kept out of the active list. Admin-tier, and scoped to the key's own
 * workspace so an admin can't revoke another tenant's key.
 */
export async function revokeApiKey(keyId: string, userId: string): Promise<void> {
  const existing = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!existing || existing.revokedAt) throw new NotFoundError("API key not found");
  await requireWorkspaceRole(existing.workspaceId, userId, "admin");

  await prisma.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });

  await safeRecordAudit({
    workspaceId: existing.workspaceId,
    action: AUDIT_ACTIONS.apiKeyRevoked,
    actorId: userId,
    targetType: "api_key",
    targetId: existing.id,
    targetName: existing.name,
  });
}

/**
 * Authenticates a raw API key: resolves the active key by its hash and returns
 * the workspace + scopes it grants, or null when the key is unknown or revoked.
 * Refreshes `lastUsedAt` (throttled) so the management screen shows real usage
 * without a write on every request.
 */
export async function verifyApiKey(plaintext: string): Promise<ApiKeyIdentity | null> {
  const trimmed = plaintext.trim();
  if (trimmed === "") return null;

  const row = await prisma.apiKey.findUnique({ where: { hashedKey: hashApiKey(trimmed) } });
  if (!row || row.revokedAt) return null;

  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } });
  }

  return { id: row.id, workspaceId: row.workspaceId, scopes: row.scopes.filter(isApiScope) };
}
