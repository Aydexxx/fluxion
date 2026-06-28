import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import { listTags, type SafeTag } from "../services/tags";

/** GET /workspaces/:id/tags -> every tag in the workspace, alphabetically (filter/autocomplete UI). */
export async function listWorkspaceTags(req: Request<{ id: string }>, res: Response<SafeTag[]>): Promise<void> {
  const tags = await listTags(req.params.id, currentUserId(req));
  res.json(tags);
}
