import type { Workspace as PrismaWorkspace } from "../generated/prisma/client";
import { prisma } from "./prisma";

export interface SafeWorkspace {
  id: string;
  name: string;
  ownerId: string;
}

export function toSafeWorkspace(workspace: PrismaWorkspace): SafeWorkspace {
  return { id: workspace.id, name: workspace.name, ownerId: workspace.ownerId };
}

/** Lists every workspace the user is a member of, oldest first (their default workspace leads). */
export async function listMyWorkspaces(userId: string): Promise<SafeWorkspace[]> {
  const workspaces = await prisma.workspace.findMany({
    where: { members: { some: { userId } } },
    orderBy: { id: "asc" },
  });
  return workspaces.map(toSafeWorkspace);
}

/** Creates a user's first workspace, granting them the `owner` role. Called once at registration. */
export async function createDefaultWorkspace(userId: string, userName: string): Promise<SafeWorkspace> {
  const workspace = await prisma.workspace.create({
    data: {
      name: `${userName}'s Workspace`,
      ownerId: userId,
      members: { create: { userId, role: "owner" } },
    },
  });
  return toSafeWorkspace(workspace);
}
