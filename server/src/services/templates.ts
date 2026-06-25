import { Prisma } from "../generated/prisma/client";
import type { WorkflowDefinition } from "../dag/types";
import { validateDefinition } from "../dag/validateDefinition";
import { prisma } from "./prisma";
import { generateWebhookToken } from "./token";
import { requireWorkspaceMember } from "./authorization";
import { NotFoundError, ValidationError } from "../errors/HttpError";
import { TEMPLATES, findTemplate, templateNodeTypes, type WorkflowTemplate } from "../templates/catalog";
import type { SafeWorkflow } from "./workflows";

/** Gallery-facing shape: metadata + the node types used + the full definition for preview. */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  nodeTypes: string[];
  definition: WorkflowDefinition;
}

function toSummary(template: WorkflowTemplate): TemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    nodeTypes: templateNodeTypes(template),
    definition: template.definition,
  };
}

export function listTemplates(): TemplateSummary[] {
  return TEMPLATES.map(toSummary);
}

export interface InstantiateTemplateInput {
  workspaceId: string;
  /** Optional override for the new workflow's name; defaults to the template name. */
  name?: string;
}

/**
 * Create a brand-new workflow in `workspaceId` pre-populated from a template.
 * The caller must be a member of the workspace. The template's definition is
 * re-validated defensively so a malformed catalog entry fails loudly rather than
 * persisting an invalid graph.
 */
export async function instantiateTemplate(
  userId: string,
  templateId: string,
  input: InstantiateTemplateInput,
): Promise<SafeWorkflow> {
  await requireWorkspaceMember(input.workspaceId, userId);

  const template = findTemplate(templateId);
  if (!template) throw new NotFoundError("Template not found");

  const result = validateDefinition(template.definition);
  if (!result.valid) {
    throw new ValidationError(`Template "${templateId}" is invalid: ${result.errors.join("; ")}`);
  }

  const workflow = await prisma.workflow.create({
    data: {
      workspaceId: input.workspaceId,
      name: (input.name ?? template.name).trim() || template.name,
      description: template.description,
      webhookToken: generateWebhookToken(),
      // Seeded into the draft, unpublished — the user reviews and publishes when ready.
      // WorkflowDefinition is JSON-serializable; this cast is the single boundary
      // crossing into Prisma's recursive Json input type, which TS can't verify.
      draftDefinition: template.definition as unknown as Prisma.InputJsonValue,
      publishedDefinition: Prisma.JsonNull,
    },
  });

  return {
    id: workflow.id,
    workspaceId: workflow.workspaceId,
    name: workflow.name,
    description: workflow.description,
    isActive: workflow.isActive,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
    definition: workflow.draftDefinition as unknown as WorkflowDefinition,
    publishedDefinition: null,
    hasUnpublishedChanges: template.definition.nodes.length > 0,
    publishedVersion: null,
    failureNotify: null,
    webhookToken: workflow.webhookToken,
  };
}
