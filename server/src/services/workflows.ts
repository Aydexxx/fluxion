import { Prisma } from "../generated/prisma/client";
import type { Workflow as PrismaWorkflow, WorkflowVersion as PrismaWorkflowVersion } from "../generated/prisma/client";
import type { WorkflowDefinition } from "../dag/types";
import { validateDefinition } from "../dag/validateDefinition";
import { diffDefinitions, definitionsEqual, type DefinitionDiff } from "../dag/diffDefinition";
import { parseFailureNotify, type FailureNotifyConfig } from "../engine/failureNotifier";
import { prisma } from "./prisma";
import { generateWebhookToken } from "./token";
import { requireWorkspaceMember, requireWorkspaceRole, resolveWorkflowWorkspaceId } from "./authorization";
import { removeWorkflowSchedules, syncWorkflowSchedule } from "../scheduler/sync";
import { NotFoundError, ValidationError } from "../errors/HttpError";
import type { CreateWorkflowInput, UpdateWorkflowInput } from "../validation/workflow.schemas";

const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [] };

/** JSON-serializable boundary cast into Prisma's recursive Json input type. */
function asJson(definition: WorkflowDefinition): Prisma.InputJsonValue {
  return definition as unknown as Prisma.InputJsonValue;
}

export interface SafeWorkflowSummary {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SafeWorkflow extends SafeWorkflowSummary {
  /** The draft — what the editor edits. Never runs in production. */
  definition: WorkflowDefinition;
  /** What active webhook/schedule triggers run. Null until first publish. */
  publishedDefinition: WorkflowDefinition | null;
  /** True when the draft differs from what's published (drives the "unpublished changes" badge). */
  hasUnpublishedChanges: boolean;
  /** Highest version number, i.e. the currently-published version. Null if never published. */
  publishedVersion: number | null;
  /** Failure-alert config, or null when no alerts are configured. */
  failureNotify: FailureNotifyConfig | null;
  webhookToken: string | null;
}

/** A workflow row with the latest version number joined in (for `publishedVersion`). */
type WorkflowWithLatestVersion = PrismaWorkflow & { versions?: { version: number }[] };

function toSummary(workflow: PrismaWorkflow): SafeWorkflowSummary {
  return {
    id: workflow.id,
    workspaceId: workflow.workspaceId,
    name: workflow.name,
    description: workflow.description,
    isActive: workflow.isActive,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}

function toWorkflow(workflow: WorkflowWithLatestVersion): SafeWorkflow {
  const draft = workflow.draftDefinition as unknown as WorkflowDefinition;
  const published =
    workflow.publishedDefinition == null ? null : (workflow.publishedDefinition as unknown as WorkflowDefinition);
  return {
    ...toSummary(workflow),
    definition: draft,
    publishedDefinition: published,
    hasUnpublishedChanges: !definitionsEqual(draft, published ?? EMPTY_DEFINITION),
    publishedVersion: workflow.versions?.[0]?.version ?? null,
    failureNotify: parseFailureNotify(workflow.failureNotify),
    webhookToken: workflow.webhookToken,
  };
}

/** Always fetch with the latest version number for `publishedVersion`. */
const LATEST_VERSION_INCLUDE = {
  versions: { orderBy: { version: "desc" }, take: 1, select: { version: true } },
} satisfies Prisma.WorkflowInclude;

export async function createWorkflow(userId: string, input: CreateWorkflowInput): Promise<SafeWorkflow> {
  await requireWorkspaceMember(input.workspaceId, userId);
  const workflow = await prisma.workflow.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      // Every workflow gets a webhook token up front, so its webhook URL is
      // always available the moment a webhook node is added.
      webhookToken: generateWebhookToken(),
      // A new workflow starts as an empty, unpublished draft — nothing runs until it's published.
      draftDefinition: asJson(EMPTY_DEFINITION),
      publishedDefinition: Prisma.JsonNull,
    },
  });
  return toWorkflow(workflow);
}

export async function listWorkflows(workspaceId: string, userId: string): Promise<SafeWorkflowSummary[]> {
  await requireWorkspaceMember(workspaceId, userId);
  const workflows = await prisma.workflow.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  return workflows.map(toSummary);
}

export async function getWorkflow(workflowId: string, userId: string): Promise<SafeWorkflow> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceMember(workspaceId, userId);

  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId }, include: LATEST_VERSION_INCLUDE });
  if (!workflow) throw new NotFoundError("Workflow not found");
  return toWorkflow(workflow);
}

export interface UpdateWorkflowResult {
  workflow: SafeWorkflow;
  warnings: string[];
}

/**
 * Saves edits. A `definition` here updates the **draft only** — production keeps
 * running the published definition, so editing a live workflow is always safe.
 * Schedules are reconciled from the *published* definition (and current
 * isActive), so a draft edit never (de)registers a live cron; only publishing or
 * toggling isActive does.
 */
export async function updateWorkflow(
  workflowId: string,
  userId: string,
  input: UpdateWorkflowInput,
): Promise<UpdateWorkflowResult> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceRole(workspaceId, userId, "member");

  let warnings: string[] = [];
  if (input.definition) {
    // A draft may be a work in progress, so invalid-but-savable: surface errors
    // as warnings rather than blocking the save (publish is where validity is enforced).
    warnings = validateDefinition(input.definition).warnings;
  }

  const workflow = await prisma.workflow.update({
    where: { id: workflowId },
    data: {
      name: input.name,
      description: input.description,
      isActive: input.isActive,
      draftDefinition: input.definition ? asJson(input.definition) : undefined,
      // undefined = leave as-is, null = clear (SQL NULL), object = set.
      failureNotify:
        input.failureNotify === undefined
          ? undefined
          : input.failureNotify === null
            ? Prisma.DbNull
            : (input.failureNotify as unknown as Prisma.InputJsonValue),
    },
    include: LATEST_VERSION_INCLUDE,
  });

  await syncWorkflowSchedule({
    id: workflow.id,
    isActive: workflow.isActive,
    definition: (workflow.publishedDefinition as unknown as WorkflowDefinition) ?? EMPTY_DEFINITION,
  });

  return { workflow: toWorkflow(workflow), warnings };
}

export async function deleteWorkflow(workflowId: string, userId: string): Promise<void> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  // Deleting a workflow is an admin-tier action; creating/editing is open to any member.
  await requireWorkspaceRole(workspaceId, userId, "admin");
  await prisma.workflow.delete({ where: { id: workflowId } });
  await removeWorkflowSchedules(workflowId);
}

/* ── Versioning: publish / rollback / history ─────────────────────────────── */

export interface SafeWorkflowVersion {
  id: string;
  version: number;
  name: string;
  note: string | null;
  authorName: string | null;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  /** How this version differs from the one before it (vs empty for v1). */
  diff: DefinitionDiff;
  /** True for the highest version — the one currently live. */
  isCurrent: boolean;
}

export interface SafeWorkflowVersionDetail extends SafeWorkflowVersion {
  definition: WorkflowDefinition;
}

function versionDefinition(version: PrismaWorkflowVersion): WorkflowDefinition {
  return version.definition as unknown as WorkflowDefinition;
}

/**
 * Promotes the current draft to published and snapshots it as a new version.
 * The draft must be valid (exactly one trigger, acyclic, …) — you can't publish
 * a broken graph to production. Re-syncs schedules so the new published
 * schedule nodes start (or stop) firing.
 */
export async function publishWorkflow(
  workflowId: string,
  userId: string,
  options: { note?: string } = {},
): Promise<{ workflow: SafeWorkflow; version: SafeWorkflowVersion }> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceRole(workspaceId, userId, "member");

  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new NotFoundError("Workflow not found");

  const draft = workflow.draftDefinition as unknown as WorkflowDefinition;
  const validation = validateDefinition(draft);
  if (!validation.valid) {
    throw new ValidationError(`Cannot publish an invalid workflow: ${validation.errors.join("; ")}`);
  }

  const updated = await promoteToVersion(workflow, draft, userId, options.note ?? "Published");
  return updated;
}

/**
 * Rolls back to a past version by re-publishing its definition: the old
 * definition becomes both the new draft and the new published version, captured
 * as a fresh history entry (so history is append-only — a rollback is itself a
 * versioned event). Re-syncs schedules.
 */
export async function rollbackWorkflow(
  workflowId: string,
  userId: string,
  versionId: string,
): Promise<{ workflow: SafeWorkflow; version: SafeWorkflowVersion }> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceRole(workspaceId, userId, "member");

  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new NotFoundError("Workflow not found");

  const target = await prisma.workflowVersion.findUnique({ where: { id: versionId } });
  if (!target || target.workflowId !== workflowId) throw new NotFoundError("Version not found");

  const definition = versionDefinition(target);
  const validation = validateDefinition(definition);
  if (!validation.valid) {
    throw new ValidationError(`Cannot roll back to an invalid version: ${validation.errors.join("; ")}`);
  }

  return promoteToVersion(workflow, definition, userId, `Rolled back to v${target.version}`, { resetDraft: true });
}

/** Shared publish path: snapshot `definition` as the next version and set it published. */
async function promoteToVersion(
  workflow: PrismaWorkflow,
  definition: WorkflowDefinition,
  userId: string,
  note: string,
  options: { resetDraft?: boolean } = {},
): Promise<{ workflow: SafeWorkflow; version: SafeWorkflowVersion }> {
  const [author, last] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.workflowVersion.findFirst({
      where: { workflowId: workflow.id },
      orderBy: { version: "desc" },
      select: { version: true },
    }),
  ]);
  const nextVersion = (last?.version ?? 0) + 1;

  const [version, updated] = await prisma.$transaction([
    prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: nextVersion,
        name: workflow.name,
        note,
        authorId: userId,
        authorName: author?.name ?? null,
        definition: asJson(definition),
      },
    }),
    prisma.workflow.update({
      where: { id: workflow.id },
      data: {
        publishedDefinition: asJson(definition),
        // A rollback also reverts the draft; a normal publish leaves the draft as-is.
        draftDefinition: options.resetDraft ? asJson(definition) : undefined,
      },
      include: LATEST_VERSION_INCLUDE,
    }),
  ]);

  await syncWorkflowSchedule({ id: updated.id, isActive: updated.isActive, definition });

  return {
    workflow: toWorkflow(updated),
    version: toVersionSummary(version, EMPTY_DEFINITION, true),
  };
}

function toVersionSummary(
  version: PrismaWorkflowVersion,
  previousDefinition: WorkflowDefinition,
  isCurrent: boolean,
): SafeWorkflowVersion {
  const definition = versionDefinition(version);
  return {
    id: version.id,
    version: version.version,
    name: version.name,
    note: version.note,
    authorName: version.authorName,
    createdAt: version.createdAt.toISOString(),
    nodeCount: definition.nodes.length,
    edgeCount: definition.edges.length,
    diff: diffDefinitions(previousDefinition, definition),
    isCurrent,
  };
}

/** Lists a workflow's versions newest-first, each with a diff vs the version before it. */
export async function listWorkflowVersions(workflowId: string, userId: string): Promise<SafeWorkflowVersion[]> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceMember(workspaceId, userId);

  const versions = await prisma.workflowVersion.findMany({
    where: { workflowId },
    orderBy: { version: "asc" },
  });

  const latest = versions.length > 0 ? versions[versions.length - 1].version : null;
  const summaries = versions.map((version, i) =>
    toVersionSummary(version, i === 0 ? EMPTY_DEFINITION : versionDefinition(versions[i - 1]), version.version === latest),
  );
  return summaries.reverse(); // newest first for the UI
}

/** A single version with its full definition, for read-only viewing + diffing. */
export async function getWorkflowVersion(
  workflowId: string,
  versionId: string,
  userId: string,
): Promise<SafeWorkflowVersionDetail> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceMember(workspaceId, userId);

  const version = await prisma.workflowVersion.findUnique({ where: { id: versionId } });
  if (!version || version.workflowId !== workflowId) throw new NotFoundError("Version not found");

  const previous = await prisma.workflowVersion.findFirst({
    where: { workflowId, version: { lt: version.version } },
    orderBy: { version: "desc" },
  });
  const latest = await prisma.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const summary = toVersionSummary(
    version,
    previous ? versionDefinition(previous) : EMPTY_DEFINITION,
    version.version === latest?.version,
  );
  return { ...summary, definition: versionDefinition(version) };
}

/**
 * Resolves the definition a run should execute for a given trigger source:
 * manual editor runs test the **draft**; webhook/schedule triggers run the
 * **published** version. Throws if a trigger needs a published version that
 * doesn't exist yet.
 */
export function resolveRunnableDefinition(
  workflow: Pick<PrismaWorkflow, "draftDefinition" | "publishedDefinition">,
  trigger: "manual" | "webhook" | "schedule",
): WorkflowDefinition {
  if (trigger === "manual") {
    return workflow.draftDefinition as unknown as WorkflowDefinition;
  }
  if (workflow.publishedDefinition == null) {
    throw new ValidationError("Workflow has no published version; publish it before it can run from a trigger");
  }
  return workflow.publishedDefinition as unknown as WorkflowDefinition;
}
