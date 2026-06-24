import type { WorkflowDefinition } from "../dag/types";
import { validateDefinition } from "../dag/validateDefinition";
import { NotFoundError, ValidationError } from "../errors/HttpError";
import { PrismaRunRecorder } from "../engine/prismaRecorder";
import type { RunRecord } from "../engine/persistence";
import type { WorkflowRun as PrismaWorkflowRun } from "../generated/prisma/client";
import type { ExecutionStatusValue, RunTriggerValue } from "../engine/types";
import { enqueueWorkflowRun } from "../queue/workflowQueue";
import { prisma } from "./prisma";
import { requireWorkspaceMember, requireWorkspaceRole, resolveWorkflowWorkspaceId } from "./authorization";

/**
 * Trigger-agnostic core: validates the saved definition, creates a `queued`
 * WorkflowRun, and enqueues it for the worker. Used by every trigger source
 * (manual, webhook, schedule). Returns the queued run.
 */
export async function enqueueRunForWorkflow(
  workflowId: string,
  trigger: RunTriggerValue,
  payload: unknown,
  options: { replayOfId?: string } = {},
): Promise<RunRecord> {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new NotFoundError("Workflow not found");

  const definition = workflow.definition as unknown as WorkflowDefinition;
  const validation = validateDefinition(definition);
  if (!validation.valid) {
    throw new ValidationError(`Workflow cannot run: ${validation.errors.join("; ")}`);
  }

  const recorder = new PrismaRunRecorder(prisma);
  const runId = await recorder.enqueueRun({ workflowId, trigger, payload, replayOfId: options.replayOfId ?? null });
  await enqueueWorkflowRun({ runId, workflowId, payload });

  return recorder.getRun(runId);
}

/**
 * Replays a past run: re-enqueues a fresh run of the same workflow with the
 * same trigger type and payload, linked back to the origin via `replayOfId`.
 * Authorizes the caller as a member of the origin run's workspace.
 */
export async function replayRun(runId: string, userId: string): Promise<RunRecord> {
  const origin = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { id: true, workflowId: true, trigger: true, payload: true },
  });
  if (!origin) throw new NotFoundError("Run not found");

  const workspaceId = await resolveWorkflowWorkspaceId(origin.workflowId);
  await requireWorkspaceRole(workspaceId, userId, "member");

  return enqueueRunForWorkflow(origin.workflowId, origin.trigger as RunTriggerValue, origin.payload, {
    replayOfId: origin.id,
  });
}

/**
 * Triggers a manual run. Authorizes the caller as a workspace member, then
 * enqueues. Execution and status updates happen on the worker, surfaced live
 * over Socket.IO.
 */
export async function runWorkflowById(
  workflowId: string,
  userId: string,
  payload: unknown,
): Promise<RunRecord> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceRole(workspaceId, userId, "member");
  return enqueueRunForWorkflow(workflowId, "manual", payload);
}

/** Lightweight run record for history lists — no per-node executions. */
export interface RunSummaryRecord {
  id: string;
  workflowId: string;
  status: ExecutionStatusValue;
  trigger: RunTriggerValue;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

function toSummary(run: PrismaWorkflowRun): RunSummaryRecord {
  return {
    id: run.id,
    workflowId: run.workflowId,
    status: run.status as ExecutionStatusValue,
    trigger: run.trigger as RunTriggerValue,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    error: run.error,
  };
}

/** A run summary enriched with its workflow name + lineage, for the workspace runs dashboard. */
export interface WorkspaceRunSummary extends RunSummaryRecord {
  workflowName: string;
  createdAt: string | null;
  replayOfId: string | null;
}

export interface ListWorkspaceRunsFilters {
  status?: ExecutionStatusValue;
  workflowId?: string;
  /** ISO timestamps bounding `createdAt`. */
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Lists runs across every workflow in a workspace, newest first, with optional
 * status / workflow / date-range filters. Authorizes the caller as a member.
 */
export async function listWorkspaceRuns(
  workspaceId: string,
  userId: string,
  filters: ListWorkspaceRunsFilters = {},
): Promise<WorkspaceRunSummary[]> {
  await requireWorkspaceMember(workspaceId, userId);

  const createdAt =
    filters.from || filters.to
      ? { gte: filters.from ? new Date(filters.from) : undefined, lte: filters.to ? new Date(filters.to) : undefined }
      : undefined;

  const runs = await prisma.workflowRun.findMany({
    where: {
      workflow: { workspaceId },
      status: filters.status,
      workflowId: filters.workflowId,
      createdAt,
    },
    include: { workflow: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.limit ?? 100, 500),
  });

  return runs.map((run) => ({
    ...toSummary(run),
    workflowName: run.workflow.name,
    createdAt: run.createdAt?.toISOString() ?? null,
    replayOfId: run.replayOfId ?? null,
  }));
}

/** Lists a workflow's past runs, most recent first. Any workspace member may view history. */
export async function listRuns(workflowId: string, userId: string): Promise<RunSummaryRecord[]> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceMember(workspaceId, userId);

  const runs = await prisma.workflowRun.findMany({
    where: { workflowId },
    orderBy: { startedAt: "desc" },
  });
  return runs.map(toSummary);
}

/** Loads a single run with its node executions, authorizing via the run's workspace. */
export async function getRun(runId: string, userId: string): Promise<RunRecord> {
  const run = await prisma.workflowRun.findUnique({ where: { id: runId }, select: { workflowId: true } });
  if (!run) throw new NotFoundError("Run not found");

  const workspaceId = await resolveWorkflowWorkspaceId(run.workflowId);
  await requireWorkspaceMember(workspaceId, userId);

  return new PrismaRunRecorder(prisma).getRun(runId);
}
