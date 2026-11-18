/**
 * Component: Starter content for new accounts, and the optional demo user
 * Documentation: documentation/backend/seed.md
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { hashPassword } from "../utils/passwords.js";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "seed-assets");

export const DEMO_EMAIL = "demo@demo.com";
export const DEMO_PASSWORD = "demo1234";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// The welcome note's pictures: file in seed-assets/, the name it is stored under, its alt text.
const PICTURES = {
  logo: ["logo.png", "notient-logo.png", "The Notient logo"],
  mac: ["mac.png", "notient-mac.png", "Notient on the Mac"],
  ios: ["ios.png", "notient-ios.png", "Notient on iPhone"],
  android: ["android.png", "notient-android.png", "Notient on Android"],
};

// Stores each picture beside the note and returns its Markdown line ("" when the file is not shipped).
async function pictureLines(storage, noteId) {
  const lines = {};
  for (const [key, [file, stored, alt]] of Object.entries(PICTURES)) {
    const path = join(assetsDir, file);
    if (!existsSync(path)) {
      lines[key] = "";
      continue;
    }
    const url = await storage.uploadNoteImage(noteId, stored, readFileSync(path));
    lines[key] = `![${alt}](${url})`;
  }
  return lines;
}

function welcomeBody(p) {
  return [
    p.logo,
    "",
    "# Welcome to Notient",
    "",
    "Notes, tasks and a calendar in one place. This note shows what the editor can do; tap the pencil to edit it, or make your own with **New Note**.",
    "",
    "## Text",
    "",
    // Exact draws emphasis literally in a paragraph that also holds inline code or a link, so each stays in its own paragraph.
    "Write in **bold**, *italic*, ***both*** or ~~strikethrough~~.",
    "",
    "Short snippets sit in `inline code`.",
    "",
    "A [link](https://github.com/axiomatose/notient) is one tap in the format bar.",
    "",
    "### Headings",
    "",
    "#### Four levels, H1 to H4",
    "",
    "> A quote sits in the margin, good for anything you are borrowing from somebody else.",
    "",
    "___",
    "",
    "## Lists",
    "",
    "- Bullets for things in no order",
    "  - nest them with the indent button",
    "- Another bullet",
    "",
    "1. Numbers for steps",
    "2. That follow each other",
    "3. Like these",
    "",
    "- [ ] Checklists tick off in the note",
    "- [x] Like this finished item",
    "- [ ] And this one is still open",
    "",
    "## Code",
    "",
    "```js",
    "// A fenced block keeps its spacing and has a copy button.",
    "const greeting = \"hello, Notient\";",
    "console.log(greeting);",
    "```",
    "",
    "## Pictures",
    "",
    "Add a picture from the image button in the format bar. Notient runs on the Mac, iPhone, iPad and the web, and early on Android and Windows.",
    "",
    p.mac,
    "",
    p.ios,
    "",
    p.android,
    "",
    "## Next",
    "",
    "- Open **Getting Started**, **Groceries** and **Sample Board** under Tasks.",
    "- Look at **Notient Events** on the Calendar: some tasks and events are due this week.",
    "- The **Vault** note hides its code until you tap the eye.",
  ]
    .filter((l, i, all) => !(l === "" && (all[i - 1] === "" || i === 0)))
    .join("\n");
}

const VAULT_BODY = [
  "# Vault",
  "",
  "A note tagged `vault` hides anything in code, so passwords stay off the screen and out of search and previews. Tap a hidden value to copy it, or the eye to show it.",
  "",
  "- Wi-Fi name: `Notient-Guest`",
  "- Wi-Fi password: `correct-horse-battery-staple`",
  "- Door code: `4821`",
  "",
  "```",
  "recovery code: 7QK2-M9XD-45LP",
  "```",
].join("\n");

/**
 * Creates the starter notes, lists and events for a new user.
 * `repos` and `storage` are the server's; `config` is read for nothing today and kept so a later seed can use it.
 */
export async function seedNewUser({ repos, storage, userId, deviceId = null, now = Date.now() }) {
  // Whole hours from now, so the times read cleanly on the calendar.
  const hour = Math.ceil(now / HOUR) * HOUR;

  // Notes
  const welcomeId = nanoid();
  const pictures = storage ? await pictureLines(storage, welcomeId) : { logo: "", mac: "", ios: "", android: "" };
  repos.notes.create({
    userId,
    deviceId,
    data: {
      id: welcomeId,
      title: "Welcome to Notient",
      bodyMarkdown: welcomeBody(pictures),
      isPinned: true,
      tags: ["welcome"],
      folder: "Welcome",
      createdAt: now,
      updatedAt: now,
    },
  });
  repos.notes.create({
    userId,
    deviceId,
    data: {
      id: nanoid(),
      title: "Vault",
      bodyMarkdown: VAULT_BODY,
      isPinned: false,
      tags: ["vault"],
      folder: "Welcome",
      createdAt: now - 1,
      updatedAt: now - 1,
    },
  });

  // Task lists
  const addList = (data) => repos.taskLists.create({ userId, deviceId, data: { id: nanoid(), createdAt: now, updatedAt: now, ...data } });
  const addSection = (listId, name, order, extra = {}) => {
    const id = nanoid();
    repos.taskSections.create({ userId, deviceId, data: { id, listId, name, sortOrder: order, createdAt: now, updatedAt: now, ...extra } });
    return id;
  };
  let taskOrder = 0;
  const addTask = (listId, title, extra = {}) =>
    repos.tasks.create({
      userId,
      deviceId,
      data: { id: nanoid(), listId, title, sortOrder: (taskOrder += 1), createdAt: now, updatedAt: now, ...extra },
    });

  // Getting started: timed tasks, which the calendar shows under "Tasks Due".
  const start = addList({ name: "Getting Started", icon: "rocket", color: "#007AFF", sortOrder: 1 });
  addTask(start.id, "Read the welcome note", { dueAt: hour + HOUR, dueHasTime: true, flagged: true, priority: 1, tags: ["welcome"] });
  addTask(start.id, "Add your first note", { dueAt: hour + 3 * HOUR, dueHasTime: true });
  addTask(start.id, "Plan tomorrow on the calendar", { dueAt: hour + DAY, dueHasTime: true });
  addTask(start.id, "Invite someone to a shared list", { dueAt: hour + 3 * DAY, dueHasTime: true, notes: "Open a list's menu, then choose Share." });
  addTask(start.id, "Check this off", { isDone: true, completedAt: now });

  // Groceries: grocery mode groups by aisle (sections).
  const groceries = addList({ name: "Groceries", icon: "shopping-cart", color: "#34C759", groceryMode: true, sortOrder: 2 });
  const produce = addSection(groceries.id, "Produce", 1);
  const dairy = addSection(groceries.id, "Dairy", 2);
  const pantry = addSection(groceries.id, "Pantry", 3);
  for (const t of ["Bananas", "Spinach", "Lemons"]) addTask(groceries.id, t, { sectionId: produce });
  for (const t of ["Milk", "Greek yogurt"]) addTask(groceries.id, t, { sectionId: dairy });
  for (const t of ["Rice", "Olive oil"]) addTask(groceries.id, t, { sectionId: pantry });
  addTask(groceries.id, "Eggs", { sectionId: dairy, isDone: true, completedAt: now });

  // Kanban board: a section named Done holds finished cards.
  const board = addList({ name: "Sample Board", icon: "kanban", color: "#AF52DE", viewMode: "board", sortOrder: 3 });
  const todo = addSection(board.id, "To Do", 1, { color: "#FF9500" });
  const doing = addSection(board.id, "In Progress", 2, { color: "#007AFF" });
  const done = addSection(board.id, "Done", 3, { color: "#34C759" });
  addTask(board.id, "Drag a card to another column", { sectionId: todo, priority: 1 });
  addTask(board.id, "Open a card to add notes and a due date", { sectionId: todo });
  addTask(board.id, "Switch this list between board and list view", { sectionId: doing });
  addTask(board.id, "Create the board", { sectionId: done, isDone: true, completedAt: now });

  // Calendar: the default calendars (events + "Tasks Due"), and a few events.
  await repos.calendars.setDefaultCalendars(userId);
  const calendars = await repos.calendars.listCalendars(userId);
  const events = calendars.calendars.find((c) => c.type === "internal");
  if (events) {
    const event = (title, startTime, durationHours, extra = {}) =>
      repos.events.createEvent(events.id, { title, startTime, endTime: startTime + durationHours * HOUR, ...extra });
    await event("Coffee with a friend", hour + 2 * HOUR, 1, { location: "The corner cafe", alertMinutes: 15 });
    await event("Team check-in", hour + DAY + HOUR, 1, { description: "Agenda: what shipped, what is next.", alertMinutes: 10 });
    await event("Weekend away", hour - (hour % DAY) + 4 * DAY, 24, { allDay: true });
  }
}

/** Creates the demo user once (and seeds it), for testing and the live demo. Returns "created" or "exists". */
export async function ensureDemoUser({ repos, config, storage }) {
  if (repos.users.findByEmail(DEMO_EMAIL)) return "exists";
  const now = Date.now();
  const userId = nanoid();
  repos.users.create({
    id: userId,
    email: DEMO_EMAIL,
    display_name: "Demo",
    password_hash: await hashPassword(DEMO_PASSWORD),
    created_at: now,
  });
  await seedNewUser({ repos, config, storage, userId, now });
  return "created";
}

// Every row the demo user owns, in a stable order. Any edit, move, delete or addition changes the hash.
const OWNED = [
  ["notes", "user_id = ?"],
  ["task_lists", "user_id = ?"],
  ["task_sections", "user_id = ?"],
  ["tasks", "user_id = ?"],
  ["tasklist_folders", "user_id = ?"],
  ["calendars", "user_id = ?"],
  ["calendar_events", "calendar_id IN (SELECT id FROM calendars WHERE user_id = ?)"],
];

/** A hash of the demo account's content (rows, profile and password). "" when the account is missing. */
export function demoFingerprint(db) {
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(DEMO_EMAIL);
  if (!user) return "";
  const hash = createHash("sha256");
  const { avatar_blob: blob, ...profile } = user;
  hash.update(JSON.stringify([profile, blob ? blob.length : 0]));
  for (const [table, where] of OWNED) {
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY id`).all(user.id);
    // last_sync moves on its own for synced calendars; the demo's are internal, so it stays null.
    hash.update(JSON.stringify([table, rows.map(({ last_sync, ...row }) => row)]));
  }
  return hash.digest("hex");
}

/** Deletes the demo account (its rows go with it) and creates it again from the seed. */
export async function resetDemoUser({ db, repos, config, storage }) {
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_EMAIL);
  if (user) {
    const noteIds = db.prepare("SELECT id FROM notes WHERE user_id = ?").all(user.id).map((n) => n.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    // Note bodies are files beside the database; drop the old ones too.
    if (config?.notesDir) rmSync(join(config.notesDir, user.id), { recursive: true, force: true });
    // The seeded pictures are copied per note; drop the old copies.
    for (const id of noteIds) {
      for (const [, stored] of Object.values(PICTURES)) await storage?.deleteNoteImage?.(id, stored).catch(() => {});
    }
  }
  await ensureDemoUser({ repos, config, storage });
}

/**
 * Keeps the demo account as seeded: resets it now, then every `everyMs` resets it again if its content differs from the seed.
 * Returns a function that runs one check (used by tests).
 */
export async function keepDemoUserAsSeeded({ db, repos, config, storage, logger, everyMs = 5 * 60_000 }) {
  let baseline = "";
  const reset = async () => {
    await resetDemoUser({ db, repos, config, storage });
    baseline = demoFingerprint(db);
  };
  const check = async () => {
    try {
      if (demoFingerprint(db) !== baseline) {
        await reset();
        logger?.info("Demo user changed; reset to the seed");
      }
    } catch (error) {
      logger?.error({ err: error }, "Demo user check failed");
    }
  };
  await reset();
  setInterval(check, everyMs).unref?.();
  return check;
}
