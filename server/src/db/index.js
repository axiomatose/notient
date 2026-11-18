import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./schema.js";
import { createTaskNotificationsRepository } from "./taskNotifications.js";
import { createTaskSharesRepository } from "./taskShares.js";
import { createTaskAttachmentsRepository } from "./taskAttachments.js";
import { createTaskListSharesRepository } from "./taskListShares.js";
import { createNoteSharesRepository } from "./noteShares.js";
import { createShareableLinksRepository } from "./shareableLinks.js";
import * as users from "./users.js";
import * as tasks from "./tasks.js";
import * as taskLists from "./taskLists.js";
import * as taskSections from "./taskSections.js";
import * as notes from "./notes.js";
import * as devices from "./devices.js";
import * as checkpoints from "./checkpoints.js";
import { createFoldersRepository } from "./tasklistFolders.js";
import { createCalendarRepository } from "./calendars.js";
import { createEventRepository } from "./events.js";
import { createPushSubscriptionsRepository } from "./pushSubscriptions.js";
import logger from "../utils/logger.js";

export function initializeDatabase(config) {
  const directory = dirname(config.dbPath);

  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  // Initialize database with basic error handling
  let db;
  try {
    db = new Database(config.dbPath);

    // Set basic pragmas - using string literals to avoid syntax issues
    db.pragma("journal_mode = DELETE");
    
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");

    applyMigrations(db);
    logger.info("Database initialized successfully");
    return db;
  } catch (error) {


    logger.error("Database initialization failed", error);

    // If database is corrupted, recreate it
    if (
      error.code === "SQLITE_CORRUPT" ||
      error.code === "SQLITE_IOERR" ||
      error.message.includes("Expected second argument")
    ) {
      logger.info("Recreating corrupted database...");

      try {
        // Backup and remove corrupted file
        if (existsSync(config.dbPath)) {
          const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .split(".")[0];
          const backupPath = `${config.dbPath}.corrupt.${timestamp}`;

          try {
            const { renameSync } = require("node:fs");
            renameSync(config.dbPath, backupPath);
            logger.info(`Corrupted database backed up to: ${backupPath}`);
          } catch (backupError) {
            logger.warn("Failed to backup corrupted database", backupError);
          }
        }

        // Create new database
        db = new Database(config.dbPath);
        db.pragma("journal_mode = DELETE");
        db.pragma("foreign_keys = ON");
        db.pragma("synchronous = NORMAL");

        applyMigrations(db);
        logger.info("Database recreated successfully");
        return db;
      } catch (recreateError) {
        logger.error("Failed to recreate database", recreateError);
        throw recreateError;
      }
    }

    throw error;
  }
}

// Note: If database corruption persists after this fix, you may need to:
// 1. Stop Docker containers: docker-compose down
// 2. Remove corrupted data: rm -rf ./server/data/*
// 3. Restart: docker-compose up -d
// This will create a fresh database with default data

function applyMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = db
    .prepare("SELECT id FROM schema_migrations ORDER BY id ASC")
    .all();
  const appliedIds = new Set(appliedRows.map((row) => row.id));

  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    const runMigration = db.transaction(() => {
      db.exec(migration.up);
      insertMigration.run(migration.id, migration.name, Date.now());
    });

    try {
      runMigration();
      logger.info(`Applied migration: ${migration.name}`);
    } catch (migrationError) {
      // Ignore duplicate column errors (column already exists from previous migration)
      if (
        migrationError.code === "SQLITE_ERROR" &&
        migrationError.message?.includes("duplicate column")
      ) {
        logger.info(`Migration ${migration.name} skipped - column already exists`);
        insertMigration.run(migration.id, migration.name, Date.now());
      } else {
        logger.error(`Migration failed: ${migration.name}`, migrationError);
        throw migrationError;
      }
    }
  }
}

export function createRepositories(db, config) {
  return {
    users: users.createUserRepository(db),
    tasks: tasks.createTasksRepository(db),
    taskLists: taskLists.createTaskListsRepository(db),
    taskSections: taskSections.createTaskSectionsRepository(db),
    notes: notes.createNotesRepository(db, config),
    devices: devices.createDeviceRepository(db),
    checkpoints: checkpoints.createCheckpointsRepository(db),
    taskNotifications: createTaskNotificationsRepository(db),
    taskShares: createTaskSharesRepository(db),
    taskAttachments: createTaskAttachmentsRepository(db),
    taskListShares: createTaskListSharesRepository(db),
    noteShares: createNoteSharesRepository(db),
    shareableLinks: createShareableLinksRepository(db),
    folders: createFoldersRepository(db),
    calendars: createCalendarRepository(db),
    events: createEventRepository(db),
    pushSubscriptions: createPushSubscriptionsRepository(db),
  };
}
