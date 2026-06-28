import type { Invite as PrismaInvite, WorkspaceRole } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { ROLE_RANK, requireWorkspaceMember, requireWorkspaceRole } from "./authorization";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors/HttpError";
import { AUDIT_ACTIONS, safeRecordAudit } from "./audit";
import { createNotification, NOTIFICATION_TYPES } from "./notifications";

/** A confirmed workspace member, with the joined user identity. */
export interface WorkspaceMemberView {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
}

/** A pending (or answered) invite, for the members management screen. */
export interface PendingInviteView {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedByName: string | null;
  createdAt: string;
}

/** The full members screen payload: confirmed members + outstanding invites. */
export interface WorkspaceMembersResult {
  members: WorkspaceMemberView[];
  invites: PendingInviteView[];
}

/** An invite as seen by its recipient (the invitee side). */
export interface MyInviteView {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  invitedByName: string | null;
  createdAt: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPendingInviteView(invite: PrismaInvite): PendingInviteView {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    invitedByName: invite.invitedByName,
    createdAt: invite.createdAt.toISOString(),
  };
}

/** Lists a workspace's members and pending invites. Any member may view. */
export async function listMembers(workspaceId: string, userId: string): Promise<WorkspaceMembersResult> {
  await requireWorkspaceMember(workspaceId, userId);

  const [memberships, invites] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    }),
    prisma.invite.findMany({
      where: { workspaceId, status: "pending" },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Owners first, then by descending privilege, then name — a stable, readable order.
  const members: WorkspaceMemberView[] = memberships
    .map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl ?? null,
      role: m.role,
    }))
    .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name));

  return { members, invites: invites.map(toPendingInviteView) };
}

/**
 * Invites `email` to the workspace at `role`. Requires admin. You can never grant
 * a role above your own (so an admin can't mint an owner). Works whether or not
 * the invitee already has an account — the invite is keyed by email and they
 * accept it explicitly. Re-inviting an existing/declined email refreshes it
 * (acts as a resend).
 */
export async function inviteToWorkspace(
  workspaceId: string,
  userId: string,
  email: string,
  role: WorkspaceRole,
): Promise<PendingInviteView> {
  const actor = await requireWorkspaceRole(workspaceId, userId, "admin");
  if (ROLE_RANK[role] > ROLE_RANK[actor.role]) {
    throw new ForbiddenError("You cannot grant a role higher than your own");
  }

  const normalized = normalizeEmail(email);

  // Reject if the email already belongs to a confirmed member of this workspace.
  const existingUser = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (existingUser) {
    const membership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: existingUser.id, workspaceId } },
    });
    if (membership) throw new ValidationError("That person is already a member of this workspace");
  }

  const [inviter, workspace] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
  ]);

  // Upsert keeps one active invite per (workspace, email); re-inviting refreshes it.
  const invite = await prisma.invite.upsert({
    where: { workspaceId_email: { workspaceId, email: normalized } },
    create: { workspaceId, email: normalized, role, invitedByName: inviter?.name ?? null },
    update: { role, status: "pending", invitedByName: inviter?.name ?? null, createdAt: new Date(), respondedAt: null },
  });

  await safeRecordAudit({
    workspaceId,
    action: AUDIT_ACTIONS.memberInvited,
    actorId: userId,
    actorName: inviter?.name ?? null,
    targetType: "invite",
    targetId: invite.id,
    targetName: normalized,
    metadata: { role },
  });

  // Notify the invitee in-app when they already have an account (a brand-new
  // user has no one to notify yet — their invite is waiting on signup).
  if (existingUser) {
    await createNotification({
      userId: existingUser.id,
      type: NOTIFICATION_TYPES.workspaceInvited,
      title: `You were invited to ${workspace?.name ?? "a workspace"}`,
      body: inviter?.name ? `${inviter.name} invited you as ${role}.` : `You were invited as ${role}.`,
      workspaceId,
      data: { inviteId: invite.id, role },
    });
  }

  return toPendingInviteView(invite);
}

/** Loads an invite scoped to a workspace, throwing if it doesn't belong there. */
async function getWorkspaceInvite(workspaceId: string, inviteId: string): Promise<PrismaInvite> {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.workspaceId !== workspaceId) throw new NotFoundError("Invite not found");
  return invite;
}

/** Re-issues a pending invite (refreshes its timestamp). Requires admin. */
export async function resendInvite(
  workspaceId: string,
  inviteId: string,
  userId: string,
): Promise<PendingInviteView> {
  await requireWorkspaceRole(workspaceId, userId, "admin");
  await getWorkspaceInvite(workspaceId, inviteId);
  const invite = await prisma.invite.update({
    where: { id: inviteId },
    data: { status: "pending", createdAt: new Date(), respondedAt: null },
  });
  return toPendingInviteView(invite);
}

/** Cancels an outstanding invite. Requires admin. */
export async function revokeInvite(workspaceId: string, inviteId: string, userId: string): Promise<void> {
  await requireWorkspaceRole(workspaceId, userId, "admin");
  await getWorkspaceInvite(workspaceId, inviteId);
  await prisma.invite.delete({ where: { id: inviteId } });
}

/** Counts the owners of a workspace (used to protect the last owner). */
function countOwners(workspaceId: string): Promise<number> {
  return prisma.workspaceMember.count({ where: { workspaceId, role: "owner" } });
}

/**
 * Changes a member's role. Requires admin. Admins can manage everyone *except*
 * owners (only an owner can promote to / demote from owner), and nobody may
 * grant a role above their own or strand a workspace with zero owners.
 */
export async function updateMemberRole(
  workspaceId: string,
  targetUserId: string,
  newRole: WorkspaceRole,
  userId: string,
): Promise<WorkspaceMemberView> {
  const actor = await requireWorkspaceRole(workspaceId, userId, "admin");

  const target = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });
  if (!target) throw new NotFoundError("Member not found");

  // Only owners may manage owners or hand out the owner role.
  if ((target.role === "owner" || newRole === "owner") && actor.role !== "owner") {
    throw new ForbiddenError("Only an owner can manage owners");
  }
  if (ROLE_RANK[newRole] > ROLE_RANK[actor.role]) {
    throw new ForbiddenError("You cannot grant a role higher than your own");
  }
  if (target.role === "owner" && newRole !== "owner" && (await countOwners(workspaceId)) <= 1) {
    throw new ValidationError("A workspace must always have at least one owner");
  }

  const previousRole = target.role;
  const updated = await prisma.workspaceMember.update({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    data: { role: newRole },
  });

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });

  await safeRecordAudit({
    workspaceId,
    action: AUDIT_ACTIONS.memberRoleChanged,
    actorId: userId,
    targetType: "member",
    targetId: target.user.id,
    targetName: target.user.name,
    metadata: { from: previousRole, to: newRole },
  });

  // Tell the affected member their access changed (skip self-initiated changes).
  if (target.user.id !== userId) {
    await createNotification({
      userId: target.user.id,
      type: NOTIFICATION_TYPES.roleChanged,
      title: `Your role in ${workspace?.name ?? "a workspace"} changed`,
      body: `You are now ${newRole} (was ${previousRole}).`,
      workspaceId,
      data: { from: previousRole, to: newRole },
    });
  }

  return {
    userId: target.user.id,
    name: target.user.name,
    email: target.user.email,
    avatarUrl: target.user.avatarUrl ?? null,
    role: updated.role,
  };
}

/**
 * Removes a member from the workspace. Requires admin. Admins can remove anyone
 * except owners; only an owner can remove another owner, and never the last one.
 */
export async function removeMember(workspaceId: string, targetUserId: string, userId: string): Promise<void> {
  const actor = await requireWorkspaceRole(workspaceId, userId, "admin");

  const target = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    include: { user: { select: { name: true } } },
  });
  if (!target) throw new NotFoundError("Member not found");

  if (target.role === "owner" && actor.role !== "owner") {
    throw new ForbiddenError("Only an owner can remove an owner");
  }
  if (target.role === "owner" && (await countOwners(workspaceId)) <= 1) {
    throw new ValidationError("A workspace must always have at least one owner");
  }

  await prisma.workspaceMember.delete({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
  });

  await safeRecordAudit({
    workspaceId,
    action: AUDIT_ACTIONS.memberRemoved,
    actorId: userId,
    targetType: "member",
    targetId: targetUserId,
    targetName: target.user.name,
    metadata: { role: target.role },
  });
}

/* ── Invitee side ─────────────────────────────────────────────────────────── */

/** Lists the pending invites addressed to the current user that they haven't already joined. */
export async function listMyInvites(userId: string): Promise<MyInviteView[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new NotFoundError("User not found");

  const invites = await prisma.invite.findMany({
    where: {
      email: user.email,
      status: "pending",
      // Don't surface invites for a workspace they're already a member of.
      workspace: { members: { none: { userId } } },
    },
    include: { workspace: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return invites.map((invite) => ({
    id: invite.id,
    workspaceId: invite.workspaceId,
    workspaceName: invite.workspace.name,
    role: invite.role,
    invitedByName: invite.invitedByName,
    createdAt: invite.createdAt.toISOString(),
  }));
}

/** Loads a pending invite and asserts it is addressed to the current user. */
async function getMyPendingInvite(inviteId: string, userId: string): Promise<PrismaInvite> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new NotFoundError("User not found");

  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite) throw new NotFoundError("Invite not found");
  if (invite.email !== user.email) throw new ForbiddenError("This invite is addressed to a different email");
  if (invite.status !== "pending") throw new ValidationError("This invite is no longer pending");
  return invite;
}

/**
 * Accepts an invite: grants the current user membership at the invited role and
 * marks the invite accepted. Idempotent if they somehow already joined. Returns
 * the workspace they now have access to.
 */
export async function acceptInvite(
  inviteId: string,
  userId: string,
): Promise<{ id: string; name: string; ownerId: string; role: WorkspaceRole }> {
  const invite = await getMyPendingInvite(inviteId, userId);

  const existing = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } },
  });

  const [, workspace] = await prisma.$transaction([
    prisma.invite.update({ where: { id: invite.id }, data: { status: "accepted", respondedAt: new Date() } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: invite.workspaceId } }),
    ...(existing
      ? []
      : [prisma.workspaceMember.create({ data: { userId, workspaceId: invite.workspaceId, role: invite.role } })]),
  ]);

  // A brand-new join (not an idempotent re-accept) is the audit-worthy event.
  if (!existing) {
    await safeRecordAudit({
      workspaceId: invite.workspaceId,
      action: AUDIT_ACTIONS.memberAdded,
      actorId: userId,
      targetType: "member",
      targetId: userId,
      metadata: { role: invite.role, via: "invite" },
    });
  }

  return {
    id: workspace.id,
    name: workspace.name,
    ownerId: workspace.ownerId,
    role: existing ? existing.role : invite.role,
  };
}

/** Declines an invite. */
export async function declineInvite(inviteId: string, userId: string): Promise<void> {
  const invite = await getMyPendingInvite(inviteId, userId);
  await prisma.invite.update({ where: { id: invite.id }, data: { status: "declined", respondedAt: new Date() } });
}
