import { Prisma } from "../generated/prisma/client";
import type {
  WorkspaceVariable as PrismaVariable,
  WorkspaceSecret as PrismaSecret,
} from "../generated/prisma/client";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./crypto";
import { requireWorkspaceMember, requireWorkspaceRole } from "./authorization";
import { NotFoundError, ValidationError } from "../errors/HttpError";
import type { ResolvedVariables, VariableResolver } from "../engine/types";

/**
 * Reusable workspace values referenceable in node configs:
 *  - VARIABLES are plain text (e.g. a base URL) — their value is returned to the client.
 *  - SECRETS are encrypted at rest (AES-256-GCM, the same key + packed format as
 *    credentials) and NEVER returned in plaintext; only their key is exposed. They
 *    are decrypted exclusively at execution time via {@link resolveWorkspaceVariables}.
 */

/** A plain variable, value included (it's non-sensitive). */
export interface SafeVariable {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

/** A secret, value masked — only its key is ever exposed to the client. */
export interface SafeSecret {
  id: string;
  key: string;
  createdAt: string;
  updatedAt: string;
}

function toSafeVariable(row: PrismaVariable): SafeVariable {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSafeSecret(row: PrismaSecret): SafeSecret {
  // Deliberately omits `encryptedValue` — a secret's value never leaves the server.
  return {
    id: row.id,
    key: row.key,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Maps a duplicate-key constraint violation to a friendly 400. */
function rethrowDuplicate(error: unknown, key: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ValidationError(`A ${key} with this key already exists in this workspace`);
  }
  throw error;
}

/* ── Variables ────────────────────────────────────────────────────────────── */

export async function listVariables(workspaceId: string, userId: string): Promise<SafeVariable[]> {
  await requireWorkspaceMember(workspaceId, userId);
  const rows = await prisma.workspaceVariable.findMany({ where: { workspaceId }, orderBy: { key: "asc" } });
  return rows.map(toSafeVariable);
}

export async function createVariable(
  workspaceId: string,
  userId: string,
  input: { key: string; value: string },
): Promise<SafeVariable> {
  await requireWorkspaceRole(workspaceId, userId, "editor");
  try {
    const row = await prisma.workspaceVariable.create({
      data: { workspaceId, key: input.key, value: input.value },
    });
    return toSafeVariable(row);
  } catch (error) {
    rethrowDuplicate(error, "variable");
  }
}

export async function updateVariable(
  variableId: string,
  userId: string,
  input: { key?: string; value?: string },
): Promise<SafeVariable> {
  const existing = await prisma.workspaceVariable.findUnique({ where: { id: variableId } });
  if (!existing) throw new NotFoundError("Variable not found");
  await requireWorkspaceRole(existing.workspaceId, userId, "editor");
  try {
    const row = await prisma.workspaceVariable.update({
      where: { id: variableId },
      data: { key: input.key, value: input.value },
    });
    return toSafeVariable(row);
  } catch (error) {
    rethrowDuplicate(error, "variable");
  }
}

export async function deleteVariable(variableId: string, userId: string): Promise<void> {
  const existing = await prisma.workspaceVariable.findUnique({ where: { id: variableId } });
  if (!existing) throw new NotFoundError("Variable not found");
  // Deleting is an admin-tier action, mirroring credentials.
  await requireWorkspaceRole(existing.workspaceId, userId, "admin");
  await prisma.workspaceVariable.delete({ where: { id: variableId } });
}

/* ── Secrets ──────────────────────────────────────────────────────────────── */

export async function listSecrets(workspaceId: string, userId: string): Promise<SafeSecret[]> {
  await requireWorkspaceMember(workspaceId, userId);
  const rows = await prisma.workspaceSecret.findMany({ where: { workspaceId }, orderBy: { key: "asc" } });
  return rows.map(toSafeSecret);
}

export async function createSecret(
  workspaceId: string,
  userId: string,
  input: { key: string; value: string },
): Promise<SafeSecret> {
  await requireWorkspaceRole(workspaceId, userId, "editor");
  try {
    const row = await prisma.workspaceSecret.create({
      data: { workspaceId, key: input.key, encryptedValue: encryptSecret(input.value, env.credentialsKey) },
    });
    return toSafeSecret(row);
  } catch (error) {
    rethrowDuplicate(error, "secret");
  }
}

/**
 * Updates a secret's key and/or value. The value is write-only: omit it to keep
 * the current secret (rename only), or supply it to rotate. The plaintext is
 * encrypted here and never read back to the client.
 */
export async function updateSecret(
  secretId: string,
  userId: string,
  input: { key?: string; value?: string },
): Promise<SafeSecret> {
  const existing = await prisma.workspaceSecret.findUnique({ where: { id: secretId } });
  if (!existing) throw new NotFoundError("Secret not found");
  await requireWorkspaceRole(existing.workspaceId, userId, "editor");
  try {
    const row = await prisma.workspaceSecret.update({
      where: { id: secretId },
      data: {
        key: input.key,
        encryptedValue: input.value === undefined ? undefined : encryptSecret(input.value, env.credentialsKey),
      },
    });
    return toSafeSecret(row);
  } catch (error) {
    rethrowDuplicate(error, "secret");
  }
}

export async function deleteSecret(secretId: string, userId: string): Promise<void> {
  const existing = await prisma.workspaceSecret.findUnique({ where: { id: secretId } });
  if (!existing) throw new NotFoundError("Secret not found");
  await requireWorkspaceRole(existing.workspaceId, userId, "admin");
  await prisma.workspaceSecret.delete({ where: { id: secretId } });
}

/* ── Execution-time resolution ────────────────────────────────────────────── */

/**
 * Loads a workspace's variables and decrypts its secrets into flat `key -> value`
 * maps for the engine's template scope. Scoped to a single workspace so a run can
 * never reach another tenant's values. NEVER exposed over the API — secrets are
 * decrypted here, at execution time, only.
 */
export async function resolveWorkspaceVariables(workspaceId: string): Promise<ResolvedVariables> {
  const [variables, secrets] = await Promise.all([
    prisma.workspaceVariable.findMany({ where: { workspaceId } }),
    prisma.workspaceSecret.findMany({ where: { workspaceId } }),
  ]);

  const vars: Record<string, string> = {};
  for (const v of variables) vars[v.key] = v.value;

  const decrypted: Record<string, string> = {};
  for (const s of secrets) decrypted[s.key] = decryptSecret(s.encryptedValue, env.credentialsKey);

  return { vars, secrets: decrypted };
}

/**
 * Builds the {@link VariableResolver} the engine uses at execution time, bound to
 * a run's workspace. Constructed in the worker (and the single-node tester), so
 * secrets are decrypted only where a node actually runs — never in the API list path.
 */
export function createPrismaVariableResolver(workspaceId: string): VariableResolver {
  return {
    resolve: () => resolveWorkspaceVariables(workspaceId),
  };
}
