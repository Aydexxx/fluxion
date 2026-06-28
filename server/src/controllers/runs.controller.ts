import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import { getRun, getRunLogs, listWorkspaceRuns, replayRun } from "../services/runs";
import type { RunDetailRecord, WorkspaceRunsPage } from "../services/runs";
import type { RunRecord } from "../engine/persistence";
import type { RunLogEntry } from "../engine/events";
import type { ExecutionStatusValue, RunTriggerValue } from "../engine/types";

/** GET /runs?workspaceId=&status=&workflowId=&trigger=&search=&from=&to=&cursor=&limit= -> a page of workspace runs. */
export async function listRunsController(req: Request, res: Response<WorkspaceRunsPage>): Promise<void> {
  // Shape is already guaranteed by validateQuery(listWorkspaceRunsQuerySchema).
  const q = req.query as Record<string, string | undefined>;
  const page = await listWorkspaceRuns(String(q.workspaceId), currentUserId(req), {
    status: q.status as ExecutionStatusValue | undefined,
    workflowId: q.workflowId,
    trigger: q.trigger as RunTriggerValue | undefined,
    search: q.search,
    from: q.from,
    to: q.to,
    cursor: q.cursor,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  res.json(page);
}

export async function getRunById(req: Request<{ id: string }>, res: Response<RunDetailRecord>): Promise<void> {
  const run = await getRun(req.params.id, currentUserId(req));
  res.json(run);
}

/** GET /runs/:id/logs?after= -> a run's structured logs (incremental when `after` is set). */
export async function getRunLogsController(req: Request<{ id: string }>, res: Response<RunLogEntry[]>): Promise<void> {
  const after = req.query.after !== undefined ? Number(req.query.after) : undefined;
  const logs = await getRunLogs(req.params.id, currentUserId(req), after);
  res.json(logs);
}

/** POST /runs/:id/replay -> enqueue a fresh run with the same trigger payload, linked to the origin. */
export async function replayRunController(req: Request<{ id: string }>, res: Response<RunRecord>): Promise<void> {
  const run = await replayRun(req.params.id, currentUserId(req));
  res.status(202).json(run);
}
