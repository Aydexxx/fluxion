import { create } from "zustand";
import { notificationApi } from "../lib/api";
import { getSocket } from "../lib/socket";
import {
  NOTIFICATION_NEW,
  NOTIFICATION_UNREAD,
  type NotificationNewPayload,
  type NotificationUnreadPayload,
} from "../lib/realtimeEvents";
import type { AppNotification } from "../lib/types";

interface NotificationsState {
  items: AppNotification[];
  unreadCount: number;
  nextCursor: string | null;
  loading: boolean;
  /** True once the first page has been fetched (drives empty-vs-loading UI). */
  loaded: boolean;
  /** Fetch the first page + unread count and start listening for live pushes. */
  connect: () => Promise<void>;
  /** Stop listening (on sign-out) and clear state. */
  disconnect: () => void;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/** Merge a freshly pushed notification, de-duplicating by id (a reconnect can replay). */
function mergeNew(items: AppNotification[], incoming: AppNotification): AppNotification[] {
  if (items.some((n) => n.id === incoming.id)) return items;
  return [incoming, ...items];
}

export const useNotifications = create<NotificationsState>((set, get) => {
  // Socket handlers are attached once and reused; kept here so disconnect can detach them.
  let onNew: ((p: NotificationNewPayload) => void) | null = null;
  let onUnread: ((p: NotificationUnreadPayload) => void) | null = null;

  return {
    items: [],
    unreadCount: 0,
    nextCursor: null,
    loading: false,
    loaded: false,

    connect: async () => {
      // Idempotent: attach socket listeners once.
      if (!onNew) {
        const socket = getSocket();
        onNew = (n) => set((s) => ({ items: mergeNew(s.items, n), unreadCount: s.unreadCount + (n.read ? 0 : 1) }));
        onUnread = (p) => set({ unreadCount: p.count });
        socket.on(NOTIFICATION_NEW, onNew);
        socket.on(NOTIFICATION_UNREAD, onUnread);
      }

      set({ loading: true });
      try {
        const page = await notificationApi.list({ limit: 20 });
        set({
          items: page.notifications,
          unreadCount: page.unreadCount,
          nextCursor: page.nextCursor,
          loaded: true,
          loading: false,
        });
      } catch {
        set({ loading: false });
      }
    },

    disconnect: () => {
      const socket = getSocket();
      if (onNew) socket.off(NOTIFICATION_NEW, onNew);
      if (onUnread) socket.off(NOTIFICATION_UNREAD, onUnread);
      onNew = null;
      onUnread = null;
      set({ items: [], unreadCount: 0, nextCursor: null, loaded: false });
    },

    loadMore: async () => {
      const { nextCursor, loading } = get();
      if (!nextCursor || loading) return;
      set({ loading: true });
      try {
        const page = await notificationApi.list({ cursor: nextCursor, limit: 20 });
        set((s) => ({
          items: [...s.items, ...page.notifications],
          unreadCount: page.unreadCount,
          nextCursor: page.nextCursor,
          loading: false,
        }));
      } catch {
        set({ loading: false });
      }
    },

    markRead: async (id) => {
      const target = get().items.find((n) => n.id === id);
      if (!target || target.read) return;
      // Optimistic: flip it read and decrement, then reconcile if the call fails.
      set((s) => ({
        items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, s.unreadCount - 1),
      }));
      try {
        await notificationApi.markRead(id);
      } catch {
        set((s) => ({
          items: s.items.map((n) => (n.id === id ? { ...n, read: false } : n)),
          unreadCount: s.unreadCount + 1,
        }));
      }
    },

    markAllRead: async () => {
      const previous = get().items;
      set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })), unreadCount: 0 }));
      try {
        await notificationApi.markAllRead();
      } catch {
        set({ items: previous });
      }
    },
  };
});
