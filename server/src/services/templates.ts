import { Prisma } from "../generated/prisma/client";
import type { WorkspaceTemplate as PrismaWorkspaceTemplate } from "../generated/prisma/client";
import type { WorkflowDefinition } from "../dag/types";
import { validateDefinition } from "../dag/validateDefinition";
import { prisma } from "./prisma";
import { generateWebhookToken } from "./token";
import { requireWorkspaceMember, requireWorkspaceRole, resolveWorkflowWorkspaceId } from "./authorization";
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
  /** "builtin" for the seeded catalog, "custom" for user-created workspace templates. */
  kind: "builtin" | "custom";
}

/** A user-created, workspace-scoped template — a TemplateSummary plus provenance. */
export interface UserTemplateSummary extends TemplateSummary {
  kind: "custom";
  workspaceId: string;
  createdByName: string | null;
  createdAt: string;
}

function toSummary(template: WorkflowTemplate): TemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    nodeTypes: templateNodeTypes(template),
    definition: template.definition,
    kind: "builtin",
  };
}

export function listTemplates(): TemplateSummary[] {
  return TEMPLATES.map(toSummary);
}

/** The unique node types used by a definition, in first-appearance order, for gallery chips. */
function definitionNodeTypes(definition: WorkflowDefinition): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const node of definition.nodes) {
    if (seen.has(node.type)) continue;
    seen.add(node.type);
    ordered.push(node.type);
  }
  return ordered;
}

/**
 * Returns a deep copy of `definition` safe to store in a shared template:
 * credential bindings are cleared (a template must never carry a reference that
 * could resolve to another tenant's secret), and pinned sample data is dropped
 * (it may contain real outputs captured from a live run). Secrets themselves
 * never live in a definition — they're in the Credential table — so clearing the
 * `credentialId` binding is what severs the link.
 */
export function sanitizeDefinitionForTemplate(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    edges: definition.edges.map((edge) => ({ ...edge })),
    nodes: definition.nodes.map((node) => {
      const { pinnedData: _pinnedData, ...rest } = node;
      const config = { ...node.config };
      if ("credentialId" in config) config.credentialId = "";
      return { ...rest, config };
    }),
  };
}

function toUserTemplateSummary(template: PrismaWorkspaceTemplate): UserTemplateSummary {
  const definition = template.definition as unknown as WorkflowDefinition;
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    category: template.category,
    nodeTypes: definitionNodeTypes(definition),
    definition,
    kind: "custom",
    workspaceId: template.workspaceId,
    createdByName: template.createdByName,
    createdAt: template.createdAt.toISOString(),
  };
}

/** Lists a workspace's user-created templates, newest first. Requires membership. */
export async function listWorkspaceTemplates(userId: string, workspaceId: string): Promise<UserTemplateSummary[]> {
  await requireWorkspaceMember(workspaceId, userId);
  const templates = await prisma.workspaceTemplate.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
  return templates.map(toUserTemplateSummary);
}

export interface CreateWorkspaceTemplateInput {
  /** The workflow whose current draft definition is captured into the template. */
  workflowId: string;
  name: string;
  description?: string;
}

/**
 * Captures a workflow's current draft as a reusable workspace template. Requires
 * the editor role in the workflow's workspace. The definition is sanitized
 * (credential bindings + pinned data stripped) before it is persisted.
 */
export async function createWorkspaceTemplate(
  userId: string,
  input: CreateWorkspaceTemplateInput,
): Promise<UserTemplateSummary> {
  const workspaceId = await resolveWorkflowWorkspaceId(input.workflowId);
  await requireWorkspaceRole(workspaceId, userId, "editor");

  const workflow = await prisma.workflow.findUnique({
    where: { id: input.workflowId },
    select: { draftDefinition: true },
  });
  if (!workflow) throw new NotFoundError("Workflow not found");

  const rawDefinition = workflow.draftDefinition as unknown as WorkflowDefinition;
  const definition = sanitizeDefinitionForTemplate(rawDefinition);

  const author = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

  const template = await prisma.workspaceTemplate.create({
    data: {
      workspaceId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      definition: definition as unknown as Prisma.InputJsonValue,
      createdById: userId,
      createdByName: author?.name ?? null,
    },
  });
  return toUserTemplateSummary(template);
}

export interface UpdateWorkspaceTemplateInput {
  name?: string;
  description?: string | null;
}

/** Renames / re-describes a workspace template. Requires the editor role. */
export async function updateWorkspaceTemplate(
  userId: string,
  templateId: string,
  input: UpdateWorkspaceTemplateInput,
): Promise<UserTemplateSummary> {
  const existing = await prisma.workspaceTemplate.findUnique({ where: { id: templateId } });
  if (!existing) throw new NotFoundError("Template not found");
  await requireWorkspaceRole(existing.workspaceId, userId, "editor");

  const template = await prisma.workspaceTemplate.update({
    where: { id: templateId },
    data: {
      name: input.name?.trim() || undefined,
      description: input.description === undefined ? undefined : input.description?.trim() || null,
    },
  });
  return toUserTemplateSummary(template);
}

/** Deletes a workspace template. Requires the editor role. */
export async function deleteWorkspaceTemplate(userId: string, templateId: string): Promise<void> {
  const existing = await prisma.workspaceTemplate.findUnique({ where: { id: templateId } });
  if (!existing) throw new NotFoundError("Template not found");
  await requireWorkspaceRole(existing.workspaceId, userId, "editor");
  await prisma.workspaceTemplate.delete({ where: { id: templateId } });
}

/**
 * Instantiates a user template into a new workflow in the template's own
 * workspace. Any member may use it (read-tier action). The stored definition is
 * re-validated and re-sanitized defensively before it's persisted.
 */
export async function instantiateWorkspaceTemplate(
  userId: string,
  templateId: string,
  input: { name?: string },
): Promise<SafeWorkflow> {
  const template = await prisma.workspaceTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new NotFoundError("Template not found");
  await requireWorkspaceMember(template.workspaceId, userId);

  const definition = sanitizeDefinitionForTemplate(template.definition as unknown as WorkflowDefinition);
  const result = validateDefinition(definition);
  if (!result.valid) {
    throw new ValidationError(`Template "${templateId}" is invalid: ${result.errors.join("; ")}`);
  }

  const workflow = await prisma.workflow.create({
    data: {
      workspaceId: template.workspaceId,
      name: (input.name ?? template.name).trim() || template.name,
      description: template.description,
      webhookToken: generateWebhookToken(),
      draftDefinition: definition as unknown as Prisma.InputJsonValue,
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
    folder: null,
    tags: [],
    definition: workflow.draftDefinition as unknown as WorkflowDefinition,
    publishedDefinition: null,
    hasUnpublishedChanges: definition.nodes.length > 0,
    publishedVersion: null,
    failureNotify: null,
    webhookToken: workflow.webhookToken,
  };
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
    // A freshly instantiated template starts unfiled and untagged.
    folder: null,
    tags: [],
    definition: workflow.draftDefinition as unknown as WorkflowDefinition,
    publishedDefinition: null,
    hasUnpublishedChanges: template.definition.nodes.length > 0,
    publishedVersion: null,
    failureNotify: null,
    webhookToken: workflow.webhookToken,
  };
}
