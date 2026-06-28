import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import {
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
  type NotificationsPage,
  type SafeNotification,
} from "../services/notifications";

/** GET /notifications?unread=&cursor=&limit= -> a page of the caller's notifications. */
export async function listNotificationsController(req: Request, res: Response<NotificationsPage>): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const page = await listNotifications(currentUserId(req), {
    unreadOnly: q.unread === "true" || q.unread === "1",
    cursor: q.cursor,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  res.json(page);
}

/** GET /notifications/unread-count -> the caller's unread count (drives the bell badge). */
export async function unreadCountController(req: Request, res: Response<{ count: number }>): Promise<void> {
  const count = await getUnreadCount(currentUserId(req));
  res.json({ count });
}

/** POST /notifications/:id/read -> mark one notification read. */
export async function markReadController(req: Request<{ id: string }>, res: Response<SafeNotification>): Promise<void> {
  const notification = await markRead(req.params.id, currentUserId(req));
  res.json(notification);
}

/** POST /notifications/read-all -> mark every unread notification read. */
export async function markAllReadController(req: Request, res: Response<{ count: number }>): Promise<void> {
  const result = await markAllRead(currentUserId(req));
  res.json(result);
}
