import { z } from "zod";

/** Accepts any string parseable as a date (ISO or otherwise), rejecting garbage. */
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid date" });

export const runIdParamSchema = z.object({
  id: z.string().min(1, "Run id is required"),
});

export const listWorkspaceRunsQuerySchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  status: z.enum(["queued", "running", "success", "failed"]).optional(),
  workflowId: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const analyticsQuerySchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type RunIdParam = z.infer<typeof runIdParamSchema>;
export type ListWorkspaceRunsQuery = z.infer<typeof listWorkspaceRunsQuerySchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
