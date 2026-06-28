import type { Credential as PrismaCredential } from "../generated/prisma/client";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./crypto";
import { getCredentialTypeSpec } from "../credentials/catalog";
import type { CredentialAccessor, CredentialSecret } from "../engine/types";
import { NotFoundError, ValidationError } from "../errors/HttpError";
import { requireWorkspaceMember, requireWorkspaceRole } from "./authorization";
import { AUDIT_ACTIONS, safeRecordAudit } from "./audit";

/**
 * Client-safe view of a credential. Deliberately omits every secret field:
 * only the name, type, non-secret `meta` (e.g. SMTP host), and a `last4`
 * preview of the primary secret ever leave the server.
 */
export interface SafeCredential {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  /** Non-secret field values, safe to show and to pre-fill on edit. */
  meta: Record<string, string>;
  /** Last 4 chars of the type's preview secret, or null when none is defined. */
  last4: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCredentialInput {
  workspaceId: string;
  name: string;
  type: string;
  data: Record<string, string>;
}

export interface UpdateCredentialInput {
  name?: string;
  data?: Record<string, string>;
}

/**
 * Validates submitted fields against the type's catalog spec and returns a
 * cleaned object holding only known fields. Throws `ValidationError` for an
 * unknown type or a missing required field.
 */
function cleanCredentialData(type: string, data: Record<string, string>): Record<string, string> {
  const spec = getCredentialTypeSpec(type);
  if (!spec) throw new ValidationError(`Unknown credential type "${type}"`);

  const clean: Record<string, string> = {};
  for (const field of spec.fields) {
    const raw = data[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === "") {
      if (!field.optional) throw new ValidationError(`Credential field "${field.key}" is required for type "${type}"`);
      continue;
    }
    clean[field.key] = value;
  }
  return clean;
}

/** Decrypts a stored row into its full field object. Server-internal only. */
function decryptData(row: PrismaCredential): Record<string, string> {
  return JSON.parse(decryptSecret(row.encryptedData, env.credentialsKey)) as Record<string, string>;
}

/** Projects a stored row into its client-safe view, stripping all secret fields. */
function toSafeCredential(row: PrismaCredential): SafeCredential {
  const spec = getCredentialTypeSpec(row.type);
  const data = decryptData(row);

  const meta: Record<string, string> = {};
  let last4: string | null = null;
  if (spec) {
    for (const field of spec.fields) {
      if (!field.secret && data[field.key] != null) meta[field.key] = data[field.key];
    }
    if (spec.previewKey) {
      const secret = data[spec.previewKey];
      if (secret) last4 = secret.slice(-4);
    }
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type,
    meta,
    last4,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCredentials(workspaceId: string, userId: string): Promise<SafeCredential[]> {
  await requireWorkspaceMember(workspaceId, userId);
  const rows = await prisma.credential.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  return rows.map(toSafeCredential);
}

export async function createCredential(userId: string, input: CreateCredentialInput): Promise<SafeCredential> {
  await requireWorkspaceRole(input.workspaceId, userId, "editor");
  const clean = cleanCredentialData(input.type, input.data);
  const row = await prisma.credential.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      type: input.type,
      encryptedData: encryptSecret(JSON.stringify(clean), env.credentialsKey),
    },
  });

  await safeRecordAudit({
    workspaceId: input.workspaceId,
    action: AUDIT_ACTIONS.credentialCreated,
    actorId: userId,
    targetType: "credential",
    targetId: row.id,
    targetName: row.name,
    metadata: { type: row.type },
  });

  return toSafeCredential(row);
}

export async function updateCredential(
  credentialId: string,
  userId: string,
  input: UpdateCredentialInput,
): Promise<SafeCredential> {
  const existing = await prisma.credential.findUnique({ where: { id: credentialId } });
  if (!existing) throw new NotFoundError("Credential not found");
  await requireWorkspaceRole(existing.workspaceId, userId, "editor");

  const data: { name?: string; encryptedData?: string } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.data !== undefined) {
    const clean = cleanCredentialData(existing.type, input.data);
    data.encryptedData = encryptSecret(JSON.stringify(clean), env.credentialsKey);
  }

  const row = await prisma.credential.update({ where: { id: credentialId }, data });
  return toSafeCredential(row);
}

export async function deleteCredential(credentialId: string, userId: string): Promise<void> {
  const existing = await prisma.credential.findUnique({ where: { id: credentialId } });
  if (!existing) throw new NotFoundError("Credential not found");
  // Deleting a secret is an admin-tier action, mirroring workflow deletion.
  await requireWorkspaceRole(existing.workspaceId, userId, "admin");
  await prisma.credential.delete({ where: { id: credentialId } });

  await safeRecordAudit({
    workspaceId: existing.workspaceId,
    action: AUDIT_ACTIONS.credentialDeleted,
    actorId: userId,
    targetType: "credential",
    targetId: existing.id,
    targetName: existing.name,
    metadata: { type: existing.type },
  });
}

/**
 * Resolves and decrypts a credential for execution. Scoped to a workspace so a
 * node can never reference a credential from another tenant. Returns `null`
 * when the id doesn't exist in this workspace. NEVER exposed over the API.
 */
export async function getDecryptedCredential(
  credentialId: string,
  workspaceId: string,
): Promise<CredentialSecret | null> {
  const row = await prisma.credential.findFirst({ where: { id: credentialId, workspaceId } });
  if (!row) return null;
  return { type: row.type, data: decryptData(row) };
}

/**
 * Builds the {@link CredentialAccessor} the engine uses at execution time,
 * bound to a single run's workspace. Constructed in the worker (never in the
 * API request path) so secrets are decrypted only where a node actually runs.
 */
export function createPrismaCredentialAccessor(workspaceId: string): CredentialAccessor {
  return {
    resolve: (credentialId) => getDecryptedCredential(credentialId, workspaceId),
  };
}
