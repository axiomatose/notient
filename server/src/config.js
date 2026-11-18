import "dotenv/config";
import { resolve, join } from "node:path";

const DEFAULTS = {
  env: "development",
  host: "0.0.0.0",
  port: 3001,
  jwtExpiresIn: "12h",
  dataDir: "data",
  dbFilename: "app.db",
  corsOrigins: ["http://localhost:4173", "http://localhost:5173"],
  logLevel: "info",
  loginRateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 5,
  },
  apiRateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 1000,
  },
  sqliteJournalMode: "DELETE",
};

export function loadConfig() {
  const env = process.env.NODE_ENV?.trim() || DEFAULTS.env;
  const host = process.env.HOST?.trim() || DEFAULTS.host;

  const port = Number.parseInt(process.env.PORT || "", 10);
  const resolvedPort = Number.isFinite(port) ? port : DEFAULTS.port;

  const dataDir = resolve(
    process.cwd(),
    process.env.DATA_DIR?.trim() || DEFAULTS.dataDir,
  );

  const dbPath = process.env.DB_PATH?.trim()
    ? resolve(process.cwd(), process.env.DB_PATH.trim())
    : join(dataDir, DEFAULTS.dbFilename);

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    if (env === "production") {
      throw new Error("JWT_SECRET must be set in production");
    }
    console.warn(
      "Warning: JWT_SECRET not provided; using insecure default for development only.",
    );
  }

  return {
    env,
    host,
    port: resolvedPort,
    dbPath,
    jwtSecret: jwtSecret || "insecure-development-secret",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || DEFAULTS.jwtExpiresIn,
    dataDir,
    notesDir: join(dataDir, "notes"),
    deviceMaxAgeMs:
      Number.parseInt(process.env.DEVICE_MAX_AGE_MS || "", 10) ||
      1000 * 60 * 60 * 24 * 30,
    corsOrigins: parseCorsOrigins(
      process.env.CORS_ORIGINS,
      DEFAULTS.corsOrigins,
    ),
    publicUrl:
      process.env.PUBLIC_URL?.trim() || `http://localhost:${resolvedPort}`,
    // Starter notes, lists and events for each new account; the demo account (demo@demo.com) only when asked.
    seedNewUsers: process.env.SEED_NEW_USERS?.trim().toLowerCase() !== "false",
    // REGISTRATION_ENABLED=false closes sign-up (sign-in still works).
    registrationEnabled: process.env.REGISTRATION_ENABLED?.trim().toLowerCase() !== "false",
    seedDemoUser: process.env.SEED_DEMO_USER?.trim().toLowerCase() === "true",
    logLevel: process.env.LOG_LEVEL?.trim() || DEFAULTS.logLevel,
    rateLimits: {
      login: {
        windowMs:
          Number.parseInt(process.env.LOGIN_RATE_WINDOW_MS || "", 10) ||
          DEFAULTS.loginRateLimit.windowMs,
        max:
          Number.parseInt(process.env.LOGIN_RATE_MAX || "", 10) ||
          DEFAULTS.loginRateLimit.max,
      },
      // Every route from one IP (API_RATE_MAX requests per window).
      api: {
        windowMs: DEFAULTS.apiRateLimit.windowMs,
        max:
          Number.parseInt(process.env.API_RATE_MAX || "", 10) ||
          DEFAULTS.apiRateLimit.max,
      },
    },
    sqliteJournalMode:
      process.env.SQLITE_JOURNAL_MODE?.trim() || DEFAULTS.sqliteJournalMode,
    vapid: {
      publicKey: process.env.VAPID_PUBLIC_KEY?.trim(),
      privateKey: process.env.VAPID_PRIVATE_KEY?.trim(),
    },
    encryptionMasterKey: process.env.ENCRYPTION_MASTER_KEY?.trim() || jwtSecret || "insecure-dev-master-key",
  };
}

function parseCorsOrigins(envValue, fallback) {
  if (!envValue) {
    return fallback;
  }

  return envValue
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
