import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../store/auth";
import { inviteApi } from "../../lib/api";
import { navigate } from "../../lib/router";
import { InvitesInbox } from "../InvitesInbox";
import { Avatar } from "../ui/Avatar";
import { LogoutIcon, MailIcon, UserIcon } from "../icons";

/**
 * The user/profile menu in the slim top bar: an avatar that opens a small menu
 * with the account identity, the personal invitations inbox (with an unread
 * badge), and sign-out. Personal account actions live here so the side panel's
 * Settings group stays purely workspace-admin.
 */
export function ProfileMenu() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  const [open, setOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [inviteCount, setInviteCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch pending invites once so the badge shows without opening the inbox.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const mine = await inviteApi.mine();
        if (alive) setInviteCount(mine.length);
      } catch {
        /* non-fatal — the badge just stays hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="relative flex size-8 items-center justify-center rounded-full transition-opacity hover:opacity-90"
      >
        <Avatar name={user?.name} email={user?.email} avatarUrl={user?.avatarUrl} size={32} />
        {inviteCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-white ring-2 ring-base">
            {inviteCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-60 overflow-hidden rounded-xl border border-white/10 bg-base/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-[13px] font-medium text-ink">{user?.name}</p>
            <p className="truncate text-[11.5px] text-faint">{user?.email}</p>
          </div>

          <div className="my-1 h-px bg-white/8" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/profile");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-white/5 hover:text-ink"
          >
            <UserIcon className="text-[14px]" /> Profile
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setInvitesOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-white/5 hover:text-ink"
          >
            <MailIcon className="text-[14px]" /> Invitations
            {inviteCount > 0 ? (
              <span className="ml-auto flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">
                {inviteCount}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-white/5 hover:text-ink"
          >
            <LogoutIcon className="text-[14px]" /> Sign out
          </button>
        </div>
      ) : null}

      <InvitesInbox open={invitesOpen} onClose={() => setInvitesOpen(false)} onCountChange={setInviteCount} />
    </div>
  );
}
