import { useEffect, useState } from "react";
import { errorMessage, workspaceApi } from "../lib/api";
import type { PendingInvite, Workspace, WorkspaceMember, WorkspaceRole } from "../lib/types";
import { canManageMembers, isOwner, ROLE_DESCRIPTIONS, roleLabel } from "../lib/permissions";
import { useAuth } from "../store/auth";
import { useToast } from "./ui/toast";
import { confirm } from "./ui/confirm";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Label, Select, TextInput } from "./Field";
import { Badge } from "./ui/Badge";
import { Avatar } from "./ui/Avatar";
import { MailIcon, PlusIcon, RotateIcon, TrashIcon } from "./icons";

interface Props {
  open: boolean;
  workspace: Workspace;
  onClose: () => void;
}

const ROLE_COLOR: Record<WorkspaceRole, string> = {
  owner: "#e0a33e",
  admin: "#b98aff",
  editor: "#5b8cff",
  viewer: "#8d8d99",
};

/** Roles the current actor may assign, never above their own. */
function assignableRoles(actorRole: WorkspaceRole): WorkspaceRole[] {
  const all: WorkspaceRole[] = ["viewer", "editor", "admin", "owner"];
  if (isOwner(actorRole)) return all;
  return all.filter((r) => r !== "owner"); // admins can grant up to admin
}

function RoleChip({ role }: { role: WorkspaceRole }) {
  return (
    <Badge color={ROLE_COLOR[role]} dot>
      {roleLabel(role)}
    </Badge>
  );
}

/**
 * Dedicated members & invites management surface for a workspace. Lists confirmed
 * members with editable roles, outstanding invites with resend/revoke, and an
 * invite form. All mutating controls are gated on the viewer's role — but the
 * server re-checks every action, so this is purely about not offering 403s.
 */
export function MembersManager({ open, workspace, onClose }: Props) {
  const toast = useToast();
  const currentUser = useAuth((s) => s.user);
  const refreshWorkspaces = useAuth((s) => s.refreshWorkspaces);

  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("viewer");
  const [busy, setBusy] = useState(false);

  const canManage = canManageMembers(workspace.role);
  const actorIsOwner = isOwner(workspace.role);

  const load = async () => {
    try {
      const data = await workspaceApi.members(workspace.id);
      setMembers(data.members);
      setInvites(data.invites);
    } catch (err) {
      toast.error(errorMessage(err, "Could not load members"));
    }
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        const data = await workspaceApi.members(workspace.id);
        if (!alive) return;
        setMembers(data.members);
        setInvites(data.invites);
      } catch (err) {
        if (alive) toast.error(errorMessage(err, "Could not load members"));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace.id]);

  const sendInvite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await workspaceApi.invite(workspace.id, email.trim(), inviteRole);
      setEmail("");
      toast.success(`Invited ${email.trim()}`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not send invite"));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: WorkspaceMember, role: WorkspaceRole) => {
    try {
      await workspaceApi.setRole(workspace.id, member.userId, role);
      toast.success(`${member.name} is now ${roleLabel(role).toLowerCase()}`);
      await load();
      // The actor may have changed their own role; refresh the switcher.
      if (member.userId === currentUser?.id) await refreshWorkspaces();
    } catch (err) {
      toast.error(errorMessage(err, "Could not change role"));
    }
  };

  const removeMember = async (member: WorkspaceMember) => {
    const ok = await confirm({
      title: `Remove ${member.name}?`,
      body: "They will immediately lose access to this workspace.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await workspaceApi.removeMember(workspace.id, member.userId);
      toast.success(`Removed ${member.name}`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove member"));
    }
  };

  const resend = async (invite: PendingInvite) => {
    try {
      await workspaceApi.resendInvite(workspace.id, invite.id);
      toast.success(`Invite to ${invite.email} refreshed`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not resend invite"));
    }
  };

  const revoke = async (invite: PendingInvite) => {
    try {
      await workspaceApi.revokeInvite(workspace.id, invite.id);
      toast.success(`Invite to ${invite.email} revoked`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not revoke invite"));
    }
  };

  /** Whether the actor may edit this particular member's role. */
  const canEditRole = (member: WorkspaceMember): boolean => {
    if (!canManage) return false;
    if (member.userId === currentUser?.id) return false; // can't change your own role here
    if (member.role === "owner" && !actorIsOwner) return false; // only owners manage owners
    return true;
  };

  const canRemove = (member: WorkspaceMember): boolean => {
    if (!canManage) return false;
    if (member.role === "owner" && !actorIsOwner) return false;
    return true;
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogHeader
        title="Members"
        description={`Manage who can access ${workspace.name}`}
        icon={<MailIcon />}
      />
      <DialogBody className="space-y-5">
        {canManage ? (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <Label>Invite by email</Label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <TextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void sendInvite();
                }}
                className="flex-1"
              />
              <Select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                className="sm:w-32"
              >
                {assignableRoles(workspace.role)
                  .filter((r) => r !== "owner")
                  .map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
              </Select>
              <Button onClick={() => void sendInvite()} loading={busy} disabled={!email.trim()}>
                <PlusIcon /> Invite
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-faint">{ROLE_DESCRIPTIONS[inviteRole]}</p>
          </div>
        ) : null}

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            Members {members ? `· ${members.length}` : ""}
          </h3>
          <ul className="space-y-1.5">
            {members?.map((member) => (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={member.name} email={member.email} avatarUrl={member.avatarUrl} size={30} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {member.name}
                      {member.userId === currentUser?.id ? <span className="text-faint"> (you)</span> : null}
                    </p>
                    <p className="truncate text-[11.5px] text-faint">{member.email}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canEditRole(member) ? (
                    <Select
                      value={member.role}
                      onChange={(e) => void changeRole(member, e.target.value as WorkspaceRole)}
                      className="h-8 py-0 text-[12px]"
                      aria-label={`Role for ${member.name}`}
                    >
                      {assignableRoles(workspace.role).map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <RoleChip role={member.role} />
                  )}
                  {canRemove(member) ? (
                    <button
                      type="button"
                      aria-label={`Remove ${member.name}`}
                      onClick={() => void removeMember(member)}
                      className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-danger"
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {invites.length > 0 ? (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Pending invites · {invites.length}
            </h3>
            <ul className="space-y-1.5">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-white/10 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink">{invite.email}</p>
                    <p className="truncate text-[11.5px] text-faint">
                      Invited{invite.invitedByName ? ` by ${invite.invitedByName}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <RoleChip role={invite.role} />
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          aria-label={`Resend invite to ${invite.email}`}
                          onClick={() => void resend(invite)}
                          className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
                        >
                          <RotateIcon />
                        </button>
                        <button
                          type="button"
                          aria-label={`Revoke invite to ${invite.email}`}
                          onClick={() => void revoke(invite)}
                          className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-danger"
                        >
                          <TrashIcon />
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!canManage ? (
          <p className="text-[11.5px] text-faint">
            You have view-only access to this list. Ask an admin or owner to manage members.
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
