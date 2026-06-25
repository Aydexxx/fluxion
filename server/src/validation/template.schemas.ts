import { z } from "zod";

/** Body for POST /templates/:id/instantiate — which workspace to create the workflow in. */
export const instantiateTemplateSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  name: z.string().trim().min(1, "Name is required").max(150, "Name is too long").optional(),
});

export type InstantiateTemplateBody = z.infer<typeof instantiateTemplateSchema>;
