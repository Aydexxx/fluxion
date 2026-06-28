import { Router } from "express";
import {
  listNotificationsController,
  markAllReadController,
  markReadController,
  unreadCountController,
} from "../controllers/notifications.controller";
import { requireAuth } from "../middleware/auth";
import { validateParams, validateQuery } from "../middleware/validate";
import { listNotificationsQuerySchema, notificationIdParamSchema } from "../validation/notification.schemas";

const router = Router();

// All notification routes are scoped to the authenticated user (no workspace).
router.get("/", requireAuth, validateQuery(listNotificationsQuerySchema), listNotificationsController);
router.get("/unread-count", requireAuth, unreadCountController);
router.post("/read-all", requireAuth, markAllReadController);
router.post("/:id/read", requireAuth, validateParams(notificationIdParamSchema), markReadController);

export default router;
