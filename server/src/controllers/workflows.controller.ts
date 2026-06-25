import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import * as workflowService from "../services/workflows";
import type { SafeWorkflow, SafeWorkflowSummary } from "../services/workflows";
import { listRuns, runWorkflowById } from "../services/runs";
import type { RunSummaryRecord } from "../services/runs";
import { testWorkflowNode } from "../services/nodeTest";
import type { RunRecord } from "../engine/persistence";
import type { SingleNodeResult } from "../engine/runSingleNode";
import type {
  CreateWorkflowInput,
  ListWorkflowsQuery,
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

export async function listWorkflows(
  req: Request<unknown, unknown, unknown, ListWorkflowsQuery>,
  res: Response<SafeWorkflowSummary[]>,
): Promise<void> {
  const workflows = await workflowService.listWorkflows(req.query.workspaceId, currentUserId(req));
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
