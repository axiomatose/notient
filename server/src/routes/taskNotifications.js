import { Router } from "express";
import { HttpError } from "../errors.js";

export function createTaskNotificationsRouter({ repos, requireAuth }) {
  const router = Router();

  // Get notifications for current user
  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const { limit = 50, offset = 0, unreadOnly = false, type } = req.query;
      
      const notifications = await repos.taskNotifications.findByUserId(req.auth.userId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        unreadOnly: unreadOnly === "true",
        type: type || null,
      });

      res.json({ notifications });
    } catch (error) {
      next(error);
    }
  });

  // Get scheduled notifications for current user
  router.get("/scheduled", requireAuth, async (req, res, next) => {
    try {
      const notifications = await repos.taskNotifications.getScheduledNotificationsForUser(
        req.auth.userId,
        Date.now()
      );

      res.json({ notifications });
    } catch (error) {
      next(error);
    }
  });

  // Mark notification as read
  router.patch("/:id/read", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      
      // First verify the notification belongs to the user
      const notification = await repos.taskNotifications.findById(id);
      if (!notification) {
        throw new HttpError(404, "Notification not found", "notification_not_found");
      }
      
      if (notification.userId !== req.auth.userId) {
        throw new HttpError(403, "Access denied", "access_denied");
      }

      await repos.taskNotifications.markAsRead(id);
      
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Mark all notifications as read for user
  router.patch("/read-all", requireAuth, async (req, res, next) => {
    try {
      await repos.taskNotifications.markAllAsRead(req.auth.userId);
      
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Delete notification
  router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      
      // First verify the notification belongs to the user
      const notification = await repos.taskNotifications.findById(id);
      if (!notification) {
        throw new HttpError(404, "Notification not found", "notification_not_found");
      }
      
      if (notification.userId !== req.auth.userId) {
        throw new HttpError(403, "Access denied", "access_denied");
      }

      await repos.taskNotifications.delete(id);
      
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Create notification (for testing/internal use)
  router.post("/", requireAuth, async (req, res, next) => {
    try {
      const { taskId, type, scheduledAt, payload } = req.body;
      
      if (!taskId || !type || !scheduledAt) {
        throw new HttpError(400, "Missing required fields", "missing_fields");
      }

      const notification = await repos.taskNotifications.create({
        taskId,
        userId: req.auth.userId,
        type,
        scheduledAt: parseInt(scheduledAt),
        payload: payload || null,
      });

      res.status(201).json({ notification });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
