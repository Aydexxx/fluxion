import type { Notification as PrismaNotification, Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { NotFoundError } from "../errors/HttpError";
import {
  NOTIFICATION_NEW,
  NOTIFICATION_UNREAD,
  publishNotification,
} from "../realtime/notifications";

/**
 * Notification event keys. Kept deliberately small and quiet — only events a
 * person genuinely needs to know about land in their bell.
 */
export const NOTIFICATION_TYPES = {
  /** You were invited to a workspace. */
  workspaceInvited: "workspace.invited",
  /** A run you triggered failed terminally. */
  runFailed: "run.failed",
  /** Your role in a workspace changed. */
  roleChanged: "role.changed",
  /** You were @mentioned. */
  mention: "mention",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/** Client-safe notification view. */
export interface SafeNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  workspaceId: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

function toSafe(row: PrismaNotification): SafeNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    workspaceId: row.workspaceId,
    data: (row.data as Record<string, unknown> | null) ?? null,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  workspaceId?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * Persists a notification for a user and pushes it live over their Socket.IO
 * channel (new item + refreshed unread count). Delivery is best-effort; the
 * stored row is the source of truth and survives reloads. Returns the saved view.
 */
export async function createNotification(input: CreateNotificationInput): Promise<SafeNotification> {
  const row = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      workspaceId: input.workspaceId ?? null,
      data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  const safe = toSafe(row);
  publishNotification(input.userId, NOTIFICATION_NEW, safe);
  // The bell badge tracks unread; push the fresh count so every tab stays in sync.
  const count = await getUnreadCount(input.userId);
  publishNotification(input.userId, NOTIFICATION_UNREAD, { count });

  return safe;
}

export interface ListNotificationsFilters {
  /** When true, only unread notifications. */
  unreadOnly?: boolean;
  /** Opaque keyset cursor from a prior page's `nextCursor`. */
  cursor?: string;
  limit?: number;
}

export interface NotificationsPage {
  notifications: SafeNotification[];
  unreadCount: number;
  /** Pass back as `cursor` for the next page; null when there are no more. */
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Encodes a notification's (createdAt, id) as an opaque keyset cursor. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Lists a user's notifications newest-first (keyset paginated), with the unread count. */
export async function listNotifications(
  userId: string,
  filters: ListNotificationsFilters = {},
): Promise<NotificationsPage> {
  const take = Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const and: Prisma.NotificationWhereInput[] = [];
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (cursor) {
    and.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
      ],
    });
  }

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId,
        read: filters.unreadOnly ? false : undefined,
        ...(and.length ? { AND: and } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    }),
    getUnreadCount(userId),
  ]);

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

  return { notifications: page.map(toSafe), unreadCount, nextCursor };
}

/** Counts a user's unread notifications (drives the bell badge). */
export function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, read: false } });
}

/** Marks a single notification read. Scoped to its owner so users can't touch others'. */
export async function markRead(notificationId: string, userId: string): Promise<SafeNotification> {
  const existing = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!existing || existing.userId !== userId) throw new NotFoundError("Notification not found");

  const row = existing.read
    ? existing
    : await prisma.notification.update({ where: { id: notificationId }, data: { read: true } });

  publishNotification(userId, NOTIFICATION_UNREAD, { count: await getUnreadCount(userId) });
  return toSafe(row);
}

/** Marks every unread notification for a user read. Returns the count cleared. */
export async function markAllRead(userId: string): Promise<{ count: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
  publishNotification(userId, NOTIFICATION_UNREAD, { count: 0 });
  return { count: result.count };
}
