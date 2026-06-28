import { useEffect, useState } from "react";
import { errorMessage, inviteApi } from "../lib/api";
import type { MyInvite, WorkspaceRole } from "../lib/types";
import { roleLabel } from "../lib/permissions";
import { useAuth } from "../store/auth";
import { useToast } from "./ui/toast";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { MailIcon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Bubble the latest pending count up so the switcher badge stays in sync. */
  onCountChange?: (count: number) => void;
}

const ROLE_COLOR: Record<WorkspaceRole, string> = {
  owner: "#e0a33e",
  admin: "#b98aff",
  editor: "#5b8cff",
  viewer: "#8d8d99",
};

/** The invitee's inbox: accept or decline pending workspace invitations. */
export function InvitesInbox({ open, onClose, onCountChange }: Props) {
  const toast = useToast();
  const refreshWorkspaces = useAuth((s) => s.refreshWorkspaces);
  const setActiveWorkspace = useAuth((s) => s.setActiveWorkspace);

  const [invites, setInvites] = useState<MyInvite[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const mine = await inviteApi.mine();
      setInvites(mine);
      onCountChange?.(mine.length);
    } catch (err) {
      toast.error(errorMessage(err, "Could not load invites"));
    }
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        const mine = await inviteApi.mine();
        if (!alive) return;
        setInvites(mine);
        onCountChange?.(mine.length);
      } catch (err) {
        if (alive) toast.error(errorMessage(err, "Could not load invites"));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const accept = async (invite: MyInvite) => {
    setBusyId(invite.id);
    try {
      const workspace = await inviteApi.accept(invite.id);
      toast.success(`Joined ${workspace.name}`);
      await refreshWorkspaces(workspace.id);
      setActiveWorkspace(workspace.id);
      await load();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Could not accept invite"));
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (invite: MyInvite) => {
    setBusyId(invite.id);
    try {
      await inviteApi.decline(invite.id);
      toast.success(`Declined invite to ${invite.workspaceName}`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not decline invite"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="md">
      <DialogHeader title="Invitations" description="Workspaces you've been invited to" icon={<MailIcon />} />
      <DialogBody>
        {invites && invites.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-faint">You have no pending invitations.</p>
        ) : (
          <ul className="space-y-2">
            {invites?.map((invite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-ink">{invite.workspaceName}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
                    <Badge color={ROLE_COLOR[invite.role]}>{roleLabel(invite.role)}</Badge>
                    {invite.invitedByName ? <span>from {invite.invitedByName}</span> : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="secondary" onClick={() => void decline(invite)} disabled={busyId === invite.id}>
                    Decline
                  </Button>
                  <Button onClick={() => void accept(invite)} loading={busyId === invite.id}>
                    Accept
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
