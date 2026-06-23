import { type WorkspaceMember as PrismaWorkspaceMember, type WorkspaceRole } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { ForbiddenError, NotFoundError } from "../errors/HttpError";

/** Numeric privilege rank per role; higher can do everything a lower rank can. */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

function roleAtLeast(role: WorkspaceRole, minRole: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export function getMembership(workspaceId: string, userId: string): Promise<PrismaWorkspaceMember | null> {
  return prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } });
}

/** Throws `ForbiddenError` unless the user has any membership in the workspace. */
export async function requireWorkspaceMember(workspaceId: string, userId: string): Promise<PrismaWorkspaceMember> {
  const membership = await getMembership(workspaceId, userId);
  if (!membership) throw new ForbiddenError("You are not a member of this workspace");
  return membership;
}

/** Throws `ForbiddenError` unless the user's role in the workspace is at least `minRole`. */
export async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  minRole: WorkspaceRole,
): Promise<PrismaWorkspaceMember> {
  const membership = await requireWorkspaceMember(workspaceId, userId);
  if (!roleAtLeast(membership.role, minRole)) {
    throw new ForbiddenError(`This action requires the ${minRole} role or higher`);
  }
  return membership;
}

/** Resolves the workspace that owns a workflow, throwing `NotFoundError` if the workflow doesn't exist. */
export async function resolveWorkflowWorkspaceId(workflowId: string): Promise<string> {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId }, select: { workspaceId: true } });
  if (!workflow) throw new NotFoundError("Workflow not found");
  return workflow.workspaceId;
}
