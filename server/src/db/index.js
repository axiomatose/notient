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
import { nanoid } from "nanoid";
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

  // Create demo user if it doesn't exist
  createDemoUserIfNotExists(db);
}

function createDemoUserIfNotExists(db) {
  try {
    // Check if demo user already exists
    const existingUser = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("demo@demo.com");

    if (existingUser) {
      logger.info("Demo user already exists");
      return;
    }

    // Create demo user
    const demoUserId = "demo-user-" + Date.now();
    const hashedPassword = "$argon2id$v=19$m=65536,t=3,p=1$tSePvhZhkkTmKtwpyGAsfA$bLXOPu+GzRWCH0o9+NuUVLEXDiTTQdgASLXhMgW3u5Q"

    db.prepare(`
      INSERT INTO users (id, email, password_hash, created_at, display_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(demoUserId, "demo@demo.com", hashedPassword, Date.now(), "Demo User");

    logger.info("Demo user created successfully: demo@demo.com");

    // Seed demo user with demo content
    seedDemoUserContent(db, demoUserId);

  } catch (error) {
    logger.error("Failed to create demo user", error);
  }
}

function seedDemoUserContent(db, userId) {
  try {
    const timestamp = Date.now();
    const demoData = generateDemoContent(userId, "demo-device", timestamp);

    // Insert demo notes
    const insertNote = db.prepare(`
      INSERT INTO notes (
        id, user_id, title, body, is_pinned, tags, folder, created_at, updated_at, version, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const note of demoData.notes) {
      insertNote.run(
        note.id, userId, note.title, note.body, note.isPinned ? 1 : 0,
        JSON.stringify(note.tags), note.folder, note.createdAt, note.updatedAt,
        note.version, note.sortOrder
      );
    }

    // Insert demo task list folders
    const insertFolder = db.prepare(`
      INSERT INTO tasklist_folders (
        id, user_id, name, color, icon, sort_order, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const folderMap = new Map();
    for (const folder of demoData.folders) {
      insertFolder.run(
        folder.id, userId, folder.name, folder.color, folder.icon, folder.sortOrder,
        folder.createdAt, folder.updatedAt, folder.version
      );
      folderMap.set(folder.name, folder.id);
    }

    // Insert demo task lists
    const insertTaskList = db.prepare(`
      INSERT INTO task_lists (
        id, user_id, name, icon, color, folder_id, sort_order, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const list of demoData.taskLists) {
      const folderId = list.folder ? folderMap.get(list.folder) : null;
      insertTaskList.run(
        list.id, userId, list.name, list.icon, list.color, folderId, list.sortOrder,
        list.createdAt, list.updatedAt, list.version
      );
    }

    // Insert demo task sections
    const insertTaskSection = db.prepare(`
      INSERT INTO task_sections (
        id, user_id, list_id, name, sort_order, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const section of demoData.taskSections) {
      insertTaskSection.run(
        section.id, userId, section.listId, section.name, section.sortOrder,
        section.createdAt, section.updatedAt, section.version
      );
    }

    // Insert demo tasks
    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, user_id, list_id, section_id, title, notes, is_done, due_at, due_has_time, remind_at,
        priority, tags, sort_order, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const task of demoData.tasks) {
      insertTask.run(
        task.id, userId, task.listId, task.sectionId, task.title, task.notes,
        task.isDone ? 1 : 0, task.dueAt, task.dueHasTime ? 1 : 0, task.remindAt, task.priority,
        JSON.stringify(task.tags), task.sortOrder, task.createdAt, task.updatedAt,
        task.version
      );
    }

    logger.info("Demo content seeded successfully for demo user");

  } catch (error) {
    logger.error("Failed to seed demo content", error);
  }
}

function generateDemoContent(userId, deviceId, baseTimestamp) {
  const now = baseTimestamp;
  const tomorrow = now + 86400000;
  const nextWeek = now + 604800000;

  // Generate demo folders
  const folders = [
    {
      id: "folder-life",
      name: "Life",
      color: "#AF52DE", // iOS Purple
      icon: "Heart",
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }
  ];

  // Generate demo notes
  const notes = [
    {
      id: "note-welcome",
      title: "Welcome to Notient!",
      body: `<h2>Welcome to Notient!</h2>
<p>Notient is designed to be the perfect balance between simple note-taking apps and complex productivity suites.</p>
<p>Here's what makes Notient special:</p>
<ul>
<li><strong>Simple yet powerful</strong> - Clean interface with just the right features</li>
<li><strong>Platform agnostic</strong> - Works on any device with a modern browser</li>
<li><strong>Self-hostable</strong> - You control your data</li>
<li><strong>Snappy performance</strong> - Optimized for speed</li>
</ul>
<p>💡 <strong>Tip:</strong> Try dragging notes around to organize them, or pin important notes to keep them at the top!</p>`,
      isPinned: true,
      pinnedOrder: 1,
      tags: ["welcome", "getting-started"],
      folder: "Welcome",
      createdAt: now,
      updatedAt: now,
      version: 1,
      sortOrder: 1,
      sharedWith: [],
    },
    {
      id: "note-features",
      title: "Notient Features Overview",
      body: `<h2>Features Overview</h2>
<h3>Notes</h3>
<ul>
<li>Rich text editing with formatting options</li>
<li>Drag-and-drop organization</li>
<li>Pin important notes</li>
<li>Tag and categorize notes</li>
<li>Folder organization</li>
<li>Markdown support</li>
</ul>
<h3>Tasks</h3>
<ul>
<li>Multiple task lists</li>
<li>Sections within lists</li>
<li>Due dates and reminders</li>
<li>Priority levels</li>
<li>Subtasks and nested tasks</li>
<li>Drag-and-drop reordering</li>
</ul>
<h3>Sync & Storage</h3>
<ul>
<li>Automatic sync across devices</li>
<li>Self-hosted data storage</li>
<li>Offline-first design</li>
<li>Conflict resolution</li>
</ul>`,
      isPinned: false,
      pinnedOrder: 0,
      tags: ["features", "overview"],
      folder: "Welcome",
      createdAt: now - 300000,
      updatedAt: now - 300000,
      version: 1,
      sortOrder: 2,
      sharedWith: [],
    },
    {
      id: "note-recipes",
      title: "Recipe: Quick Pasta",
      body: `<h2>Quick Garlic Pasta</h2>
<h3>Ingredients</h3>
<ul>
<li>200g pasta</li>
<li>3 cloves garlic, minced</li>
<li>2 tbsp olive oil</li>
<li>1/4 cup grated Parmesan cheese</li>
<li>Salt and pepper to taste</li>
</ul>
<h3>Instructions</h3>
<ol>
<li>Cook pasta according to package instructions</li>
<li>Heat olive oil in a pan over medium heat</li>
<li>Add minced garlic and sauté until fragrant</li>
<li>Drain pasta and toss with garlic oil and Parmesan</li>
</ol>`,
      isPinned: false,
      pinnedOrder: 0,
      tags: ["recipe", "food"],
      folder: "Personal",
      createdAt: now - 3600000,
      updatedAt: now - 3600000,
      version: 1,
      sortOrder: 3,
      sharedWith: [],
    },
  ];

  // Generate demo task lists
  const taskLists = [
    {
      id: "list-personal",
      name: "Personal",
      icon: "Home",
      color: "#007AFF", // iOS Blue
      sortOrder: 1,
      folder: "Life",
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: "list-work",
      name: "Work",
      icon: "Briefcase",
      color: "#FF9500", // iOS Orange
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  ];

  // Generate demo task sections
  const taskSections = [
    {
      id: "section-today",
      listId: "list-personal",
      name: "Today",
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  ];

  // Generate demo tasks
  const tasks = [
    {
      id: "task-groceries",
      listId: "list-personal",
      sectionId: "section-today",
      title: "Buy groceries",
      notes: "Milk, eggs, bread",
      isDone: false,
      dueAt: tomorrow,
      dueHasTime: true,
      priority: 2,
      tags: ["shopping"],
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: "task-proposal",
      listId: "list-work",
      sectionId: null,
      title: "Finish project proposal",
      notes: "Review with team",
      isDone: false,
      dueAt: tomorrow,
      dueHasTime: true,
      priority: 1,
      tags: ["work"],
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }
  ];

  return {
    notes,
    folders,
    taskLists,
    taskSections,
    tasks,
  };
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
