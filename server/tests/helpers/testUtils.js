import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { initializeDatabase } from "../../src/db/index.js";
import { buildApp } from "../../src/server.js";

export async function createTestContext() {
  const tempDir = mkdtempSync(join(tmpdir(), "notient-test-"));
  const dbPath = join(tempDir, "test.db");

  const config = {
    env: "test",
    host: "127.0.0.1",
    port: 0,
    dbPath,
    jwtSecret: `test-secret-${randomUUID()}`,
    jwtExpiresIn: "1h",
    dataDir: tempDir,
    notesDir: join(tempDir, "notes"),
    deviceMaxAgeMs: 1000 * 60 * 60 * 24,
    publicUrl: "http://127.0.0.1:0",
    corsOrigins: ["http://localhost"],
    vapid: { publicKey: undefined, privateKey: undefined },
    logLevel: "silent",
    rateLimits: {
      login: {
        windowMs: 1000,
        max: 3,
      },
      api: {
        windowMs: 15 * 60 * 1000,
        max: 1000,
      },
    },
  };

  const db = initializeDatabase(config);
  const app = await buildApp({ config, db });

  const cleanup = () => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  };

  return { app, db, config, cleanup };
}
