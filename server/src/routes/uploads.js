import { Router } from "express";
import { HttpError } from "../errors.js";
import { fileTypeFromBuffer } from "file-type";
import logger from "../utils/logger.js";
import multer from "multer";
import { nanoid } from "nanoid";

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

const validateFileUpload = async (req, res, next) => {
  if (!req.file) {
    return next();
  }

  try {
    const type = await fileTypeFromBuffer(req.file.buffer);
    const realMime = type?.mime;

    if (!realMime || !ALLOWED_MIME_TYPES.has(realMime)) {
      logger.warn("File spoofing detected or unsupported type", {
        headerMime: req.file.mimetype,
        realMime,
      });
      return next(
        new HttpError(400, "Unsupported file type", "invalid_file_type"),
      );
    }

    // Store verified info
    req.file.verifiedMime = realMime;
    req.file.verifiedExt = type.ext;

    // Sanitize filename
    req.file.originalname = req.file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .substring(0, 255);

    next();
  } catch (error) {
    logger.error("File validation failed", error);
    next(new HttpError(400, "File validation failed", "validation_failed"));
  }
};

export function createUploadRouter({ repos, requireAuth, storage }) {
  const router = Router();

  // Upload image for notes (TipTap integration)
  router.post(
    "/images",
    requireAuth,
    upload.single("image"),
    validateFileUpload,
    async (req, res, next) => {
      try {
        logger.info("Upload request received", {
          hasFile: !!req.file,
          file: req.file
            ? {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
              }
            : null,
          body: req.body,
          auth: req.auth ? { userId: req.auth.userId } : null,
        });

        if (!req.file) {
          throw new HttpError(400, "No file uploaded", "no_file_uploaded");
        }

        // Generate unique filename with verified extension
        const fileExtension = req.file.verifiedExt || req.file.originalname.split(".").pop();
        const filename = `${nanoid()}.${fileExtension}`;

        // Use a unique note ID or generate one for temporary storage
        const noteId =
          req.body.noteId || `temp-${req.auth.userId}-${Date.now()}`;

        logger.info("Uploading note image", {
          noteId,
          filename,
          mimeType: req.file.mimetype,
        });

        const imageUrl = await storage.uploadNoteImage(
          noteId,
          filename,
          req.file.buffer,
        );

        logger.info("Upload successful", { imageUrl });

        res.json({
          success: 1,
          file: {
            url: imageUrl,
            name: filename,
            size: req.file.size,
            type: req.file.mimetype,
          },
        });
      } catch (error) {
        logger.error("Upload error", error);
        next(error);
      }
    },
  );

  // Upload by URL (for TipTap URL paste functionality)
  router.post("/images/by-url", requireAuth, async (req, res, next) => {
    try {
      logger.info("URL upload request", { body: req.body, auth: req.auth });

      const { url, noteId } = req.body;

      if (!url || typeof url !== "string") {
        throw new HttpError(400, "URL is required", "url_required");
      }

      // Simple validation for image URL
      try {
        const urlObj = new URL(url);
        if (!["http:", "https:"].includes(urlObj.protocol)) {
          throw new HttpError(
            400,
            "Invalid URL protocol",
            "invalid_url_protocol",
          );
        }
      } catch (e) {
        throw new HttpError(400, "Invalid URL format", "invalid_url_format");
      }

      // For now, just return the URL as-is
      // In a production environment, you might want to download and rehost the image
      logger.info("URL upload successful", { url });
      res.json({
        success: 1,
        file: {
          url: url,
        },
      });
    } catch (error) {
      logger.error("URL upload error", error);
      next(error);
    }
  });

  // Delete image (for cleanup)
  router.delete(
    "/images/:noteId/:filename",
    requireAuth,
    async (req, res, next) => {
      try {
        const { noteId, filename } = req.params;

        if (!noteId || !filename) {
          throw new HttpError(
            400,
            "Note ID and filename are required",
            "missing_params",
          );
        }

        await storage.deleteNoteImage(noteId, filename);

        res.json({ success: 1 });
      } catch (error) {
        next(error);
      }
    },
  );

  // Upload background image
  router.post(
    "/backgrounds",
    requireAuth,
    upload.single("background"),
    validateFileUpload,
    async (req, res, next) => {
      try {
        if (!req.file) {
          throw new HttpError(400, "No file uploaded", "no_file_uploaded");
        }

        const fileExtension = req.file.verifiedExt || req.file.originalname.split(".").pop();
        const filename = `${nanoid()}.${fileExtension}`;

        const result = await storage.uploadBackgroundImage(
          filename,
          req.file.buffer,
        );

        // Append cache-busting timestamp to URL
        const separator = result.url.includes('?') ? '&' : '?';
        const cacheBustedUrl = `${result.url}${separator}t=${result.uploadedAt}`;

        res.json({
          success: 1,
          file: {
            url: cacheBustedUrl,
            name: filename,
            size: req.file.size,
            uploadedAt: result.uploadedAt,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
