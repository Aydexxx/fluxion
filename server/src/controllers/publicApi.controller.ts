import type { Request, Response } from "express";
import { apiKeyWorkspaceId } from "../middleware/apiKeyAuth";
import {
  getRunForApi,
  getWorkflowForApi,
  listRunsForApi,
  listWorkflowsForApi,
  triggerRunForApi,
  type PublicRun,
  type PublicRunDetail,
  type PublicWorkflow,
} from "../services/publicApi";
import type { TriggerRunInput } from "../validation/publicApi.schemas";

/** GET /api/v1/workflows */
export async function apiListWorkflows(req: Request, res: Response<PublicWorkflow[]>): Promise<void> {
  res.json(await listWorkflowsForApi(apiKeyWorkspaceId(req)));
}

/** GET /api/v1/workflows/:id */
export async function apiGetWorkflow(req: Request<{ id: string }>, res: Response<PublicWorkflow>): Promise<void> {
  res.json(await getWorkflowForApi(apiKeyWorkspaceId(req), req.params.id));
}

/** POST /api/v1/workflows/:id/runs — trigger the workflow's published version. */
export async function apiTriggerRun(
  req: Request<{ id: string }, unknown, TriggerRunInput>,
  res: Response<PublicRun>,
): Promise<void> {
  const run = await triggerRunForApi(apiKeyWorkspaceId(req), req.params.id, req.body.payload ?? null);
  res.status(202).json(run);
}

/** GET /api/v1/runs?workflowId=&limit= */
export async function apiListRuns(req: Request, res: Response<PublicRun[]>): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const runs = await listRunsForApi(apiKeyWorkspaceId(req), {
    workflowId: q.workflowId,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  res.json(runs);
}

/** GET /api/v1/runs/:id — status + output of a single run. */
export async function apiGetRun(req: Request<{ id: string }>, res: Response<PublicRunDetail>): Promise<void> {
  res.json(await getRunForApi(apiKeyWorkspaceId(req), req.params.id));
}
