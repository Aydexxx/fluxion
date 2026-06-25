import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import { instantiateTemplate, listTemplates, type TemplateSummary } from "../services/templates";
import type { SafeWorkflow } from "../services/workflows";
import type { InstantiateTemplateBody } from "../validation/template.schemas";

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
