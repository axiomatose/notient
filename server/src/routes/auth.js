import { Router } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import rateLimit from "express-rate-limit";
import { hashPassword, verifyPassword } from "../utils/passwords.js";
import { HttpError } from "../errors.js";
import { signAuthToken } from "../utils/jwt.js";
import { DEMO_EMAIL, DEMO_PASSWORD, seedNewUser } from "../lib/seedUser.js";

// Shared password policy for register and change-password.
const passwordPolicy = z.string().min(8).max(128);

const registerSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase().trim()),
  password: passwordPolicy,
  name: z.string().trim().min(2).max(100).optional(),
  deviceName: z.string().trim().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase().trim()),
  password: z.string().min(8).max(128),
  deviceId: z.string()
    .trim()
    .min(10)
    .max(64)
    .regex(/^[a-zA-Z0-9-_]+$/)
    .optional(),
  deviceName: z.string().trim().min(1).max(120).optional(),
  rememberMe: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordPolicy,
});

const DEFAULT_DEVICE_NAME = "Unnamed device";

function formatUserResponse(record) {
  return {
    id: record.id,
    email: record.email,
    createdAt: record.created_at,
    displayName: record.display_name ?? null,
    avatar: record.avatar_url
      ? {
          url: record.avatar_url,
          mimeType: record.avatar_mime || "image/jpeg",
          updatedAt: record.avatar_updated_at ?? null,
        }
      : null,
  };
}

export function createAuthRouter({ config, db, repos, requireAuth, storage }) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: config.rateLimits.login.windowMs,
    max: config.rateLimits.login.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res, next) => {
      next(
        new HttpError(
          429,
          "Too many login attempts. Please try again later.",
          "too_many_attempts",
        ),
      );
    },
  });

  // What the sign-in screen needs before anyone is signed in: whether sign-up is open and, on a demo server, the demo login.
  router.get("/options", (req, res) => {
    res.set("Cache-Control", "no-store").json({
      registration: config.registrationEnabled !== false,
      demo: config.seedDemoUser ? { email: DEMO_EMAIL, password: DEMO_PASSWORD } : null,
    });
  });

  router.post("/register", async (req, res, next) => {
    try {
      if (config.registrationEnabled === false) {
        throw new HttpError(403, "Registration is closed on this server", "registration_disabled");
      }
      const input = await registerSchema.parseAsync(req.body ?? {});
      const existingUser = repos.users.findByEmail(input.email);
      if (existingUser) {
        throw new HttpError(409, "Email already registered", "email_in_use");
      }

      const now = Date.now();
      const userRecord = {
        id: nanoid(),
        email: input.email,
        display_name: input.name || null,
        password_hash: await hashPassword(input.password),
        created_at: now,
      };

      const deviceRecord = {
        id: nanoid(),
        user_id: userRecord.id,
        name: input.deviceName || DEFAULT_DEVICE_NAME,
        last_seen: now,
      };

      const persistUser = db.transaction((user, device) => {
        repos.users.create(user);
        repos.devices.create(device);
      });

      persistUser(userRecord, deviceRecord);

      // Starter notes, lists and events (SEED_NEW_USERS=false turns this off). A failed seed never fails the sign-up.
      if (config.seedNewUsers) {
        try {
          await seedNewUser({ repos, storage, userId: userRecord.id, deviceId: deviceRecord.id });
        } catch (error) {
          req.log?.warn({ err: error }, "Starter content could not be created");
        }
      }

      const token = signAuthToken(
        { userId: userRecord.id, deviceId: deviceRecord.id },
        config,
      );

      res.status(201).json({
        token,
        user: formatUserResponse({
          ...userRecord,
          avatar_mime: null,
          avatar_updated_at: null,
        }),
        device: {
          id: deviceRecord.id,
          name: deviceRecord.name,
          lastSeen: deviceRecord.last_seen,
        },
        deviceId: deviceRecord.id,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        next(error);
        return;
      }

      if (error?.code === "SQLITE_CONSTRAINT_UNIQUE") {
        next(new HttpError(409, "Email already registered", "email_in_use"));
        return;
      }

      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid request body", "invalid_body"));
        return;
      }

      next(error);
    }
  });

  router.post(
    "/change-password",
    requireAuth,
    loginLimiter,
    async (req, res, next) => {
      try {
        const input = await changePasswordSchema.parseAsync(req.body ?? {});
        const userRecord = repos.users.findById(req.auth.userId);
        if (!userRecord) {
          throw new HttpError(401, "Invalid credentials", "invalid_credentials");
        }

        const currentMatches = await verifyPassword(
          userRecord.password_hash,
          input.currentPassword,
        );
        if (!currentMatches) {
          throw new HttpError(401, "Invalid credentials", "invalid_credentials");
        }

        repos.users.updatePasswordHash(
          userRecord.id,
          await hashPassword(input.newPassword),
        );

        res.json({ ok: true });
      } catch (error) {
        if (error instanceof HttpError) {
          next(error);
          return;
        }

        if (error instanceof z.ZodError) {
          next(new HttpError(400, "Invalid request body", "invalid_body"));
          return;
        }

        next(error);
      }
    },
  );

  router.post("/login", loginLimiter, async (req, res, next) => {
    try {
      const input = await loginSchema.parseAsync(req.body ?? {});
      const userRecord = repos.users.findByEmail(input.email);

      if (!userRecord) {
        throw new HttpError(401, "Invalid credentials", "invalid_credentials");
      }

      const passwordMatches = await verifyPassword(
        userRecord.password_hash,
        input.password,
      );

      if (!passwordMatches) {
        throw new HttpError(401, "Invalid credentials", "invalid_credentials");
      }

      const now = Date.now();
      const cutoff = now - config.deviceMaxAgeMs;
      repos.devices.purgeStale({ userId: userRecord.id, cutoff });

      let deviceRecord = null;
      if (input.deviceId) {
        const existingDevice = repos.devices.findById(input.deviceId);
        if (existingDevice && existingDevice.user_id === userRecord.id) {
          const updated = repos.devices.touch({
            id: existingDevice.id,
            userId: userRecord.id,
            name: input.deviceName,
            timestamp: now,
          });

          const name = input.deviceName || existingDevice.name;
          deviceRecord = {
            id: existingDevice.id,
            user_id: userRecord.id,
            name,
            last_seen: updated ? now : existingDevice.last_seen,
          };
        }
      }

      if (!deviceRecord) {
        const newDevice = {
          id: nanoid(),
          user_id: userRecord.id,
          name: input.deviceName || DEFAULT_DEVICE_NAME,
          last_seen: now,
        };
        repos.devices.create(newDevice);
        deviceRecord = newDevice;
      }

      const token = signAuthToken(
        { userId: userRecord.id, deviceId: deviceRecord.id },
        input.rememberMe ? { ...config, jwtExpiresIn: "3650d" } : config,
      );

      res.json({
        token,
        user: formatUserResponse(userRecord),
        device: {
          id: deviceRecord.id,
          name: deviceRecord.name,
          lastSeen: deviceRecord.last_seen,
        },
        deviceId: deviceRecord.id,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        next(error);
        return;
      }

      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Invalid request body", "invalid_body"));
        return;
      }

      next(error);
    }
  });

  return router;
}
