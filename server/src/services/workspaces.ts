import type { Workspace as PrismaWorkspace, WorkspaceRole } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { requireWorkspaceRole } from "./authorization";

export interface SafeWorkspace {
  id: string;
  name: string;
  ownerId: string;
}

/** A workspace plus the requesting user's role in it (drives client-side RBAC gating). */
export interface SafeWorkspaceWithRole extends SafeWorkspace {
  role: WorkspaceRole;
}

export function toSafeWorkspace(workspace: PrismaWorkspace): SafeWorkspace {
  return { id: workspace.id, name: workspace.name, ownerId: workspace.ownerId };
}

/**
 * Lists every workspace the user is a member of (oldest first, so their default
 * workspace leads), each annotated with the user's role for UI gating.
 */
export async function listMyWorkspaces(userId: string): Promise<SafeWorkspaceWithRole[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { workspace: { id: "asc" } },
  });
  return memberships.map((m) => ({ ...toSafeWorkspace(m.workspace), role: m.role }));
}

/** Creates a user's first workspace, granting them the `owner` role. Called once at registration. */
export async function createDefaultWorkspace(userId: string, userName: string): Promise<SafeWorkspaceWithRole> {
  const workspace = await prisma.workspace.create({
    data: {
      name: `${userName}'s Workspace`,
      ownerId: userId,
      members: { create: { userId, role: "owner" } },
    },
  });
  return { ...toSafeWorkspace(workspace), role: "owner" };
}

/** Creates an additional workspace for an existing user, making them its owner. */
export async function createWorkspace(userId: string, name: string): Promise<SafeWorkspaceWithRole> {
  const workspace = await prisma.workspace.create({
    data: {
      name,
      ownerId: userId,
      members: { create: { userId, role: "owner" } },
    },
  });
  return { ...toSafeWorkspace(workspace), role: "owner" };
}

/** Permanently deletes a workspace and everything in it. Owner-only. */
export async function deleteWorkspace(workspaceId: string, userId: string): Promise<void> {
  await requireWorkspaceRole(workspaceId, userId, "owner");
  // Workflows, credentials, members and invites all cascade from Workspace.
  await prisma.workspace.delete({ where: { id: workspaceId } });
}
