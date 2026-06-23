import { z } from "zod";
import { hasAtLeastOneField } from "./util";

const nodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const workflowNodeSchema = z.object({
  id: z.string().min(1, "Node id is required"),
  type: z.string().min(1, "Node type is required"),
  position: nodePositionSchema,
  config: z.record(z.string(), z.unknown()).default({}),
});

const workflowEdgeSchema = z.object({
  id: z.string().min(1, "Edge id is required"),
  source: z.string().min(1, "Edge source is required"),
  target: z.string().min(1, "Edge target is required"),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema).default([]),
  edges: z.array(workflowEdgeSchema).default([]),
});

export const createWorkflowSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  name: z.string().trim().min(1, "Name is required").max(150, "Name is too long"),
  description: z.string().trim().max(2000, "Description is too long").optional(),
});

export const updateWorkflowSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150, "Name is too long").optional(),
    description: z.string().trim().max(2000, "Description is too long").nullable().optional(),
    isActive: z.boolean().optional(),
    definition: workflowDefinitionSchema.optional(),
  })
  .refine(hasAtLeastOneField, { message: "At least one field must be provided" });

export const listWorkflowsQuerySchema = z.object({
  workspaceId: z.string().min(1, "workspaceId query parameter is required"),
});

/** Body for a manual run: an optional freeform trigger payload handed to the workflow. */
export const runWorkflowSchema = z.object({
  payload: z.unknown().optional(),
});

export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;
export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;
