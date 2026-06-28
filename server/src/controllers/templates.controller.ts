import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import {
  createWorkspaceTemplate,
  deleteWorkspaceTemplate,
  instantiateTemplate,
  instantiateWorkspaceTemplate,
  listTemplates,
  listWorkspaceTemplates,
  updateWorkspaceTemplate,
  type TemplateSummary,
  type UserTemplateSummary,
} from "../services/templates";
import type { SafeWorkflow } from "../services/workflows";
import type {
  CreateWorkspaceTemplateBody,
  InstantiateTemplateBody,
  InstantiateWorkspaceTemplateBody,
  UpdateWorkspaceTemplateBody,
} from "../validation/template.schemas";

export function listTemplatesController(_req: Request, res: Response<TemplateSummary[]>): void {
  res.json(listTemplates());
}

export async function instantiateTemplateController(
  req: Request<{ id: string }, unknown, InstantiateTemplateBody>,
  res: Response<SafeWorkflow>,
): Promise<void> {
  const workflow = await instantiateTemplate(currentUserId(req), req.params.id, req.body);
  res.status(201).json(workflow);
}

export async function listWorkspaceTemplatesController(
  req: Request,
  res: Response<UserTemplateSummary[]>,
): Promise<void> {
  const workspaceId = String(req.query.workspaceId);
  res.json(await listWorkspaceTemplates(currentUserId(req), workspaceId));
}

export async function createWorkspaceTemplateController(
  req: Request<unknown, unknown, CreateWorkspaceTemplateBody>,
  res: Response<UserTemplateSummary>,
): Promise<void> {
  const template = await createWorkspaceTemplate(currentUserId(req), req.body);
  res.status(201).json(template);
}

export async function updateWorkspaceTemplateController(
  req: Request<{ id: string }, unknown, UpdateWorkspaceTemplateBody>,
  res: Response<UserTemplateSummary>,
): Promise<void> {
  const template = await updateWorkspaceTemplate(currentUserId(req), req.params.id, req.body);
  res.json(template);
}

export async function deleteWorkspaceTemplateController(
  req: Request<{ id: string }>,
  res: Response,
): Promise<void> {
  await deleteWorkspaceTemplate(currentUserId(req), req.params.id);
  res.status(204).end();
}

export async function instantiateWorkspaceTemplateController(
  req: Request<{ id: string }, unknown, InstantiateWorkspaceTemplateBody>,
  res: Response<SafeWorkflow>,
): Promise<void> {
  const workflow = await instantiateWorkspaceTemplate(currentUserId(req), req.params.id, req.body);
  res.status(201).json(workflow);
}
