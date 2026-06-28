import type { WorkflowDefinition } from "../dag/types";
import { NotFoundError, ValidationError } from "../errors/HttpError";
import { PrismaRunRecorder } from "../engine/prismaRecorder";
import { extractSubworkflowOutput } from "../engine/subworkflow";
import type { ExecutionStatusValue, RunTriggerValue } from "../engine/types";
import { prisma } from "./prisma";
import { enqueueRunForWorkflow } from "./runs";

/**
 * The public REST API ("/api/v1") is authenticated by an API key, not a user
 * session — so its services take a resolved `workspaceId` (from the key) instead
 * of a `userId`, and every query is scoped to that workspace. There is no
 * cross-tenant path: an unknown id in another workspace reads as a 404, never a
 * 403, so existence isn't leaked.
 */

/** Compact, public-facing workflow shape (no internal definition). */
export interface PublicWorkflow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** Whether the workflow has a published version that the API can run. */
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Public-facing run summary. */
export interface PublicRun {
  id: string;
  workflowId: string;
  status: ExecutionStatusValue;
  trigger: RunTriggerValue;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/** A run plus its resolved output — what `GET /runs/:id` returns. */
export interface PublicRunDetail extends PublicRun {
  /** The workflow's output (its Response node body, or terminal output); null until finished/none. */
  output: unknown;
}

export async function listWorkflowsForApi(workspaceId: string): Promise<PublicWorkflow[]> {
  const rows = await prisma.workflow.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, description: true, isActive: true, publishedDefinition: true, createdAt: true, updatedAt: true },
  });
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    isActive: w.isActive,
    published: w.publishedDefinition != null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  }));
}

export async function getWorkflowForApi(workspaceId: string, workflowId: string): Promise<PublicWorkflow> {
  const w = await prisma.workflow.findFirst({
    where: { id: workflowId, workspaceId },
    select: { id: true, name: true, description: true, isActive: true, publishedDefinition: true, createdAt: true, updatedAt: true },
  });
  if (!w) throw new NotFoundError("Workflow not found");
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    isActive: w.isActive,
    published: w.publishedDefinition != null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

/**
 * Triggers a run of a workflow's **published** version via the API. Mirrors the
 * webhook/schedule rule — production runs the published definition, never the
 * draft — and rejects a workflow that has never been published. Returns the
 * queued run; execution happens asynchronously on the worker.
 */
export async function triggerRunForApi(
  workspaceId: string,
  workflowId: string,
  payload: unknown,
): Promise<PublicRun> {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, workspaceId },
    select: { id: true, publishedDefinition: true },
  });
  if (!workflow) throw new NotFoundError("Workflow not found");
  if (workflow.publishedDefinition == null) {
    throw new ValidationError("Workflow has no published version; publish it before triggering runs via the API");
  }

  const run = await enqueueRunForWorkflow(workflowId, "api", payload, {
    definition: workflow.publishedDefinition as unknown as WorkflowDefinition,
  });
  return toPublicRun(run);
}

const DEFAULT_RUN_LIMIT = 25;
const MAX_RUN_LIMIT = 100;

export async function listRunsForApi(
  workspaceId: string,
  filters: { workflowId?: string; limit?: number } = {},
): Promise<PublicRun[]> {
  const take = Math.min(Math.max(filters.limit ?? DEFAULT_RUN_LIMIT, 1), MAX_RUN_LIMIT);
  const rows = await prisma.workflowRun.findMany({
    where: { workflow: { workspaceId }, workflowId: filters.workflowId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      workflowId: true,
      status: true,
      trigger: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      error: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    workflowId: r.workflowId,
    status: r.status as ExecutionStatusValue,
    trigger: r.trigger as RunTriggerValue,
    createdAt: r.createdAt?.toISOString() ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    error: r.error,
  }));
}

export async function getRunForApi(workspaceId: string, runId: string): Promise<PublicRunDetail> {
  const owner = await prisma.workflowRun.findFirst({
    where: { id: runId, workflow: { workspaceId } },
    select: { id: true },
  });
  if (!owner) throw new NotFoundError("Run not found");

  const record = await new PrismaRunRecorder(prisma).getRun(runId);
  return { ...toPublicRun(record), output: extractSubworkflowOutput(record) };
}

/** Projects the engine's RunRecord into the public run shape. */
function toPublicRun(run: {
  id: string;
  workflowId: string;
  status: ExecutionStatusValue;
  trigger: RunTriggerValue;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}): PublicRun {
  return {
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    trigger: run.trigger,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
  };
}
