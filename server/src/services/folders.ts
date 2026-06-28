import type { Folder as PrismaFolder } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { requireWorkspaceMember, requireWorkspaceRole } from "./authorization";
import { NotFoundError } from "../errors/HttpError";

/** Client-safe folder view, with how many workflows are currently filed under it. */
export interface SafeFolder {
  id: string;
  workspaceId: string;
  name: string;
  workflowCount: number;
  createdAt: string;
  updatedAt: string;
}

function toSafe(folder: PrismaFolder & { _count: { workflows: number } }): SafeFolder {
  return {
    id: folder.id,
    workspaceId: folder.workspaceId,
    name: folder.name,
    workflowCount: folder._count.workflows,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

/** Lists a workspace's folders, alphabetically, with their workflow counts. Any member may view. */
export async function listFolders(workspaceId: string, userId: string): Promise<SafeFolder[]> {
  await requireWorkspaceMember(workspaceId, userId);
  const folders = await prisma.folder.findMany({
    where: { workspaceId },
    include: { _count: { select: { workflows: true } } },
    orderBy: { name: "asc" },
  });
  return folders.map(toSafe);
}

/** Creates a folder. Requires editor — the same tier that can create workflows. */
export async function createFolder(workspaceId: string, userId: string, name: string): Promise<SafeFolder> {
  await requireWorkspaceRole(workspaceId, userId, "editor");
  const folder = await prisma.folder.create({
    data: { workspaceId, name },
    include: { _count: { select: { workflows: true } } },
  });
  return toSafe(folder);
}

/** Loads a folder scoped to a workspace, throwing if it doesn't belong there. */
async function getWorkspaceFolder(workspaceId: string, folderId: string): Promise<PrismaFolder> {
  const folder = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!folder || folder.workspaceId !== workspaceId) throw new NotFoundError("Folder not found");
  return folder;
}

/**
 * Asserts `folderId` (when given) names a folder in `workspaceId`. Used by the
 * workflow service when filing a workflow into a folder, so a workflow can
 * never be moved into another tenant's folder.
 */
export async function assertFolderInWorkspace(workspaceId: string, folderId: string | null | undefined): Promise<void> {
  if (folderId == null) return;
  await getWorkspaceFolder(workspaceId, folderId);
}

/** Renames a folder. Requires editor. */
export async function renameFolder(
  workspaceId: string,
  folderId: string,
  userId: string,
  name: string,
): Promise<SafeFolder> {
  await requireWorkspaceRole(workspaceId, userId, "editor");
  await getWorkspaceFolder(workspaceId, folderId);
  const folder = await prisma.folder.update({
    where: { id: folderId },
    data: { name },
    include: { _count: { select: { workflows: true } } },
  });
  return toSafe(folder);
}

/**
 * Deletes a folder. Requires editor. Its workflows are un-filed, not deleted
 * (Workflow.folderId -> SetNull), so this is a low-risk, reversible action.
 */
export async function deleteFolder(workspaceId: string, folderId: string, userId: string): Promise<void> {
  await requireWorkspaceRole(workspaceId, userId, "editor");
  await getWorkspaceFolder(workspaceId, folderId);
  await prisma.folder.delete({ where: { id: folderId } });
}
