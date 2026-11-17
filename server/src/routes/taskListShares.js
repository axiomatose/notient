import { Router } from "express";
import { HttpError } from "../errors.js";
import { createListAccess } from "../lib/listAccess.js";

export function createTaskListSharesRouter({ repos, requireAuth, notificationService }) {
  const router = Router();
  const access = createListAccess(repos);

  // The people on a list (its owner and who it is shared with), for anyone who can see it: assignee pickers read this.
  router.get("/members/:listId", requireAuth, async (req, res, next) => {
    try {
      const { listId } = req.params;
      if (!access.forList(listId, req.auth.userId)) {
        throw new HttpError(404, "Task list not found", "task_list_not_found");
      }
      res.json({ members: access.members(listId) });
    } catch (error) {
      next(error);
    }
  });

  // Get shares for a specific task list
  router.get("/list/:listId", requireAuth, async (req, res, next) => {
    try {
      const { listId } = req.params;
      
      // Don't verify list exists - shares can exist before list syncs
      // Just check if user owns list or has edit access
      const list = await repos.taskLists.findByIdOnly(listId);
      if (list && list.userId !== req.auth.userId) {
        const permission = await repos.taskListShares.canUserAccessList(listId, req.auth.userId);
        if (!permission || permission === 'view') {
          throw new HttpError(403, "Access denied", "access_denied");
        }
      }

      const shares = await repos.taskListShares.findByListId(listId);
      res.json({ shares });
    } catch (error) {
      next(error);
    }
  });

  // Get task lists shared with current user
  router.get("/shared-with-me", requireAuth, async (req, res, next) => {
    try {
      const { limit = 50, offset = 0, permission } = req.query;
      
      const sharedLists = await repos.taskListShares.getSharedListsForUser(req.auth.userId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        permission: permission || null,
      });

      res.json({ lists: sharedLists });
    } catch (error) {
      next(error);
    }
  });

  // Get task lists shared by current user
  router.get("/shared-by-me", requireAuth, async (req, res, next) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      
      const shares = await repos.taskListShares.findBySharedByUserId(req.auth.userId);
      res.json({ shares });
    } catch (error) {
      next(error);
    }
  });

  // Share a task list with another user
  router.post("/", requireAuth, async (req, res, next) => {
    try {
      const { listId, sharedWithUserEmail, permission = 'view' } = req.body;
      
      if (!listId || !sharedWithUserEmail) {
        throw new HttpError(400, "Missing required fields", "missing_fields");
      }

      if (!["view", "edit"].includes(permission)) {
        throw new HttpError(400, "Permission must be view or edit", "invalid_permission");
      }

      // Only a list's owner shares it (a share now grants access to its tasks).
      const list = repos.taskLists.findByIdOnly(listId);
      if (!list) {
        throw new HttpError(404, "Task list not found", "task_list_not_found");
      }
      if (list.userId !== req.auth.userId) {
        throw new HttpError(403, "Only list owner can share", "access_denied");
      }

      // Find user to share with
      const sharedWithUser = await repos.users.findByEmail(sharedWithUserEmail);
      if (!sharedWithUser) {
        throw new HttpError(404, "User not found", "user_not_found");
      }

      // Don't allow sharing with self
      if (sharedWithUser.id === req.auth.userId) {
        throw new HttpError(400, "Cannot share with yourself", "invalid_share_target");
      }

      // Check if already shared
      const existingShare = await repos.taskListShares.findByListAndUser(listId, sharedWithUser.id);
      if (existingShare) {
        throw new HttpError(409, "Task list already shared with this user", "already_shared");
      }

      const share = await repos.taskListShares.create({
        listId,
        sharedByUserId: req.auth.userId,
        sharedWithUserId: sharedWithUser.id,
        permission,
      });

      // Send Push Notification
      try {
        const sharer = await repos.users.findById(req.auth.userId);
        const name = sharer ? (sharer.displayName || sharer.email) : "Someone";
        const listName = list ? list.name : "a task list";

        await notificationService.sendPushNotification(
          sharedWithUser.id,
          "New Shared List",
          { 
            body: `${name} shared "${listName}" with you`,
            data: { url: `/tasks?list=${listId}` }
          }
        );
      } catch (err) {
        req.log?.error({ err }, "Failed to send push for list share");
      }

      res.status(201).json({ 
        share, 
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

      // Get share
      const share = await repos.taskListShares.findById(id);
      if (!share) {
        throw new HttpError(404, "Share not found", "share_not_found");
      }

      // Only list owner can modify permissions
      const list = await repos.taskLists.findByIdOnly(share.listId);
      if (!list || list.userId !== req.auth.userId) {
        throw new HttpError(403, "Only list owner can modify permissions", "access_denied");
      }

      const updatedShare = await repos.taskListShares.updatePermission(id, permission);
      res.json({ share: updatedShare });
    } catch (error) {
      next(error);
    }
  });

  // Remove share
  router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      
      // Get share
      const share = await repos.taskListShares.findById(id);
      if (!share) {
        throw new HttpError(404, "Share not found", "share_not_found");
      }

      // Only list owner or shared user can remove share
      const list = await repos.taskLists.findByIdOnly(share.listId);
      if (share.sharedWithUserId !== req.auth.userId && (!list || list.userId !== req.auth.userId)) {
        throw new HttpError(403, "Access denied", "access_denied");
      }

      await repos.taskListShares.delete(id);


      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Check if user has access to a task list
  router.get("/check-access/:listId", requireAuth, async (req, res, next) => {
    try {
      const { listId } = req.params;
      
      const list = await repos.taskLists.findByIdOnly(listId);
      if (!list) {
        throw new HttpError(404, "Task list not found", "task_list_not_found");
      }

      let access = null;
      
      // If user owns list, they have full access
      if (list.userId === req.auth.userId) {
        access = 'owner';
      } else {
        // Check if task list is shared with user
        access = await repos.taskListShares.canUserAccessList(listId, req.auth.userId);
      }

      res.json({ 
        hasAccess: !!access,
        permission: access,
        isOwner: list.userId === req.auth.userId,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
