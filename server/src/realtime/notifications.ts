/**
 * Per-user notification channel: the wire contract plus a tiny publisher "bus".
 *
 * Notifications are created in two processes — the API (invites, role changes)
 * and the worker (run failures) — so delivery can't be hard-wired to a single
 * `io` instance. Instead the notification *service* persists the row and then
 * calls {@link publishNotification}, which forwards to whatever publisher the
 * host process registered via {@link setNotificationPublisher} (a Redis emitter
 * in production). Tests leave it as the default no-op, so persistence is
 * exercisable without Redis or a socket server.
 */

/** Socket.IO room that scopes notifications to a single user (all their tabs). */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Server -> client: a freshly created notification. Payload is the `SafeNotification`. */
export const NOTIFICATION_NEW = "notification:new";

/** Server -> client: the user's unread count changed. Payload: `{ count }`. */
export const NOTIFICATION_UNREAD = "notification:unread";

/** Delivers a server->client event to a single user's room. */
export type NotificationPublisher = (userId: string, event: string, payload: unknown) => void;

const noop: NotificationPublisher = () => {};
let publisher: NotificationPublisher = noop;

/** Registers the process's notification publisher (wired to a Redis emitter in prod). */
export function setNotificationPublisher(fn: NotificationPublisher): void {
  publisher = fn;
}

/** Publishes a notification event to a user's channel. Best-effort; never throws. */
export function publishNotification(userId: string, event: string, payload: unknown): void {
  try {
    publisher(userId, event, payload);
  } catch {
    // Delivery is best-effort — the persisted row is the source of truth.
  }
}
