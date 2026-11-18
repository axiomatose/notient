import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestContext } from "./helpers/testUtils.js";
import { createRepositories } from "../src/db/index.js";
import { createFileStorage } from "../src/lib/storage.js";
import { DEMO_EMAIL, DEMO_PASSWORD, ensureDemoUser, keepDemoUserAsSeeded } from "../src/lib/seedUser.js";

describe("starter content", () => {
  let context;
  let agent;

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
  });

  afterEach(() => context.cleanup());

  async function signUp(email) {
    const res = await agent.post("/auth/register").send({ email, password: "Passw0rd!23" });
    expect(res.status).toBe(201);
    return { Authorization: `Bearer ${res.body.token}` };
  }

  it("gives a new account no starter content unless seeding is on", async () => {
    const auth = await signUp("quiet@example.com");
    const notes = await agent.get("/notes").set(auth);
    expect(notes.body.notes ?? []).toHaveLength(0);
  });

  it("seeds a welcome note, a vault note, three lists and some events for a new account", async () => {
    context.config.seedNewUsers = true;
    const auth = await signUp("fresh@example.com");

    const notes = (await agent.get("/notes").set(auth)).body.notes;
    const welcome = notes.find((n) => n.title === "Welcome to Notient");
    expect(welcome.isPinned).toBe(true);
    expect(welcome.bodyMarkdown).toContain("# Welcome to Notient");
    expect(welcome.bodyMarkdown).toContain("```js");
    expect(welcome.bodyMarkdown).toContain("- [x] ");
    // The logo ships with the server: its picture is stored and linked.
    expect(welcome.bodyMarkdown).toMatch(/!\[The Notient logo\]\(http[^)]+\/files\/notes\/[^)]+notient-logo\.png\)/);
    expect(notes.find((n) => n.title === "Vault").tags).toContain("vault");

    const lists = (await agent.get("/task-lists").set(auth)).body.lists;
    expect(lists.map((l) => l.name).sort()).toEqual(["Getting Started", "Groceries", "Sample Board"]);
    expect(lists.find((l) => l.name === "Groceries").groceryMode).toBe(true);
    expect(lists.find((l) => l.name === "Sample Board").viewMode).toBe("board");

    const board = lists.find((l) => l.name === "Sample Board");
    const sections = (await agent.get(`/task-sections?listId=${board.id}`).set(auth)).body.sections;
    expect(sections.map((s) => s.name)).toEqual(["To Do", "In Progress", "Done"]);

    const start = lists.find((l) => l.name === "Getting Started");
    const tasks = (await agent.get(`/tasks?listId=${start.id}`).set(auth)).body.tasks;
    expect(tasks.filter((t) => t.dueAt && t.dueHasTime).length).toBeGreaterThanOrEqual(3);

    const calendars = (await agent.get("/calendars").set(auth)).body.calendars;
    expect(calendars.map((c) => c.type).sort()).toEqual(["internal", "tasks"]);
    const events = await context.db.prepare("SELECT title FROM calendar_events").all();
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it("creates the demo user once, who can sign in", async () => {
    const repos = createRepositories(context.db, context.config);
    const storage = createFileStorage(context.config);
    expect(await ensureDemoUser({ repos, config: context.config, storage })).toBe("created");
    expect(await ensureDemoUser({ repos, config: context.config, storage })).toBe("exists");

    const login = await agent.post("/auth/login").send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.token}` };
    const notes = (await agent.get("/notes").set(auth)).body.notes;
    expect(notes.map((n) => n.title)).toContain("Welcome to Notient");
  });

  it("resets the demo user when its content changes, and leaves it alone otherwise", async () => {
    const repos = createRepositories(context.db, context.config);
    const storage = createFileStorage(context.config);
    const check = await keepDemoUserAsSeeded({ db: context.db, repos, config: context.config, storage, everyMs: 3600_000 });
    const welcomeId = () => context.db.prepare("SELECT id FROM notes WHERE title = 'Welcome to Notient'").get()?.id;

    const before = welcomeId();
    await check();
    expect(welcomeId()).toBe(before); // untouched: no reset

    const user = context.db.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_EMAIL);
    context.db.prepare("UPDATE notes SET body = 'vandalised' WHERE id = ?").run(before);
    context.db.prepare("INSERT INTO notes (id, user_id, title, body, created_at, updated_at) VALUES ('x1', ?, 'Spam', '', 1, 1)").run(user.id);
    await check();
    expect(welcomeId()).toBeTruthy();
    expect(welcomeId()).not.toBe(before); // reseeded
    expect(context.db.prepare("SELECT COUNT(*) AS n FROM notes WHERE title = 'Spam'").get().n).toBe(0);
    const owner = context.db.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_EMAIL).id;
    const notes = repos.notes.list({ userId: owner });
    expect(notes.find((n) => n.title === "Welcome to Notient").bodyMarkdown).toContain("# Welcome to Notient");
  });

  it("reports sign-up and demo options, and refuses sign-up when it is closed", async () => {
    let options = (await agent.get("/auth/options")).body;
    expect(options).toEqual({ registration: true, demo: null });

    context.config.seedDemoUser = true;
    options = (await agent.get("/auth/options")).body;
    expect(options.demo).toEqual({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

    context.config.registrationEnabled = false;
    expect((await agent.get("/auth/options")).body.registration).toBe(false);
    const res = await agent.post("/auth/register").send({ email: "late@example.com", password: "Passw0rd!23" });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain("registration_disabled");
  });
});
