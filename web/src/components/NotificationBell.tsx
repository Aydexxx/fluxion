import { useEffect, useRef, useState } from "react";
import { useNotifications } from "../store/notifications";
import { useAuth } from "../store/auth";
import { timeAgo } from "../lib/format";
import type { AppNotification } from "../lib/types";
import { AlertIcon, BellIcon, MailIcon, SparkIcon } from "./icons";

/** A quiet, type-appropriate glyph + accent for each notification kind. */
function iconFor(type: string): { Icon: typeof BellIcon; color: string } {
  switch (type) {
    case "run.failed":
      return { Icon: AlertIcon, color: "#ff7a7a" };
    case "workspace.invited":
      return { Icon: MailIcon, color: "#5b8cff" };
    case "role.changed":
      return { Icon: SparkIcon, color: "#b98aff" };
    default:
      return { Icon: BellIcon, color: "#8d8d99" };
  }
}

function NotificationRow({ n, onClick }: { n: AppNotification; onClick: () => void }) {
  const { Icon, color } = iconFor(n.type);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5"
    >
      <span
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
        style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
      >
        <Icon className="text-[14px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`truncate text-[12.5px] ${n.read ? "text-muted" : "font-medium text-ink"}`}>{n.title}</span>
          {!n.read ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
        </span>
        {n.body ? <span className="mt-0.5 line-clamp-2 block text-[11.5px] text-faint">{n.body}</span> : null}
        <span className="mt-0.5 block text-[10.5px] text-faint">{timeAgo(n.createdAt)}</span>
      </span>
    </button>
  );
}

/**
 * The top-nav notification bell: a quiet badge with an unread count and a
 * dropdown of recent notifications. Lives off the shared {@link useNotifications}
 * store, which is hydrated once and kept live over Socket.IO, so the badge
 * updates the moment an event arrives without any polling.
 */
export function NotificationBell() {
  const user = useAuth((s) => s.user);
  const items = useNotifications((s) => s.items);
  const unreadCount = useNotifications((s) => s.unreadCount);
  const nextCursor = useNotifications((s) => s.nextCursor);
  const loaded = useNotifications((s) => s.loaded);
  const connect = useNotifications((s) => s.connect);
  const disconnect = useNotifications((s) => s.disconnect);
  const loadMore = useNotifications((s) => s.loadMore);
  const markRead = useNotifications((s) => s.markRead);
  const markAllRead = useNotifications((s) => s.markAllRead);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Hydrate + subscribe while signed in; tear down on sign-out.
  useEffect(() => {
    if (!user) return;
    void connect();
    return () => disconnect();
  }, [user, connect, disconnect]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!user) return null;

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex items-center rounded-lg border border-white/8 p-1.5 text-muted transition-colors hover:border-white/14 hover:text-ink"
      >
        <BellIcon className="text-[16px]" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-80 overflow-hidden rounded-xl border border-white/10 bg-base/95 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
            <span className="text-[12px] font-semibold text-ink">Notifications</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[11px] text-muted transition-colors hover:text-ink"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-96 overflow-y-auto p-1.5">
            {!loaded ? (
              <p className="px-2.5 py-6 text-center text-[12px] text-faint">Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-2.5 py-8 text-center">
                <BellIcon className="mx-auto mb-2 text-[20px] text-faint" />
                <p className="text-[12px] text-faint">You're all caught up.</p>
              </div>
            ) : (
              <>
                {items.map((n) => (
                  <NotificationRow key={n.id} n={n} onClick={() => void markRead(n.id)} />
                ))}
                {nextCursor ? (
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    className="mt-1 w-full rounded-lg px-2.5 py-2 text-[11.5px] text-muted transition-colors hover:bg-white/5 hover:text-ink"
                  >
                    Load older
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
