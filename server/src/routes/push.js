import { Router } from "express";

export function createPushRouter({ requireAuth, notificationService }) {
  const router = Router();

  router.post("/subscribe", requireAuth, async (req, res, next) => {
    try {
      const subscription = req.body.subscription;
      if (!subscription) {
        return res.status(400).json({ error: "missing_subscription" });
      }

      await notificationService.subscribe(req.auth.userId, subscription);
      res.status(201).json({ message: "subscribed" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/unsubscribe", requireAuth, async (req, res, next) => {
    try {
      const { endpoint } = req.body;
      if (!endpoint) {
        return res.status(400).json({ error: "missing_endpoint" });
      }

      await notificationService.unsubscribe(req.auth.userId, endpoint);
      res.json({ message: "unsubscribed" });
    } catch (error) {
      next(error);
    }
  });

  router.get("/badge", requireAuth, async (req, res, next) => {
    try {
      const count = await notificationService.getBadgeCount(req.auth.userId);
      res.json({ count });
    } catch (error) {
      next(error);
    }
  });

  // Test endpoint to trigger a push to oneself
  router.post("/test", requireAuth, async (req, res, next) => {
      try {
          const result = await notificationService.sendPushNotification(
              req.auth.userId,
              "Test Notification",
              { body: "This is a test notification from Notient!" }
          );
          res.json(result);
      } catch (error)  {
          next(error);
      }
  });

  return router;
}
