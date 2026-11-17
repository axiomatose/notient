import { Router } from "express";
import { HttpError } from "../errors.js";
import logger from "../utils/logger.js";
import multer from "multer";
import { z } from "zod";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// "" clears; omitted keys are left unchanged.
const avatarMetaSchema = z.object({
  avatarIcon: z.string().trim().max(48).nullable().optional(),
  avatarColor: z.string().trim().max(32).nullable().optional(),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AVATAR_BYTES,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(400, "Unsupported image type", "invalid_avatar_type"));
    }
  },
});

export function createProfileRouter({ repos, requireAuth, storage }) {
  const router = Router();

  router.get("/", requireAuth, (req, res, next) => {
    try {
      const record = repos.users.getProfile(req.auth.userId);
      if (!record) {
        throw new HttpError(404, "Profile not found", "profile_not_found");
      }

      res.json(formatProfileResponse(record));
    } catch (error) {
      next(error);
    }
  });

  router.get("/avatar", requireAuth, (req, res, next) => {
    try {
      const record = repos.users.getProfile(req.auth.userId);
      if (!record) {
        res.status(404).end();
        return;
      }

      if (!record.avatar_url) {
        res.status(404).end();
        return;
      }

      // Return redirect to stored avatar URL
      res.redirect(302, record.avatar_url);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/avatar",
    requireAuth,
    upload.single("avatar"),
    async (req, res, next) => {
      try {
        logger.info("Avatar upload request", {
          hasFile: !!req.file,
          file: req.file
            ? {
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
              }
            : null,
          auth: req.auth ? { userId: req.auth.userId } : null,
        });

        if (!req.file) {
          throw new HttpError(400, "No file uploaded", "no_file_uploaded");
        }

        // Upload avatar
        const avatarUrl = await storage.uploadProfileImage(
          req.auth.userId,
          req.file.buffer,
          req.file.mimetype,
        );

        logger.info("Avatar upload successful", { avatarUrl });

        // Update user record with avatar URL
        repos.users.updateProfile({
          id: req.auth.userId,
          avatar: { url: avatarUrl, mimeType: req.file.mimetype },
        });

        const record = repos.users.getProfile(req.auth.userId);
        if (!record) {
          throw new HttpError(404, "Profile not found", "profile_not_found");
        }

        res.json(formatProfileResponse(record));
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete("/avatar", requireAuth, async (req, res, next) => {
    try {
      // Delete stored avatar
      await storage.deleteProfileImage(req.auth.userId);

      // Update user record
      repos.users.clearAvatarUrl(req.auth.userId);

      const record = repos.users.getProfile(req.auth.userId);
      if (!record) {
        throw new HttpError(404, "Profile not found", "profile_not_found");
      }

      res.json(formatProfileResponse(record));
    } catch (error) {
      next(error);
    }
  });

  router.put("/", requireAuth, async (req, res, next) => {
    try {
      const { displayName, avatar } = req.body ?? {};

      const meta = await avatarMetaSchema
        .parseAsync(req.body ?? {})
        .catch(() => {
          throw new HttpError(400, "Invalid request body", "invalid_body");
        });
      const avatarIcon =
        meta.avatarIcon === undefined ? undefined : meta.avatarIcon || null;
      const avatarColor =
        meta.avatarColor === undefined ? undefined : meta.avatarColor || null;

      if (displayName !== undefined && displayName !== null) {
        if (typeof displayName !== "string") {
          throw new HttpError(
            400,
            "Invalid displayName",
            "invalid_display_name",
          );
        }
        if (displayName.trim().length > 120) {
          throw new HttpError(
            400,
            "Display name too long",
            "display_name_too_long",
          );
        }
      }

      // Handle avatar update via base64 (for backward compatibility)
      let avatarPayload;
      if (avatar !== undefined) {
        if (avatar === null) {
          // Delete stored avatar
          try {
            await storage.deleteProfileImage(req.auth.userId);
          } catch (err) {
            logger.error("Failed to delete avatar", err);
          }
          avatarPayload = null;
        } else if (avatar && typeof avatar === "string") {
          // Base64 string
          const mimeTypeMatch = avatar.match(/^data:image\/([a-zA-Z]+);base64,/);
          const mimeType = mimeTypeMatch 
            ? `image/${mimeTypeMatch[1]}`
            : "image/jpeg";
          
          if (!ALLOWED_MIME_TYPES.has(mimeType)) {
            throw new HttpError(
              400,
              "Unsupported image type",
              "invalid_avatar_type",
            );
          }
          
          const base64Data = avatar.replace(/^data:image\/([a-zA-Z]+);base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");
          
          if (!buffer.byteLength) {
            throw new HttpError(
              400,
              "Invalid avatar data",
              "invalid_avatar_data",
            );
          }
          if (buffer.byteLength > MAX_AVATAR_BYTES) {
            throw new HttpError(400, "Avatar too large", "avatar_too_large");
          }
          
          // Upload avatar
          const url = await storage.uploadProfileImage(req.auth.userId, buffer, mimeType);
          avatarPayload = { url, mimeType };
        } else if (
          avatar &&
          typeof avatar === "object" &&
          typeof avatar.data === "string" &&
          typeof avatar.mimeType === "string"
        ) {
          // Base64 object
          if (!ALLOWED_MIME_TYPES.has(avatar.mimeType)) {
            throw new HttpError(
              400,
              "Unsupported image type",
              "invalid_avatar_type",
            );
          }
          const buffer = Buffer.from(avatar.data, "base64");
          if (!buffer.byteLength) {
            throw new HttpError(
              400,
              "Invalid avatar data",
              "invalid_avatar_data",
            );
          }
          if (buffer.byteLength > MAX_AVATAR_BYTES) {
            throw new HttpError(400, "Avatar too large", "avatar_too_large");
          }
          
          // Upload avatar
          const url = await storage.uploadProfileImage(req.auth.userId, buffer, avatar.mimeType);
          avatarPayload = { url, mimeType: avatar.mimeType };
        } else if (
          avatar &&
          typeof avatar === "object" &&
          typeof avatar.url === "string"
        ) {
          // Already a URL (from upload endpoint)
          avatarPayload = avatar;
        } else {
          throw new HttpError(400, "Invalid avatar payload", "invalid_avatar");
        }
      }

      repos.users.updateProfile({
        id: req.auth.userId,
        avatarIcon,
        avatarColor,
        displayName:
          displayName === undefined
            ? undefined
            : displayName === null
              ? null
              : displayName.trim(),
        avatar: avatarPayload,
      });

      const record = repos.users.getProfile(req.auth.userId);
      if (!record) {
        throw new HttpError(404, "Profile not found", "profile_not_found");
      }

      res.json(formatProfileResponse(record));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function formatProfileResponse(record) {
  return {
    id: record.id,
    email: record.email,
    createdAt: record.created_at,
    displayName: record.display_name ?? null,
    avatarIcon: record.avatar_icon ?? null,
    avatarColor: record.avatar_color ?? null,
    avatar: record.avatar_url
      ? {
          url: record.avatar_url,
          mimeType: record.avatar_mime || "image/jpeg",
          updatedAt: record.avatar_updated_at ?? null,
        }
      : null,
  };
}
