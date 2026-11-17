import logger from "./utils/logger.js";
import { syncCalendarById } from "./lib/calendarSync.js";

export function startScheduler({ repos, notificationService }) {
  logger.info("Starting task notification scheduler...");

  // Subscribed calendars (ICS links, CalDAV accounts) refresh every 30 minutes.
  const SYNC_INTERVAL = 30 * 60 * 1000;
  async function syncSubscribedCalendars() {
    try {
      for (const id of repos.calendars.listSyncable()) {
        await syncCalendarById(repos, id);
      }
    } catch (error) {
      logger.error({ err: error }, "Calendar subscription sync failed");
    }
  }
  setTimeout(syncSubscribedCalendars, 60 * 1000).unref?.();
  setInterval(syncSubscribedCalendars, SYNC_INTERVAL).unref?.();

  // Check every minute
  const INTERVAL = 60 * 1000;

  async function checkReminderNotifications() {
    try {
      const now = Date.now();
      
      // Find tasks that need reminders and haven't been notified yet
      const tasks = repos.tasks.findTasksNeedingReminders(now);

      if (tasks.length > 0) {
        logger.info(`Found ${tasks.length} tasks needing reminders`);
      }

      for (const task of tasks) {
        try {
          logger.debug(`Processing reminder for task: ${task.id} (${task.title})`);
          
          // 1. Send Push Notification
          const pushResult = await notificationService.sendPushNotification(
            task.userId,
            "Task Reminder",
            { 
              body: task.title,
              data: { url: `/tasks?id=${task.id}` }
            }
          );
          
          logger.debug(`Push notification sent: ${pushResult.sent} successful, ${pushResult.failed} failed`);

          // 2. Record notification to prevent duplicate sends
          await repos.taskNotifications.create({
            taskId: task.id,
            userId: task.userId,
            type: 'reminder',
            scheduledAt: task.remindAt,
            sentAt: Date.now(),
            isRead: 0,
            payload: { taskTitle: task.title }
          });
          
          logger.info(`Reminder notification recorded for task: ${task.id}`);
        } catch (err) {
          logger.error({ err, taskId: task.id }, "Failed to process reminder notification");
        }
      }

    } catch (error) {
      logger.error({ err: error }, "Scheduler error (reminders)");
    }
  }

  async function checkDueTasks() {
    try {
      const now = Date.now();
      
      // Find tasks that are due and haven't been notified yet
      const tasks = repos.tasks.findTasksDueWithoutNotification(now);

      if (tasks.length > 0) {
        logger.info(`Found ${tasks.length} due tasks to notify`);
      }

      for (const task of tasks) {
        try {
          logger.debug(`Processing notification for task: ${task.id} (${task.title})`);
          // 1. Send Push Notification
          const pushResult = await notificationService.sendPushNotification(
            task.userId,
            "Task Due",
            { 
              body: task.title,
              data: { url: `/tasks?id=${task.id}` }
            }
          );
          
          logger.debug(`Push notification sent: ${pushResult.sent} successful, ${pushResult.failed} failed`);

          // 2. Record notification to prevent duplicate sends - use 'due_date' to match CHECK constraint
          await repos.taskNotifications.create({
            taskId: task.id,
            userId: task.userId,
            type: 'due_date',
            scheduledAt: task.dueAt,
            sentAt: Date.now(),
            isRead: 0,
            payload: { taskTitle: task.title }
          });
          
          logger.info(`Notification recorded for task: ${task.id}`);
        } catch (err) {
          logger.error({ err, taskId: task.id }, "Failed to process due task notification");
        }
      }

    } catch (error) {
      logger.error({ err: error }, "Scheduler error (due tasks)");
    }
  }

  async function checkOverdueTasks() {
    try {
      // Find tasks that are overdue and haven't been notified yet
      const tasks = repos.tasks.findOverdueTasks();

      if (tasks.length > 0) {
        logger.info(`Found ${tasks.length} overdue tasks to notify`);
      }

      for (const task of tasks) {
        try {
          logger.debug(`Processing overdue notification for task: ${task.id} (${task.title})`);
          
          // 1. Send Push Notification
          const pushResult = await notificationService.sendPushNotification(
            task.userId,
            "Task Overdue",
            { 
              body: `${task.title} is overdue`,
              data: { url: `/tasks?id=${task.id}` }
            }
          );
          
          logger.debug(`Push notification sent: ${pushResult.sent} successful, ${pushResult.failed} failed`);

          // 2. Record notification to prevent duplicate sends
          await repos.taskNotifications.create({
            taskId: task.id,
            userId: task.userId,
            type: 'overdue',
            scheduledAt: task.dueAt,
            sentAt: Date.now(),
            isRead: 0,
            payload: { taskTitle: task.title }
          });
          
          logger.info(`Overdue notification recorded for task: ${task.id}`);
        } catch (err) {
          logger.error({ err, taskId: task.id }, "Failed to process overdue task notification");
        }
      }

    } catch (error) {
      logger.error({ err: error }, "Scheduler error (overdue tasks)");
    }
  }

  async function runAllChecks() {
    await checkReminderNotifications();
    await checkDueTasks();
    await checkOverdueTasks();
  }

  // Run immediately then interval
  runAllChecks();
  setInterval(runAllChecks, INTERVAL);
}

