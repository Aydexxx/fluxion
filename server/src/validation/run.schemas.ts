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
  trigger: z.enum(["manual", "webhook", "schedule", "api"]).optional(),
  /** Free-text match against workflow name or run id. */
  search: z.string().trim().min(1).max(200).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Opaque keyset cursor from a previous page's `nextCursor`. */
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

/** GET /runs/:id/logs — optional incremental fetch of lines after a sequence number. */
export const runLogsQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
});

export const analyticsQuerySchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type RunIdParam = z.infer<typeof runIdParamSchema>;
export type ListWorkspaceRunsQuery = z.infer<typeof listWorkspaceRunsQuerySchema>;
export type RunLogsQuery = z.infer<typeof runLogsQuerySchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
