import type { WorkflowDefinition } from "../dag/types";
import { validateDefinition } from "../dag/validateDefinition";
import { NotFoundError, ValidationError } from "../errors/HttpError";
import { PrismaRunRecorder } from "../engine/prismaRecorder";
import type { RunRecord } from "../engine/persistence";
import type { RunLogEntry } from "../engine/events";
import type { Prisma, WorkflowRun as PrismaWorkflowRun } from "../generated/prisma/client";
import type { ExecutionStatusValue, RunTriggerValue } from "../engine/types";
import { enqueueWorkflowRun } from "../queue/workflowQueue";
import { prisma } from "./prisma";
import { resolveRunnableDefinition } from "./workflows";
import { requireWorkspaceMember, requireWorkspaceRole, resolveWorkflowWorkspaceId } from "./authorization";

/**
 * Trigger-agnostic core: resolves the definition this trigger should run
 * (manual → draft, webhook/schedule → published), validates it, creates a
 * `queued` WorkflowRun with that exact definition snapshotted onto it, and
 * enqueues it. Snapshotting means later draft edits can never alter an
 * already-queued or in-flight run. Returns the queued run.
 *
 * `options.definition` overrides the resolution (used by replay to re-execute a
 * past run's exact captured definition).
 */
export async function enqueueRunForWorkflow(
  workflowId: string,
  trigger: RunTriggerValue,
  payload: unknown,
  options: { replayOfId?: string; definition?: WorkflowDefinition; triggeredById?: string } = {},
): Promise<RunRecord> {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    select: { id: true, draftDefinition: true, publishedDefinition: true },
  });
  if (!workflow) throw new NotFoundError("Workflow not found");

  const definition = options.definition ?? resolveRunnableDefinition(workflow, trigger);
  const validation = validateDefinition(definition);
  if (!validation.valid) {
    throw new ValidationError(`Workflow cannot run: ${validation.errors.join("; ")}`);
  }

  const recorder = new PrismaRunRecorder(prisma);
  const runId = await recorder.enqueueRun({
    workflowId,
    trigger,
    payload,
    definition,
    replayOfId: options.replayOfId ?? null,
    triggeredById: options.triggeredById ?? null,
  });
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
    select: { id: true, workflowId: true, trigger: true, payload: true, definition: true },
  });
  if (!origin) throw new NotFoundError("Run not found");

  const workspaceId = await resolveWorkflowWorkspaceId(origin.workflowId);
  await requireWorkspaceRole(workspaceId, userId, "editor");

  // A true replay re-runs the *exact* definition the origin executed (its
  // snapshot), not whatever the draft/published happens to be now. Older runs
  // without a snapshot fall back to trigger-based resolution.
  const definition = origin.definition == null ? undefined : (origin.definition as unknown as WorkflowDefinition);
  return enqueueRunForWorkflow(origin.workflowId, origin.trigger as RunTriggerValue, origin.payload, {
    replayOfId: origin.id,
    definition,
    triggeredById: userId,
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
  await requireWorkspaceRole(workspaceId, userId, "editor");
  return enqueueRunForWorkflow(workflowId, "manual", payload, { triggeredById: userId });
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
  /** For a failed run, the id of the node that failed (the dead-letter culprit). Null otherwise. */
  failingNode: string | null;
}

export interface ListWorkspaceRunsFilters {
  status?: ExecutionStatusValue;
  workflowId?: string;
  trigger?: RunTriggerValue;
  /** Free-text match against workflow name or run id. */
  search?: string;
  /** ISO timestamps bounding `createdAt`. */
  from?: string;
  to?: string;
  /** Opaque keyset cursor (from a previous page's `nextCursor`). */
  cursor?: string;
  limit?: number;
}

/** One page of workspace runs plus the cursor to fetch the next, for infinite scroll. */
export interface WorkspaceRunsPage {
  runs: WorkspaceRunSummary[];
  /** Pass back as `cursor` to fetch the next page; null when there are no more. */
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Encodes a run's (createdAt, id) as an opaque, URL-safe keyset cursor. */
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
 * Lists runs across every workflow in a workspace, newest first, with optional
 * status / workflow / trigger / date-range filters and free-text search.
 * Paginates by keyset on (createdAt, id) for stable infinite scroll. Authorizes
 * the caller as a member.
 */
export async function listWorkspaceRuns(
  workspaceId: string,
  userId: string,
  filters: ListWorkspaceRunsFilters = {},
): Promise<WorkspaceRunsPage> {
  await requireWorkspaceMember(workspaceId, userId);

  const take = Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  // AND together the independent predicates so each can carry its own OR group
  // (a single top-level OR would otherwise be overwritten by the next).
  const and: Prisma.WorkflowRunWhereInput[] = [];
  if (filters.from || filters.to) {
    and.push({
      createdAt: {
        gte: filters.from ? new Date(filters.from) : undefined,
        lte: filters.to ? new Date(filters.to) : undefined,
      },
    });
  }
  if (filters.search) {
    and.push({
      OR: [
        { id: { contains: filters.search, mode: "insensitive" } },
        { workflow: { name: { contains: filters.search, mode: "insensitive" } } },
      ],
    });
  }
  // Keyset: rows strictly "after" the cursor in (createdAt desc, id desc) order.
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
      ],
    });
  }

  const runs = await prisma.workflowRun.findMany({
    where: {
      workflow: { workspaceId },
      status: filters.status,
      workflowId: filters.workflowId,
      trigger: filters.trigger,
      ...(and.length ? { AND: and } : {}),
    },
    include: {
      workflow: { select: { name: true } },
      // The first failed node identifies the dead-letter culprit for failed runs.
      nodeExecutions: { where: { status: "failed" }, orderBy: { finishedAt: "asc" }, take: 1, select: { nodeId: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1, // one extra row tells us whether another page exists
  });

  const hasMore = runs.length > take;
  const page = hasMore ? runs.slice(0, take) : runs;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last?.createdAt ? encodeCursor(last.createdAt, last.id) : null;

  return {
    runs: page.map((run) => ({
      ...toSummary(run),
      workflowName: run.workflow.name,
      createdAt: run.createdAt?.toISOString() ?? null,
      replayOfId: run.replayOfId ?? null,
      failingNode: run.nodeExecutions[0]?.nodeId ?? null,
    })),
    nextCursor,
  };
}

/** Retrieves a run's structured logs (optionally only those after `afterSeq`), authorizing via the run's workspace. */
export async function getRunLogs(runId: string, userId: string, afterSeq?: number): Promise<RunLogEntry[]> {
  const run = await prisma.workflowRun.findUnique({ where: { id: runId }, select: { workflowId: true } });
  if (!run) throw new NotFoundError("Run not found");

  const workspaceId = await resolveWorkflowWorkspaceId(run.workflowId);
  await requireWorkspaceMember(workspaceId, userId);

  return new PrismaRunRecorder(prisma).listRunLogs(runId, afterSeq);
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

/** A nested sub-workflow run spawned by a `flow.subworkflow` node in this run. */
export interface NestedRunRef {
  id: string;
  /** The Call Workflow node in *this* run that spawned the nested run (timeline linkage). */
  parentNodeId: string | null;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatusValue;
  error: string | null;
}

/** A run's full detail, plus the lineage needed to render sub-workflow nesting. */
export interface RunDetailRecord extends RunRecord {
  /** When this run is itself a nested run, a back-reference to its parent. */
  parentRun: { id: string; workflowId: string; workflowName: string } | null;
  /** Sub-workflow runs this run spawned, keyed back to their calling node. */
  childRuns: NestedRunRef[];
}

/**
 * Loads a single run with its node executions, authorizing via the run's
 * workspace. Enriches with sub-workflow lineage: the parent run (if this is a
 * nested run) and any nested runs it spawned, so the timeline can render and
 * link the nesting.
 */
export async function getRun(runId: string, userId: string): Promise<RunDetailRecord> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { workflowId: true, parentRunId: true },
  });
  if (!run) throw new NotFoundError("Run not found");

  const workspaceId = await resolveWorkflowWorkspaceId(run.workflowId);
  await requireWorkspaceMember(workspaceId, userId);

  const [record, children, parent] = await Promise.all([
    new PrismaRunRecorder(prisma).getRun(runId),
    prisma.workflowRun.findMany({
      where: { parentRunId: runId },
      select: { id: true, parentNodeId: true, workflowId: true, status: true, error: true, workflow: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    run.parentRunId
      ? prisma.workflowRun.findUnique({
          where: { id: run.parentRunId },
          select: { id: true, workflowId: true, workflow: { select: { name: true } } },
        })
      : Promise.resolve(null),
  ]);

  return {
    ...record,
    parentRun: parent ? { id: parent.id, workflowId: parent.workflowId, workflowName: parent.workflow.name } : null,
    childRuns: children.map((c) => ({
      id: c.id,
      parentNodeId: c.parentNodeId ?? null,
      workflowId: c.workflowId,
      workflowName: c.workflow.name,
      status: c.status as ExecutionStatusValue,
      error: c.error,
    })),
  };
}
