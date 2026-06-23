import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import * as workspaceService from "../services/workspaces";
import type { SafeWorkspace } from "../services/workspaces";

/** GET /workspaces -> the workspaces the authenticated user belongs to. */
export async function listWorkspaces(req: Request, res: Response<SafeWorkspace[]>): Promise<void> {
  const workspaces = await workspaceService.listMyWorkspaces(currentUserId(req));
  res.json(workspaces);
}
