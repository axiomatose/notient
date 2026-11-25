import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import rateLimit from 'express-rate-limit';
import { randomUUID } from "node:crypto";
import { createRepositories } from "./db/index.js";
import { createAuthRouter } from "./routes/auth.js";
import { createSyncRouter } from "./routes/sync.js";
import { createNotesRouter } from "./routes/notes.js";
import { createTaskListsRouter } from "./routes/taskLists.js";
import { createTaskSectionsRouter } from "./routes/taskSections.js";
import { createLiveHub } from "./lib/liveHub.js";
import { createLucideRouter } from "./routes/lucide.js";
import { createTasksRouter } from "./routes/tasks.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { isHttpError } from "./errors.js";
import { createProfileRouter } from "./routes/profile.js";
import { createUploadRouter } from "./routes/uploads.js";
import { createPushRouter } from "./routes/push.js";
import { createTaskNotificationsRouter } from "./routes/taskNotifications.js";
import { createTaskSharesRouter } from "./routes/taskShares.js";
import { createTaskAttachmentsRouter } from "./routes/taskAttachments.js";
import { createTaskListSharesRouter } from "./routes/taskListShares.js";
import { createNoteSharesRouter } from "./routes/noteShares.js";
import { createShareableLinksRouter } from "./routes/shareableLinks.js";
import { createImportExportRouter } from "./routes/import-export.js";
import { createPublicRouter } from "./routes/public.js";
import { createTaskListFoldersRouter } from "./routes/tasklistFolders.js";
import { createTemplatesRouter } from "./routes/templates.js";
import { createNoteFoldersRouter } from "./routes/noteFolders.js";
import { createSearchRouter } from "./routes/search.js";
import { createCalendarsRouter } from "./routes/calendars.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createSharesRouter } from "./routes/shares.js";
import { createNotificationService } from "./services/notificationService.js";
import { startScheduler } from "./scheduler.js";
import { createFileStorage } from "./lib/storage.js";

// The global limit per IP (config.rateLimits.api: 1000 requests per 15 minutes by default).
const apiLimiter = (config) => rateLimit({
  windowMs: config.rateLimits.api.windowMs,
  max: config.rateLimits.api.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/health')
});

// Add different rate limits for different endpoint types

const syncLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit sync operations
  standardHeaders: true,
  legacyHeaders: false,
});


export async function buildApp({ config, db }) {
  const app = express();

  app.set("trust proxy", 1);
  // 304 Not Modified breaks clients that read every reply as a body: this API
  // is a local dev server, so conditional requests buy nothing.
  app.set("etag", false);
  app.locals.db = db;
  app.locals.config = config;

  const httpLogger = pinoHttp({
    level: config.logLevel,
    genReqId(req, res) {
      const existingId =
        req.headers["x-request-id"]?.toString() ||
        req.headers["x-requestid"]?.toString();
      const id = existingId || randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    customLogLevel(res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customProps: () => ({ env: config.env }),
  });

  app.use(httpLogger);
  app.locals.logger = httpLogger.logger;

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", process.env.VITE_API_URL],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
          // This deployment serves the client and its API over plain HTTP on
          // the LAN/VPN; upgrading fetches to HTTPS would kill them all.
          upgradeInsecureRequests: null,
        },
      },
      crossOriginResourcePolicy: false,
    }),
  );
  app.use(compression());

  const repos = createRepositories(db, config);
  try {
    const moved = repos.notes.migrateLayout();
    if (moved > 0) console.log(`notes: moved ${moved} file(s) into the folder layout`);
  } catch (e) {
    console.error("notes: layout migration failed", e);
  }

  const requireAuth = createAuthMiddleware({ config, repos });

  const corsConfig = {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      // The server's own PUBLIC_URL serves the web app (WEB_DIST): same origin.
      if (config.corsOrigins.includes(origin) || origin === new URL(config.publicUrl).origin) {
        callback(null, true);
        return;
      }
      // Dev/test: the Exact web dev server and simulator drives come from
      // loopback ports not known ahead of time, and the LAN or VPN address (`web --lan`).
      if (
        config.env !== "production" &&
        /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)(:\d+)?$/.test(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "X-Skip-Auth-Redirect",
      "X-Device-Id",
      "x-skip-auth-redirect",
      "x-device-id",
      "X-CSRF-Token",
      "x-csrf-token",
      "X-XSRF-Token",
      "x-xsrf-token",
    ],
  };

  app.use(cors(corsConfig));

  app.use(express.json({ limit: "3mb" }));
  app.use(express.urlencoded({ extended: false }));

  const storage = createFileStorage(config);

  // Serve uploaded images. Keys are unique per upload, so responses are
  // immutable; the unguessable key is the access control (see
  // documentation/backend/storage.md).
  app.get("/files/*splat", (req, res) => {
    const key = req.params.splat.join("/");
    let path;
    try {
      path = storage.pathFor(key);
    } catch {
      res.status(400).json({ error: "invalid_key" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(path, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "not_found" });
    });
  });

  // Apply rate limiters before routes
  app.use('/sync', syncLimiter);
  app.use('/', apiLimiter(config));

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      env: config.env,
    });
  });

  // Live changes: after a write to a watched path, everyone who can see the list hears of it over a WebSocket.
  const liveHub = createLiveHub({ repos, logger: app.locals.logger });
  app.locals.liveHub = liveHub;
  app.use(liveHub.middleware);
  app.post("/live/ticket", requireAuth, (req, res) => {
    res.set("Cache-Control", "no-store").json({ ticket: liveHub.issue(req.auth.userId) });
  });

  app.use("/auth", createAuthRouter({ config, db, repos, requireAuth, storage }));
  
  app.use(
    "/notes",
    createImportExportRouter({
      repos,
      requireAuth,
      config,
    }),
  );

  app.use(
    "/notes",
    createNotesRouter({
      repos,
      requireAuth,
    }),
  );
  app.use(
    "/task-lists",
    createTaskListsRouter({
      repos,
      requireAuth,
    }),
  );
  app.use(
    "/task-sections",
    createTaskSectionsRouter({
      repos,
      requireAuth,
    }),
  );
  app.use(
    "/",
    createLucideRouter({
      requireAuth,
    }),
  );
  const notificationService = createNotificationService({ repos, config });
  app.use(
    "/tasks",
    createTasksRouter({
      repos,
      requireAuth,
      liveHub,
      notificationService,
    }),
  );
  app.use(
    "/sync",
    createSyncRouter({
      config,
      repos,
      requireAuth,
    }),
  );
  app.use(
    "/profile",
    createProfileRouter({
      repos,
      requireAuth,
      storage,
    }),
  );
  app.use(
    "/uploads",
    createUploadRouter({
      repos,
      requireAuth,
      storage,
    }),
  );


  // Start background scheduler
  startScheduler({ repos, notificationService });

  app.use(
    "/push",
    createPushRouter({
      requireAuth,
      config,
      notificationService,
    }),
  );
  app.use(
    "/task-notifications",
    createTaskNotificationsRouter({
      repos,
      requireAuth,
    }),
  );
  app.use(
    "/task-shares",
    createTaskSharesRouter({
      repos,
      requireAuth,
      notificationService,
    }),
  );
  app.use(
    "/task-attachments",
    createTaskAttachmentsRouter({
      repos,
      requireAuth,
      storage,
    }),
  );
  app.use(
    "/task-list-shares",
    createTaskListSharesRouter({
      repos,
      requireAuth,
      notificationService,
    }),
  );
  app.use("/templates", createTemplatesRouter({ repos, requireAuth }));
  app.use("/note-folders", createNoteFoldersRouter({ repos, requireAuth }));
  app.use("/search", createSearchRouter({ repos, requireAuth }));
  app.use(
    "/tasklist-folders",
    createTaskListFoldersRouter({
      repos,
      requireAuth,
    }),
  );
  app.use(
    "/note-shares",
    createNoteSharesRouter({
      repos,
      requireAuth,
      notificationService,
    }),
  );
  app.use(
    "/shareable-links",
    createShareableLinksRouter({
      repos,
      requireAuth,
    }),
  );
  app.use(
    "/public",
    createPublicRouter({
      repos,
    }),
  );
  app.use(
    "/calendars",
    createCalendarsRouter({
      repos,
      requireAuth,
      db,
    }),
  );
  app.use(
    "/notifications",
    createNotificationsRouter({
      repos,
      requireAuth,
    }),
  );
  app.use(
    "/shares",
    createSharesRouter({
      repos,
      requireAuth,
    }),
  );

  // Apply rate limiters (already applied above)

  app.use((req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((err, req, res, next) => {
    if (isHttpError(err)) {
      res
        .status(err.status)
        .json({ error: err.code, message: err.message ?? undefined });
      return;
    }

    const logger = req.log || app.locals.logger;
    if (logger) {
      logger.error({ err, requestId: req.id }, "Unhandled error");
    } else if (config.env !== "test") {
      // eslint-disable-next-line no-console
      console.error(err);
    }

    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
