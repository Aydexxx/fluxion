import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import * as folderService from "../services/folders";
import type { SafeFolder } from "../services/folders";
import type { CreateFolderInput, RenameFolderInput } from "../validation/folder.schemas";

/** GET /workspaces/:id/folders -> the workspace's folders, with workflow counts. */
export async function listFolders(req: Request<{ id: string }>, res: Response<SafeFolder[]>): Promise<void> {
  const folders = await folderService.listFolders(req.params.id, currentUserId(req));
  res.json(folders);
}

/** POST /workspaces/:id/folders -> create a folder. */
export async function createFolder(
  req: Request<{ id: string }, unknown, CreateFolderInput>,
  res: Response<SafeFolder>,
): Promise<void> {
  const folder = await folderService.createFolder(req.params.id, currentUserId(req), req.body.name);
  res.status(201).json(folder);
}

/** PATCH /workspaces/:id/folders/:folderId -> rename a folder. */
export async function renameFolder(
  req: Request<{ id: string; folderId: string }, unknown, RenameFolderInput>,
  res: Response<SafeFolder>,
): Promise<void> {
  const folder = await folderService.renameFolder(req.params.id, req.params.folderId, currentUserId(req), req.body.name);
  res.json(folder);
}

/** DELETE /workspaces/:id/folders/:folderId -> delete a folder (its workflows are un-filed, not deleted). */
export async function deleteFolder(req: Request<{ id: string; folderId: string }>, res: Response): Promise<void> {
  await folderService.deleteFolder(req.params.id, req.params.folderId, currentUserId(req));
  res.status(204).end();
}
