import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import { getWorkspaceAnalytics, type AnalyticsResult } from "../services/analytics";

/** GET /analytics?workspaceId=&from=&to= -> aggregated run metrics for a workspace. */
export async function getAnalyticsController(req: Request, res: Response<AnalyticsResult>): Promise<void> {
  // Shape is already guaranteed by validateQuery(analyticsQuerySchema).
  const q = req.query as Record<string, string | undefined>;
  const analytics = await getWorkspaceAnalytics(String(q.workspaceId), currentUserId(req), { from: q.from, to: q.to });
  res.json(analytics);
}
