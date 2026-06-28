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
  // Pinned sample output, persisted as part of the definition. Optional and
  // freeform — it's only ever read back as that node's stand-in output.
  pinnedData: z.unknown().optional(),
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

/** Tags are normalized (trimmed + lowercased) by the service; cap count and length here. */
const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(20);

export const createWorkflowSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  name: z.string().trim().min(1, "Name is required").max(150, "Name is too long"),
  description: z.string().trim().max(2000, "Description is too long").optional(),
  /** Folder to file this workflow under at creation; omit to leave it unfiled. */
  folderId: z.string().min(1).optional(),
  tags: tagsSchema.optional(),
});

/** Workflow-level failure-alert config. `null` clears it. Email requires a `to`. */
export const failureNotifySchema = z
  .object({
    channel: z.enum(["slack", "email"]),
    credentialId: z.string().min(1, "A credential is required"),
    to: z.string().trim().max(320).optional(),
  })
  .refine((v) => v.channel !== "email" || (v.to && v.to.trim() !== ""), {
    message: "Email alerts need a recipient address",
    path: ["to"],
  })
  .nullable();

export const updateWorkflowSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150, "Name is too long").optional(),
    description: z.string().trim().max(2000, "Description is too long").nullable().optional(),
    isActive: z.boolean().optional(),
    definition: workflowDefinitionSchema.optional(),
    failureNotify: failureNotifySchema.optional(),
    /** Move into a folder, or `null` to un-file it. Omit to leave unchanged. */
    folderId: z.string().min(1).nullable().optional(),
    /** Replaces the full tag set. Omit to leave unchanged; `[]` clears all tags. */
    tags: tagsSchema.optional(),
  })
  .refine(hasAtLeastOneField, { message: "At least one field must be provided" });

export const listWorkflowsQuerySchema = z.object({
  workspaceId: z.string().min(1, "workspaceId query parameter is required"),
  /** Free-text match against workflow name or description. */
  search: z.string().trim().min(1).max(200).optional(),
  /** Filter to a single folder; the literal "none" means unfiled workflows. */
  folderId: z.string().min(1).optional(),
  tagId: z.string().min(1).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  sortBy: z.enum(["updatedAt", "createdAt", "name"]).default("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

/** Body for a manual run: an optional freeform trigger payload handed to the workflow. */
export const runWorkflowSchema = z.object({
  payload: z.unknown().optional(),
});

/**
 * Body for testing a single node in isolation. All fields are optional:
 *  - `config` overrides the saved node config (so unsaved editor edits are testable),
 *  - `trigger` is the sample trigger payload referenced via `{{ trigger.* }}`,
 *  - `sources` maps an upstream node id to the sample output to feed downstream.
 * Pinned data saved on the definition takes precedence over `sources` per node.
 */
export const testNodeSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  trigger: z.unknown().optional(),
  sources: z.record(z.string(), z.unknown()).optional(),
});

/** Body for publishing the current draft. An optional short note is stored on the version. */
export const publishWorkflowSchema = z.object({
  note: z.string().trim().max(200, "Note is too long").optional(),
});

export type PublishWorkflowInput = z.infer<typeof publishWorkflowSchema>;
export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;
export type TestNodeInput = z.infer<typeof testNodeSchema>;
export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuerySchema>;
