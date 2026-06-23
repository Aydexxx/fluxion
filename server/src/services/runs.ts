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
): Promise<RunRecord> {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new NotFoundError("Workflow not found");

  const definition = workflow.definition as unknown as WorkflowDefinition;
  const validation = validateDefinition(definition);
  if (!validation.valid) {
    throw new ValidationError(`Workflow cannot run: ${validation.errors.join("; ")}`);
  }

  const recorder = new PrismaRunRecorder(prisma);
  const runId = await recorder.enqueueRun({ workflowId, trigger, payload });
  await enqueueWorkflowRun({ runId, workflowId, payload });

  return recorder.getRun(runId);
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
