import { z } from "zod";

/** Body for POST /templates/:id/instantiate — which workspace to create the workflow in. */
export const instantiateTemplateSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  name: z.string().trim().min(1, "Name is required").max(150, "Name is too long").optional(),
});

export type InstantiateTemplateBody = z.infer<typeof instantiateTemplateSchema>;

/** Query for GET /templates/custom — which workspace's templates to list. */
export const listWorkspaceTemplatesSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
});

export type ListWorkspaceTemplatesQuery = z.infer<typeof listWorkspaceTemplatesSchema>;

/** Body for POST /templates/custom — capture a workflow as a reusable template. */
export const createWorkspaceTemplateSchema = z.object({
  workflowId: z.string().min(1, "workflowId is required"),
  name: z.string().trim().min(1, "Name is required").max(150, "Name is too long"),
  description: z.string().trim().max(2000, "Description is too long").optional(),
});

export type CreateWorkspaceTemplateBody = z.infer<typeof createWorkspaceTemplateSchema>;

/** Body for PATCH /templates/custom/:id — rename / re-describe. */
export const updateWorkspaceTemplateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150, "Name is too long").optional(),
    description: z.string().trim().max(2000, "Description is too long").nullable().optional(),
  })
  .refine((b) => b.name !== undefined || b.description !== undefined, {
    message: "Nothing to update",
  });

export type UpdateWorkspaceTemplateBody = z.infer<typeof updateWorkspaceTemplateSchema>;

/** Body for POST /templates/custom/:id/instantiate — optional name override. */
export const instantiateWorkspaceTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150, "Name is too long").optional(),
});

export type InstantiateWorkspaceTemplateBody = z.infer<typeof instantiateWorkspaceTemplateSchema>;
