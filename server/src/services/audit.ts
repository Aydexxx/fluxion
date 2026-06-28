import type { AuditLog as PrismaAuditLog, Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { requireWorkspaceRole } from "./authorization";

/**
 * Stable audit action keys. Every noteworthy workspace event maps to one of
 * these; the UI groups + labels by them, so keep them stable.
 */
export const AUDIT_ACTIONS = {
  memberInvited: "member.invited",
  memberAdded: "member.added",
  memberRemoved: "member.removed",
  memberRoleChanged: "member.role_changed",
  workflowCreated: "workflow.created",
  workflowPublished: "workflow.published",
  workflowDeleted: "workflow.deleted",
  credentialCreated: "credential.created",
  credentialDeleted: "credential.deleted",
  runFailed: "run.failed",
  apiKeyCreated: "api_key.created",
  apiKeyRevoked: "api_key.revoked",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface RecordAuditInput {
  workspaceId: string;
  action: AuditAction;
  /** The acting user; omit (or pass null) for system-originated events. */
  actorId?: string | null;
  /** Denormalized actor name; resolved from `actorId` when omitted. */
  actorName?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Client-safe audit entry. */
export interface SafeAuditLog {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

function toSafe(row: PrismaAuditLog): SafeAuditLog {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    actorName: row.actorName,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Appends an audit entry. Best-effort by contract: a logging failure must never
 * break the action being logged, so callers wrap it with {@link safeRecordAudit}.
 * Resolves the actor's name when only an id is supplied so the entry is
 * self-contained (survives the actor later being removed).
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  let actorName = input.actorName ?? null;
  if (actorName == null && input.actorId) {
    const actor = await prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true } });
    actorName = actor?.name ?? null;
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      action: input.action,
      actorId: input.actorId ?? null,
      actorName,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetName: input.targetName ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Fire-and-forget audit recording: logs and swallows any error, so accountability
 * is captured without ever jeopardizing the primary operation it accompanies.
 */
export async function safeRecordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await recordAudit(input);
  } catch {
    // Audit is best-effort; never let it surface to the caller.
  }
}

export interface ListAuditLogFilters {
  /** Filter to a single actor. */
  actorId?: string;
  /** Filter to a single action key. */
  action?: string;
  /** ISO timestamps bounding `createdAt`. */
  from?: string;
  to?: string;
  /** Opaque keyset cursor from a prior page's `nextCursor`. */
  cursor?: string;
  limit?: number;
}

export interface AuditActor {
  id: string;
  name: string;
}

export interface AuditLogPage {
  entries: SafeAuditLog[];
  /** Distinct actors seen in this workspace's log, for the filter dropdown. */
  actors: AuditActor[];
  /** Pass back as `cursor` for the next page; null when there are no more. */
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Lists a workspace's audit log, newest first, filterable by actor / action /
 * date range and keyset-paginated on (createdAt, id). Admin-only — the log
 * exposes who did what, so a viewer/editor must not read it.
 */
export async function listAuditLog(
  workspaceId: string,
  userId: string,
  filters: ListAuditLogFilters = {},
): Promise<AuditLogPage> {
  await requireWorkspaceRole(workspaceId, userId, "admin");

  const take = Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const and: Prisma.AuditLogWhereInput[] = [];
  if (filters.from || filters.to) {
    and.push({
      createdAt: {
        gte: filters.from ? new Date(filters.from) : undefined,
        lte: filters.to ? new Date(filters.to) : undefined,
      },
    });
  }
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
      ],
    });
  }

  const where: Prisma.AuditLogWhereInput = {
    workspaceId,
    actorId: filters.actorId,
    action: filters.action,
    ...(and.length ? { AND: and } : {}),
  };

  const [rows, distinctActors] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
    // The actor filter needs the set of people who have ever acted here.
    prisma.auditLog.findMany({
      where: { workspaceId, actorId: { not: null } },
      distinct: ["actorId"],
      select: { actorId: true, actorName: true },
      orderBy: { actorName: "asc" },
    }),
  ]);

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  const actors: AuditActor[] = distinctActors
    .filter((a): a is { actorId: string; actorName: string | null } => a.actorId != null)
    .map((a) => ({ id: a.actorId, name: a.actorName ?? "Unknown" }));

  return { entries: page.map(toSafe), actors, nextCursor };
}
