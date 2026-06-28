import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import * as workspaceService from "../services/workspaces";
import * as memberService from "../services/members";
import { listAuditLog, type AuditLogPage } from "../services/audit";
import type { SafeWorkspaceWithRole } from "../services/workspaces";
import type {
  MyInviteView,
  PendingInviteView,
  WorkspaceMemberView,
  WorkspaceMembersResult,
} from "../services/members";
import type { CreateWorkspaceInput, InviteInput, UpdateMemberRoleInput } from "../validation/workspace.schemas";

/** GET /workspaces -> the workspaces the authenticated user belongs to, each with their role. */
export async function listWorkspaces(req: Request, res: Response<SafeWorkspaceWithRole[]>): Promise<void> {
  const workspaces = await workspaceService.listMyWorkspaces(currentUserId(req));
  res.json(workspaces);
}

/** POST /workspaces -> create a new workspace owned by the caller. */
export async function createWorkspace(
  req: Request<unknown, unknown, CreateWorkspaceInput>,
  res: Response<SafeWorkspaceWithRole>,
): Promise<void> {
  const workspace = await workspaceService.createWorkspace(currentUserId(req), req.body.name);
  res.status(201).json(workspace);
}

/** DELETE /workspaces/:id -> permanently delete a workspace (owner only). */
export async function deleteWorkspace(req: Request<{ id: string }>, res: Response): Promise<void> {
  await workspaceService.deleteWorkspace(req.params.id, currentUserId(req));
  res.status(204).end();
}

/** GET /workspaces/:id/members -> members + pending invites (any member). */
export async function listMembers(
  req: Request<{ id: string }>,
  res: Response<WorkspaceMembersResult>,
): Promise<void> {
  const result = await memberService.listMembers(req.params.id, currentUserId(req));
  res.json(result);
}

/** POST /workspaces/:id/invites -> invite an email at a role (admin). */
export async function inviteMember(
  req: Request<{ id: string }, unknown, InviteInput>,
  res: Response<PendingInviteView>,
): Promise<void> {
  const invite = await memberService.inviteToWorkspace(req.params.id, currentUserId(req), req.body.email, req.body.role);
  res.status(201).json(invite);
}

/** POST /workspaces/:id/invites/:inviteId/resend -> refresh a pending invite (admin). */
export async function resendInvite(
  req: Request<{ id: string; inviteId: string }>,
  res: Response<PendingInviteView>,
): Promise<void> {
  const invite = await memberService.resendInvite(req.params.id, req.params.inviteId, currentUserId(req));
  res.json(invite);
}

/** DELETE /workspaces/:id/invites/:inviteId -> cancel a pending invite (admin). */
export async function revokeInvite(
  req: Request<{ id: string; inviteId: string }>,
  res: Response,
): Promise<void> {
  await memberService.revokeInvite(req.params.id, req.params.inviteId, currentUserId(req));
  res.status(204).end();
}

/** PATCH /workspaces/:id/members/:userId -> change a member's role (admin/owner rules). */
export async function updateMemberRole(
  req: Request<{ id: string; userId: string }, unknown, UpdateMemberRoleInput>,
  res: Response<WorkspaceMemberView>,
): Promise<void> {
  const member = await memberService.updateMemberRole(
    req.params.id,
    req.params.userId,
    req.body.role,
    currentUserId(req),
  );
  res.json(member);
}

/** DELETE /workspaces/:id/members/:userId -> remove a member (admin/owner rules). */
export async function removeMember(
  req: Request<{ id: string; userId: string }>,
  res: Response,
): Promise<void> {
  await memberService.removeMember(req.params.id, req.params.userId, currentUserId(req));
  res.status(204).end();
}

/** GET /workspaces/:id/audit-log -> a page of the workspace's audit log (admin/owner only). */
export async function getAuditLog(req: Request<{ id: string }>, res: Response<AuditLogPage>): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const page = await listAuditLog(req.params.id, currentUserId(req), {
    actorId: q.actorId,
    action: q.action,
    from: q.from,
    to: q.to,
    cursor: q.cursor,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  res.json(page);
}

/* ── Invitee side (the current user's own invites) ────────────────────────── */

/** GET /invites -> the current user's pending invites. */
export async function listMyInvites(req: Request, res: Response<MyInviteView[]>): Promise<void> {
  const invites = await memberService.listMyInvites(currentUserId(req));
  res.json(invites);
}

/** POST /invites/:inviteId/accept -> accept an invite, joining the workspace. */
export async function acceptInvite(
  req: Request<{ inviteId: string }>,
  res: Response<SafeWorkspaceWithRole>,
): Promise<void> {
  const workspace = await memberService.acceptInvite(req.params.inviteId, currentUserId(req));
  res.json(workspace);
}

/** POST /invites/:inviteId/decline -> decline an invite. */
export async function declineInvite(req: Request<{ inviteId: string }>, res: Response): Promise<void> {
  await memberService.declineInvite(req.params.inviteId, currentUserId(req));
  res.status(204).end();
}
