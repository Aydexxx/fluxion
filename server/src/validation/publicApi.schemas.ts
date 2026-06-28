import { z } from "zod";

/** POST /api/v1/workflows/:id/runs — an optional JSON payload handed to the run's trigger. */
export const triggerRunSchema = z.object({
  payload: z.unknown().optional(),
});

export const publicWorkflowIdParamSchema = z.object({
  id: z.string().min(1, "workflow id is required"),
});

export const publicRunIdParamSchema = z.object({
  id: z.string().min(1, "run id is required"),
});

/** GET /api/v1/runs?workflowId=&limit= */
export const listPublicRunsQuerySchema = z.object({
  workflowId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type TriggerRunInput = z.infer<typeof triggerRunSchema>;
export type ListPublicRunsQuery = z.infer<typeof listPublicRunsQuerySchema>;
