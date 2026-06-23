import type { Prisma, Workflow as PrismaWorkflow } from "../generated/prisma/client";
import type { WorkflowDefinition } from "../dag/types";
import { validateDefinition } from "../dag/validateDefinition";
import { prisma } from "./prisma";
import { generateWebhookToken } from "./token";
import { requireWorkspaceMember, requireWorkspaceRole, resolveWorkflowWorkspaceId } from "./authorization";
import { removeWorkflowSchedules, syncWorkflowSchedule } from "../scheduler/sync";
import { NotFoundError, ValidationError } from "../errors/HttpError";
import type { CreateWorkflowInput, UpdateWorkflowInput } from "../validation/workflow.schemas";

const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [] };

export interface SafeWorkflowSummary {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SafeWorkflow extends SafeWorkflowSummary {
  definition: WorkflowDefinition;
  /** Token for this workflow's inbound webhook URL (/webhooks/:token). */
  webhookToken: string | null;
}

function toSummary(workflow: PrismaWorkflow): SafeWorkflowSummary {
  return {
    id: workflow.id,
    workspaceId: workflow.workspaceId,
    name: workflow.name,
    description: workflow.description,
    isActive: workflow.isActive,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}

function toWorkflow(workflow: PrismaWorkflow): SafeWorkflow {
  return {
    ...toSummary(workflow),
    definition: workflow.definition as unknown as WorkflowDefinition,
    webhookToken: workflow.webhookToken,
  };
}

export async function createWorkflow(userId: string, input: CreateWorkflowInput): Promise<SafeWorkflow> {
  await requireWorkspaceMember(input.workspaceId, userId);
  const workflow = await prisma.workflow.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      // Every workflow gets a webhook token up front, so its webhook URL is
      // always available the moment a webhook node is added.
      webhookToken: generateWebhookToken(),
      // WorkflowDefinition is always JSON-serializable; the cast is a single boundary
      // crossing into Prisma's recursive Json input type, which TS can't verify structurally.
      definition: EMPTY_DEFINITION as unknown as Prisma.InputJsonValue,
    },
  });
  return toWorkflow(workflow);
}

export async function listWorkflows(workspaceId: string, userId: string): Promise<SafeWorkflowSummary[]> {
  await requireWorkspaceMember(workspaceId, userId);
  const workflows = await prisma.workflow.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  return workflows.map(toSummary);
}

export async function getWorkflow(workflowId: string, userId: string): Promise<SafeWorkflow> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceMember(workspaceId, userId);

  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new NotFoundError("Workflow not found");
  return toWorkflow(workflow);
}

export interface UpdateWorkflowResult {
  workflow: SafeWorkflow;
  warnings: string[];
}

export async function updateWorkflow(
  workflowId: string,
  userId: string,
  input: UpdateWorkflowInput,
): Promise<UpdateWorkflowResult> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  await requireWorkspaceRole(workspaceId, userId, "member");

  let warnings: string[] = [];
  if (input.definition) {
    const result = validateDefinition(input.definition);
    warnings = result.warnings;
    if (!result.valid) {
      throw new ValidationError(result.errors.join("; "));
    }
  }

  const workflow = await prisma.workflow.update({
    where: { id: workflowId },
    data: {
      name: input.name,
      description: input.description,
      isActive: input.isActive,
      definition: input.definition as Prisma.InputJsonValue | undefined,
    },
  });

  // Reconcile cron schedules: an isActive flip or a changed schedule node
  // (de)registers repeatable jobs accordingly.
  await syncWorkflowSchedule({
    id: workflow.id,
    isActive: workflow.isActive,
    definition: workflow.definition as unknown as WorkflowDefinition,
  });

  return { workflow: toWorkflow(workflow), warnings };
}

export async function deleteWorkflow(workflowId: string, userId: string): Promise<void> {
  const workspaceId = await resolveWorkflowWorkspaceId(workflowId);
  // Deleting a workflow is an admin-tier action; creating/editing is open to any member.
  await requireWorkspaceRole(workspaceId, userId, "admin");
  await prisma.workflow.delete({ where: { id: workflowId } });
  await removeWorkflowSchedules(workflowId);
}
