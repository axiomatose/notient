import { Router } from "express";
import { HttpError } from "../errors.js";
import { createNotificationsHelper } from "../services/notificationsHelper.js";

export function createNotificationsRouter({ repos, requireAuth }) {
  const router = Router();
  const notificationsHelper = createNotificationsHelper({ repos });

  // Get all notifications (unified view)
  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const notifications = await notificationsHelper.getAllNotifications(req.auth.userId);
      res.json({ notifications });
    } catch (error) {
      next(error);
    }
  });

  // Mark all notifications as read
  router.patch("/read-all", requireAuth, async (req, res, next) => {
    try {
      await notificationsHelper.markAllAsRead(req.auth.userId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
