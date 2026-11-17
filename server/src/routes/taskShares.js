import { Router } from "express";
import { HttpError } from "../errors.js";

export function createTaskSharesRouter({ repos, requireAuth, notificationService }) {
  const router = Router();

  // Get shares for a specific task
  router.get("/task/:taskId", requireAuth, async (req, res, next) => {
    try {
      const { taskId } = req.params;
      
      // First verify user has access to the task
      const task = await repos.tasks.findAnyById(taskId);
      if (!task) {
        throw new HttpError(404, "Task not found", "task_not_found");
      }
      
      // Check if user owns the task or has edit access
      if (task.userId !== req.auth.userId) {
        const permission = await repos.taskShares.canUserAccessTask(taskId, req.auth.userId);
        if (!permission || permission === 'view') {
          throw new HttpError(403, "Access denied", "access_denied");
        }
      }

      const shares = await repos.taskShares.findByTaskId(taskId);
      res.json({ shares });
    } catch (error) {
      next(error);
    }
  });

  // Get tasks shared with current user
  router.get("/shared-with-me", requireAuth, async (req, res, next) => {
    try {
      const { limit = 50, offset = 0, permission } = req.query;
      
      const sharedTasks = await repos.taskShares.getSharedTasksForUser(req.auth.userId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        permission: permission || null,
      });

      res.json({ tasks: sharedTasks });
    } catch (error) {
      next(error);
    }
  });

  // Get tasks shared by current user
  router.get("/shared-by-me", requireAuth, async (req, res, next) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      
      const shares = await repos.taskShares.findBySharedByUserId(req.auth.userId);
      res.json({ shares });
    } catch (error) {
      next(error);
    }
  });

  // Share a task with another user
  router.post("/", requireAuth, async (req, res, next) => {
    try {
      const { taskId, sharedWithUserEmail, permission = 'view' } = req.body;
      
      if (!taskId || !sharedWithUserEmail) {
        throw new HttpError(400, "Missing required fields", "missing_fields");
      }

      // Verify task exists and user owns it
      const task = await repos.tasks.findAnyById(taskId);
      if (!task) {
        throw new HttpError(404, "Task not found", "task_not_found");
      }
      
      if (task.userId !== req.auth.userId) {
        throw new HttpError(403, "Only task owner can share", "access_denied");
      }

      // Find the user to share with
      const sharedWithUser = await repos.users.findByEmail(sharedWithUserEmail);
      if (!sharedWithUser) {
        throw new HttpError(404, "User not found", "user_not_found");
      }

      // Don't allow sharing with self
      if (sharedWithUser.id === req.auth.userId) {
        throw new HttpError(400, "Cannot share with yourself", "invalid_share_target");
      }

      // Check if already shared
      const existingShare = await repos.taskShares.findByTaskAndUser(taskId, sharedWithUser.id);
      if (existingShare) {
        throw new HttpError(409, "Task already shared with this user", "already_shared");
      }

      const share = await repos.taskShares.create({
        taskId,
        sharedByUserId: req.auth.userId,
        sharedWithUserId: sharedWithUser.id,
        permission,
      });


      // Create notification for shared user
      const shareNotification = await repos.taskNotifications.create({
        taskId,
        userId: sharedWithUser.id,
        type: 'assigned',
        scheduledAt: Date.now(),
        payload: {
          sharedBy: req.auth.userId,
          taskTitle: task.title,
          permission,
        },
      });

      // Send Push Notification
      try {
        const sharer = await repos.users.findById(req.auth.userId);
        const name = sharer ? (sharer.displayName || sharer.email) : "Someone";
        
        await notificationService.sendPushNotification(
          sharedWithUser.id,
          "New Task Assigned",
          { 
            body: `${name} assigned you: ${task.title}`,
            data: { url: `/tasks?id=${task.id}` }
          }
        );
      } catch (err) {
        // Log but don't fail the request
        req.log?.error({ err }, "Failed to send push for task share");
      }

      res.status(201).json({ 
        share, 
        notification: shareNotification,
        sharedWith: {
          id: sharedWithUser.id,
          email: sharedWithUser.email,
          displayName: sharedWithUser.displayName,
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // Update share permission
  router.patch("/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const { permission } = req.body;
      
      if (!permission) {
        throw new HttpError(400, "Permission is required", "missing_permission");
      }

      // Get the share
      const share = await repos.taskShares.findById(id);
      if (!share) {
        throw new HttpError(404, "Share not found", "share_not_found");
      }

      // Only the task owner can modify permissions
      const task = await repos.tasks.findAnyById(share.taskId);
      if (!task || task.userId !== req.auth.userId) {
        throw new HttpError(403, "Only task owner can modify permissions", "access_denied");
      }

      const updatedShare = await repos.taskShares.updatePermission(id, permission);
      res.json({ share: updatedShare });
    } catch (error) {
      next(error);
    }
  });

  // Remove share
  router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      
      // Get the share
      const share = await repos.taskShares.findById(id);
      if (!share) {
        throw new HttpError(404, "Share not found", "share_not_found");
      }

      // Only the task owner or the shared user can remove the share
      const task = await repos.tasks.findAnyById(share.taskId);
      if (!task) {
        throw new HttpError(404, "Task not found", "task_not_found");
      }

      if (task.userId !== req.auth.userId && share.sharedWithUserId !== req.auth.userId) {
        throw new HttpError(403, "Access denied", "access_denied");
      }

      await repos.taskShares.delete(id);


      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Check if user has access to a task
  router.get("/check-access/:taskId", requireAuth, async (req, res, next) => {
    try {
      const { taskId } = req.params;
      
      const task = await repos.tasks.findAnyById(taskId);
      if (!task) {
        throw new HttpError(404, "Task not found", "task_not_found");
      }

      let access = null;
      
      // If user owns the task, they have full access
      if (task.userId === req.auth.userId) {
        access = 'owner';
      } else {
        // Check if task is shared with user
        access = await repos.taskShares.canUserAccessTask(taskId, req.auth.userId);
      }

      res.json({ 
        hasAccess: !!access,
        permission: access,
        isOwner: task.userId === req.auth.userId,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
