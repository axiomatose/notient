import { setVapidDetails, sendNotification } from "web-push";
import logger from "../utils/logger.js";

export function createNotificationService({ repos, config }) {
  // Initialize web-push
  if (config.vapid.publicKey && config.vapid.privateKey) {
    setVapidDetails(
      "mailto:admin@example.com", // TODO: Make configurable?
      config.vapid.publicKey,
      config.vapid.privateKey
    );
  } else {
    logger.warn("VAPID keys not configured, push notifications will not work");
  }

  return {
    async getBadgeCount(userId) {
      // 1. Count unread shares
      const unreadNoteShares = repos.noteShares.countUnread(userId);
      const unreadListShares = repos.taskListShares.countUnread(userId);
      const unreadTaskShares = repos.taskShares.countUnread(userId);

      // 2. Count unread task notifications
      const unreadTaskNotifications = repos.taskNotifications.countUnread(userId);

      const [notes, lists, tasks, taskNotifs] = await Promise.all([
        unreadNoteShares,
        unreadListShares,
        unreadTaskShares,
        unreadTaskNotifications
      ]);

      return notes + lists + tasks + taskNotifs;
    },

    async subscribe(userId, subscription) {
      return repos.pushSubscriptions.save({
        ...subscription,
        userId
      });
    },

    async unsubscribe(userId, endpoint) {
      return repos.pushSubscriptions.deleteByEndpoint(endpoint);
    },

    async sendPushNotification(userId, title, options = {}) {
      const subscriptions = await repos.pushSubscriptions.findByUser(userId);
      if (!subscriptions.length) return { sent: 0, failed: 0 };

      const badgeCount = await this.getBadgeCount(userId);
      const payload = JSON.stringify({
        title,
        ...options,
        badge: badgeCount
      });

      let sent = 0;
      let failed = 0;

      const promises = subscriptions.map(async (sub) => {
        try {
          await sendNotification({
            endpoint: sub.endpoint,
            keys: sub.keys
          }, payload);
          sent++;
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            // Subscription is invalid/expired
            await repos.pushSubscriptions.deleteByEndpoint(sub.endpoint);
          } else {
            logger.error({ err: error, userId }, "Failed to send push notification");
          }
          failed++;
        }
      });

      await Promise.all(promises);
      return { sent, failed };
    }
  };
}
