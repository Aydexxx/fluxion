import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import * as workflowService from "../services/workflows";
import type {
  SafeWorkflow,
  SafeWorkflowSummary,
  SafeWorkflowVersion,
  SafeWorkflowVersionDetail,
} from "../services/workflows";
import { listRuns, runWorkflowById } from "../services/runs";
import type { RunSummaryRecord } from "../services/runs";
import { testWorkflowNode } from "../services/nodeTest";
import type { RunRecord } from "../engine/persistence";
import type { SingleNodeResult } from "../engine/runSingleNode";
import type {
  CreateWorkflowInput,
  ListWorkflowsQuery,
  PublishWorkflowInput,
  RunWorkflowInput,
  TestNodeInput,
  UpdateWorkflowInput,
} from "../validation/workflow.schemas";

export async function createWorkflow(
  req: Request<unknown, unknown, CreateWorkflowInput>,
  res: Response<SafeWorkflow>,
): Promise<void> {
  const workflow = await workflowService.createWorkflow(currentUserId(req), req.body);
  res.status(201).json(workflow);
}

/** GET /workflows?workspaceId=&search=&folderId=&tagId=&isActive=&sortBy=&sortDir= */
export async function listWorkflows(
  req: Request<unknown, unknown, unknown, ListWorkflowsQuery>,
  res: Response<SafeWorkflowSummary[]>,
): Promise<void> {
  // Shape is already guaranteed by validateQuery(listWorkflowsQuerySchema); read
  // as raw strings since Express 5's req.query can't be rewritten with the parsed result.
  const q = req.query as unknown as Record<string, string | undefined>;
  const workflows = await workflowService.listWorkflows(String(q.workspaceId), currentUserId(req), {
    search: q.search,
    folderId: q.folderId,
    tagId: q.tagId,
    isActive: q.isActive === undefined ? undefined : q.isActive === "true",
    sortBy: q.sortBy as "updatedAt" | "createdAt" | "name" | undefined,
    sortDir: q.sortDir as "asc" | "desc" | undefined,
  });
  res.json(workflows);
}

export async function getWorkflow(req: Request<{ id: string }>, res: Response<SafeWorkflow>): Promise<void> {
  const workflow = await workflowService.getWorkflow(req.params.id, currentUserId(req));
  res.json(workflow);
}

export async function updateWorkflow(
  req: Request<{ id: string }, unknown, UpdateWorkflowInput>,
  res: Response<SafeWorkflow & { warnings: string[] }>,
): Promise<void> {
  const { workflow, warnings } = await workflowService.updateWorkflow(req.params.id, currentUserId(req), req.body);
  res.json({ ...workflow, warnings });
}

export async function deleteWorkflow(req: Request<{ id: string }>, res: Response): Promise<void> {
  await workflowService.deleteWorkflow(req.params.id, currentUserId(req));
  res.status(204).end();
}

export async function publishWorkflow(
  req: Request<{ id: string }, unknown, PublishWorkflowInput>,
  res: Response<{ workflow: SafeWorkflow; version: SafeWorkflowVersion }>,
): Promise<void> {
  const result = await workflowService.publishWorkflow(req.params.id, currentUserId(req), { note: req.body.note });
  res.status(201).json(result);
}

export async function rollbackWorkflow(
  req: Request<{ id: string; versionId: string }>,
  res: Response<{ workflow: SafeWorkflow; version: SafeWorkflowVersion }>,
): Promise<void> {
  const result = await workflowService.rollbackWorkflow(req.params.id, currentUserId(req), req.params.versionId);
  res.status(201).json(result);
}

export async function listWorkflowVersions(
  req: Request<{ id: string }>,
  res: Response<SafeWorkflowVersion[]>,
): Promise<void> {
  const versions = await workflowService.listWorkflowVersions(req.params.id, currentUserId(req));
  res.json(versions);
}

export async function getWorkflowVersion(
  req: Request<{ id: string; versionId: string }>,
  res: Response<SafeWorkflowVersionDetail>,
): Promise<void> {
  const version = await workflowService.getWorkflowVersion(req.params.id, req.params.versionId, currentUserId(req));
  res.json(version);
}

export async function runWorkflow(
  req: Request<{ id: string }, unknown, RunWorkflowInput>,
  res: Response<RunRecord>,
): Promise<void> {
  const run = await runWorkflowById(req.params.id, currentUserId(req), req.body.payload);
  // 202: accepted for asynchronous execution; the run starts queued.
  res.status(202).json(run);
}

export async function listWorkflowRuns(
  req: Request<{ id: string }>,
  res: Response<RunSummaryRecord[]>,
): Promise<void> {
  const runs = await listRuns(req.params.id, currentUserId(req));
  res.json(runs);
}

export async function testWorkflowNodeController(
  req: Request<{ id: string; nodeId: string }, unknown, TestNodeInput>,
  res: Response<SingleNodeResult>,
): Promise<void> {
  const result = await testWorkflowNode(req.params.id, req.params.nodeId, currentUserId(req), req.body);
  res.json(result);
}
