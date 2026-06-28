import { z } from "zod";

/** GET /notifications — newest-first, keyset-paginated, optionally unread-only. */
export const listNotificationsQuerySchema = z.object({
  // Query strings arrive as strings; accept the usual truthy spellings.
  unread: z.enum(["true", "false", "1", "0"]).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const notificationIdParamSchema = z.object({
  id: z.string().min(1, "notification id is required"),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
