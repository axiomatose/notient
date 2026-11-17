import { Router } from "express";
import { HttpError } from "../errors.js";

/**
 * Unified shares router for common share operations
 * This handles operations that work across different share types
 */
export function createSharesRouter({ repos, requireAuth }) {
  const router = Router();

  // Mark a share as read
  // The ID format will tell us which type of share it is
  router.patch("/:id/read", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      
      let share = null;
      let shareType = null;

      // Try to find the share in each repository
      // Check if it's a note share
      share = await repos.noteShares.findById(id);
      if (share) {
        shareType = 'note';
      } else {
        // Check if it's a task list share
        share = await repos.taskListShares.findById(id);
        if (share) {
          shareType = 'list';
        } else {
          // Check if it's a task share
          share = await repos.taskShares.findById(id);
          if (share) {
            shareType = 'task';
          }
        }
      }

      if (!share) {
        throw new HttpError(404, "Share not found", "share_not_found");
      }

      // Verify the user is the recipient of the share
      if (share.sharedWithUserId !== req.auth.userId) {
        throw new HttpError(403, "Access denied", "access_denied");
      }

      // Mark as read based on type
      switch (shareType) {
        case 'note':
          await repos.noteShares.markAsRead(id);
          break;
        case 'list':
          await repos.taskListShares.markAsRead(id);
          break;
        case 'task':
          await repos.taskShares.markAsRead(id);
          break;
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Dismiss a share (mark as read and potentially hide)
  // For now, this is the same as marking as read
  router.patch("/:id/dismiss", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      
      let share = null;
      let shareType = null;

      // Try to find the share in each repository
      share = await repos.noteShares.findById(id);
      if (share) {
        shareType = 'note';
      } else {
        share = await repos.taskListShares.findById(id);
        if (share) {
          shareType = 'list';
        } else {
          share = await repos.taskShares.findById(id);
          if (share) {
            shareType = 'task';
          }
        }
      }

      if (!share) {
        throw new HttpError(404, "Share not found", "share_not_found");
      }

      // Verify the user is the recipient of the share
      if (share.sharedWithUserId !== req.auth.userId) {
        throw new HttpError(403, "Access denied", "access_denied");
      }

      // Mark as read (dismiss) based on type
      switch (shareType) {
        case 'note':
          await repos.noteShares.markAsRead(id);
          break;
        case 'list':
          await repos.taskListShares.markAsRead(id);
          break;
        case 'task':
          await repos.taskShares.markAsRead(id);
          break;
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
