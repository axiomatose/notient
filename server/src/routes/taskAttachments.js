import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { HttpError } from "../errors.js";
import logger from "../utils/logger.js";
import { createListAccess } from "../lib/listAccess.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(400, "Unsupported file type", "invalid_file_type"));
    }
  },
});

export function createTaskAttachmentsRouter({ repos, requireAuth, storage }) {
  const router = Router();
  const access = createListAccess(repos);

  // The task, if this person may see it (or change it, when `writing`): its owner, or someone its list is shared with.
  function taskFor(taskId, me, writing) {
    const task = repos.tasks.findAnyById(taskId);
    const shared = task ? access.forTask(taskId, me) : null;
    if (!task || (!shared && task.userId !== me)) throw new HttpError(404, "Task not found", "task_not_found");
    if (shared && writing && !shared.write) throw new HttpError(403, "Access denied", "access_denied");
    return task;
  }

  // Get attachments for a task
  router.get("/task/:taskId", requireAuth, async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { type } = req.query;
      
      // First verify user has access to task
      const task = taskFor(taskId, req.auth.userId, false);

      const attachments = await repos.taskAttachments.findByTaskId(taskId, type || null);
      res.json({ attachments });
    } catch (error) {
      next(error);
    }
  });

  // Upload image attachment
  router.post(
    "/task/:taskId/images",
    requireAuth,
    upload.single("image"),
    async (req, res, next) => {
      try {
        const { taskId } = req.params;
        
        if (!req.file) {
          throw new HttpError(400, "No file uploaded", "no_file_uploaded");
        }

        // First verify user has edit access to task
        const task = taskFor(taskId, req.auth.userId, true);

        // Generate unique filename with original extension
        const fileExtension = req.file.originalname.split(".").pop();
        const filename = `${nanoid()}.${fileExtension}`;

        logger.info("Uploading task image", {
          taskId,
          filename,
          mimeType: req.file.mimetype,
        });

        const imageUrl = await storage.uploadTaskImage(
          filename,
          req.file.buffer,
        );

        logger.info("Task image upload successful", { imageUrl });

        const attachment = await repos.taskAttachments.createImage(
          taskId,
          `tasks/${filename}`,
          imageUrl,
          req.file.originalname,
          req.file.size,
          req.file.mimetype,
          req.auth.userId,
        );

        res.status(201).json({
          success: 1,
          attachment,
          file: {
            url: imageUrl,
            name: filename,
            size: req.file.size,
            type: req.file.mimetype,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // Upload file attachment
  router.post(
    "/task/:taskId/files",
    requireAuth,
    upload.single("file"),
    async (req, res, next) => {
      try {
        const { taskId } = req.params;
        
        if (!req.file) {
          throw new HttpError(400, "No file uploaded", "no_file_uploaded");
        }

        // First verify user has edit access to task
        const task = taskFor(taskId, req.auth.userId, true);

        // Generate unique filename with original extension
        const fileExtension = req.file.originalname.split(".").pop();
        const filename = `${nanoid()}.${fileExtension}`;

        const fileUrl = await storage.uploadTaskImage(
          filename,
          req.file.buffer,
        );

        const attachment = await repos.taskAttachments.createFile(
          taskId,
          `tasks/${filename}`,
          fileUrl,
          req.file.originalname,
          req.file.size,
          req.file.mimetype,
          req.auth.userId,
        );

        res.status(201).json({
          success: 1,
          attachment,
          file: {
            url: fileUrl,
            name: req.file.originalname,
            size: req.file.size,
            type: req.file.mimetype,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // Add location attachment
  router.post("/task/:taskId/locations", requireAuth, async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const { lat, lng, name } = req.body;
      
      if (!lat || !lng) {
        throw new HttpError(400, "Latitude and longitude are required", "missing_location");
      }

      // First verify user has edit access to task
      const task = taskFor(taskId, req.auth.userId, true);

      // Update task with location
      await repos.tasks.update(taskId, {
        locationName: name || null,
        locationLat: parseFloat(lat),
        locationLng: parseFloat(lng),
        updatedAt: Date.now(),
      });

      const attachment = await repos.taskAttachments.createLocation(
        taskId,
        parseFloat(lat),
        parseFloat(lng),
        name || null,
        req.auth.userId,
      );

      res.status(201).json({ attachment });
    } catch (error) {
      next(error);
    }
  });

  // Update location attachment
  router.patch("/:id/location", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const { lat, lng, name } = req.body;
      
      if (!lat || !lng) {
        throw new HttpError(400, "Latitude and longitude are required", "missing_location");
      }

      // Get attachment and verify access
      const attachment = await repos.taskAttachments.findById(id);
      if (!attachment) {
        throw new HttpError(404, "Attachment not found", "attachment_not_found");
      }

      if (attachment.type !== 'location') {
        throw new HttpError(400, "Not a location attachment", "invalid_attachment_type");
      }

      // Verify user has edit access to task
      const task = taskFor(attachment.taskId, req.auth.userId, true);

      // Update task location
      await repos.tasks.update(attachment.taskId, {
        locationName: name || null,
        locationLat: parseFloat(lat),
        locationLng: parseFloat(lng),
        updatedAt: Date.now(),
      });

      const updatedAttachment = await repos.taskAttachments.updateLocation(
        id,
        parseFloat(lat),
        parseFloat(lng),
        name || null,
      );

      res.json({ attachment: updatedAttachment });
    } catch (error) {
      next(error);
    }
  });

  // Delete attachment
  router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      
      // Get attachment and verify access
      const attachment = await repos.taskAttachments.findById(id);
      if (!attachment) {
        throw new HttpError(404, "Attachment not found", "attachment_not_found");
      }

      // Verify user has edit access to task
      const task = taskFor(attachment.taskId, req.auth.userId, true);

      // Delete stored file if it is an image or file
      if (attachment.type === 'image' || attachment.type === 'file') {
        if (attachment.filePath) {
          // Extract filename from path (tasks/filename)
          const filename = attachment.filePath.replace('tasks/', '');
          await storage.deleteTaskImage(filename);
        }
      }

      await repos.taskAttachments.delete(id);
      
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Get attachment stats for a task
  router.get("/task/:taskId/stats", requireAuth, async (req, res, next) => {
    try {
      const { taskId } = req.params;
      
      // Verify user has access to task
      const task = taskFor(taskId, req.auth.userId, false);

      const stats = await repos.taskAttachments.getAttachmentStats(taskId);
      res.json({ stats });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
