import { Router } from "express";
import { HttpError } from "../errors.js";

export function createNoteSharesRouter({ repos, requireAuth, notificationService }) {
  const router = Router();

  // Get shares for a specific note
  router.get("/note/:noteId", requireAuth, async (req, res, next) => {
    try {
      const { noteId } = req.params;
      
      // Don't verify note exists - shares can exist before note syncs
      // Just check if user owns note or has edit access
      const note = await repos.notes.findByIdOnly(noteId);
      if (note && note.userId !== req.auth.userId) {
        const permission = await repos.noteShares.canUserAccessNote(noteId, req.auth.userId);
        if (!permission || permission === 'view') {
          throw new HttpError(403, "Access denied", "access_denied");
        }
      }

      const shares = await repos.noteShares.findByNoteId(noteId);
      res.json({ shares });
    } catch (error) {
      next(error);
    }
  });

  // Get notes shared with current user
  router.get("/shared-with-me", requireAuth, async (req, res, next) => {
    try {
      const { limit = 50, offset = 0, permission } = req.query;
      
      const sharedNotes = await repos.noteShares.getSharedNotesForUser(req.auth.userId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        permission: permission || null,
      });

      // The query returns raw rows, whose body column is empty (bodies live on
      // the filesystem); read each note's content for the recipient.
      const notes = sharedNotes.map((row) => {
        const full = repos.notes.findByIdOnly(row.id);
        return { ...row, body: full ? full.body : row.body, bodyMarkdown: full ? full.bodyMarkdown : "" };
      });

      res.json({ notes });
    } catch (error) {
      next(error);
    }
  });

  // Get notes shared by current user
  router.get("/shared-by-me", requireAuth, async (req, res, next) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      
      const shares = await repos.noteShares.findBySharedByUserId(req.auth.userId);
      res.json({ shares });
    } catch (error) {
      next(error);
    }
  });

  // Share a note with another user
  router.post("/", requireAuth, async (req, res, next) => {
    try {
      const { noteId, sharedWithUserEmail, permission = 'view' } = req.body;
      
      if (!noteId || !sharedWithUserEmail) {
        throw new HttpError(400, "Missing required fields", "missing_fields");
      }

      // Only a note's owner shares it: the note has to exist and be theirs.
      const note = repos.notes.findByIdOnly(noteId);
      if (!note) {
        throw new HttpError(404, "Note not found", "note_not_found");
      }
      if (note.userId !== req.auth.userId) {
        throw new HttpError(403, "Only note owner can share", "access_denied");
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
      const existingShare = await repos.noteShares.findByNoteAndUser(noteId, sharedWithUser.id);
      if (existingShare) {
        throw new HttpError(409, "Note already shared with this user", "already_shared");
      }

      const share = await repos.noteShares.create({
        noteId,
        sharedByUserId: req.auth.userId,
        sharedWithUserId: sharedWithUser.id,
        permission,
      });

      // Send Push Notification
      try {
        const sharer = await repos.users.findById(req.auth.userId);
        const name = sharer ? (sharer.displayName || sharer.email) : "Someone";
        const noteTitle = note ? note.title : "a note";
        
        await notificationService.sendPushNotification(
          sharedWithUser.id,
          "New Shared Note",
          { 
            body: `${name} shared "${noteTitle}" with you`,
            data: { url: `/notes?id=${noteId}` }
          }
        );
      } catch (err) {
        req.log?.error({ err }, "Failed to send push for note share");
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
      const share = await repos.noteShares.findById(id);
      if (!share) {
        throw new HttpError(404, "Share not found", "share_not_found");
      }

      // Only note owner can modify permissions
      const note = await repos.notes.findByIdOnly(share.noteId);
      if (!note || note.userId !== req.auth.userId) {
        throw new HttpError(403, "Only note owner can modify permissions", "access_denied");
      }

      const updatedShare = await repos.noteShares.updatePermission(id, permission);
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
      const share = await repos.noteShares.findById(id);
      if (!share) {
        throw new HttpError(404, "Share not found", "share_not_found");
      }

      // Only note owner or shared user can remove share
      const note = await repos.notes.findByIdOnly(share.noteId);
      if (share.sharedWithUserId !== req.auth.userId && (!note || note.userId !== req.auth.userId)) {
        throw new HttpError(403, "Access denied", "access_denied");
      }

      await repos.noteShares.delete(id);


      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Check if user has access to a note
  router.get("/check-access/:noteId", requireAuth, async (req, res, next) => {
    try {
      const { noteId } = req.params;
      
      const note = await repos.notes.findByIdOnly(noteId);
      if (!note) {
        throw new HttpError(404, "Note not found", "note_not_found");
      }

      let access = null;
      
      // If user owns note, they have full access
      if (note.userId === req.auth.userId) {
        access = 'owner';
      } else {
        // Check if note is shared with user
        access = await repos.noteShares.canUserAccessNote(noteId, req.auth.userId);
      }

      res.json({ 
        hasAccess: !!access,
        permission: access,
        isOwner: note.userId === req.auth.userId,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
