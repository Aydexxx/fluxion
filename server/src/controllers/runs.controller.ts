import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import { getRun, listWorkspaceRuns, replayRun } from "../services/runs";
import type { WorkspaceRunSummary } from "../services/runs";
import type { RunRecord } from "../engine/persistence";
import type { ExecutionStatusValue } from "../engine/types";

/** GET /runs?workspaceId=&status=&workflowId=&from=&to=&limit= -> runs across a workspace. */
export async function listRunsController(req: Request, res: Response<WorkspaceRunSummary[]>): Promise<void> {
  // Shape is already guaranteed by validateQuery(listWorkspaceRunsQuerySchema).
  const q = req.query as Record<string, string | undefined>;
  const runs = await listWorkspaceRuns(String(q.workspaceId), currentUserId(req), {
    status: q.status as ExecutionStatusValue | undefined,
    workflowId: q.workflowId,
    from: q.from,
    to: q.to,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  res.json(runs);
}

export async function getRunById(req: Request<{ id: string }>, res: Response<RunRecord>): Promise<void> {
  const run = await getRun(req.params.id, currentUserId(req));
  res.json(run);
}

/** POST /runs/:id/replay -> enqueue a fresh run with the same trigger payload, linked to the origin. */
export async function replayRunController(req: Request<{ id: string }>, res: Response<RunRecord>): Promise<void> {
  const run = await replayRun(req.params.id, currentUserId(req));
  res.status(202).json(run);
}
