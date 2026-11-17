import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

describe("API integration", () => {
  let context;
  let agent;
  let email;
  const password = "Passw0rd!23";

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    email = `user-${nanoid(6)}@example.com`;
  });

  afterEach(() => {
    context.cleanup();
  });

  async function registerUser(deviceName = "Test Device") {
    const res = await agent.post("/auth/register").send({
      email,
      password,
      deviceName,
    });
    expect(res.status).toBe(201);
    return res.body;
  }

  it("registers a new user and logs in with existing device", async () => {
    const registration = await registerUser();

    const loginRes = await agent.post("/auth/login").send({
      email,
      password,
      deviceId: registration.device.id,
      deviceName: "Updated Device Name",
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();
    expect(loginRes.body.device.id).toBe(registration.device.id);
    expect(loginRes.body.device.name).toBe("Updated Device Name");
  });

  it("rate limits repeated login attempts", async () => {
    await registerUser();

    const maxAttempts = context.config.rateLimits.login.max;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const res = await agent.post("/auth/login").send({
        email,
        password: "incorrect-password",
      });
      expect(res.status).toBe(401);
    }

    const limitedRes = await agent.post("/auth/login").send({
      email,
      password: "incorrect-password",
    });

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.body.error).toBe("too_many_attempts");
  });

  it("performs note and task CRUD operations", async () => {
    const { token } = await registerUser();
    const authHeader = { Authorization: `Bearer ${token}` };

    const createNoteRes = await agent
      .post("/notes")
      .set(authHeader)
      .send({
        title: "First Note",
        body: "Hello world",
        tags: ["welcome"],
        isPinned: true,
      });

    expect(createNoteRes.status).toBe(201);
    const noteId = createNoteRes.body.note.id;
    expect(createNoteRes.body.note.title).toBe("First Note");
    expect(createNoteRes.body.note.isPinned).toBe(true);

    const updateNoteRes = await agent
      .patch(`/notes/${noteId}`)
      .set(authHeader)
      .send({
        body: "Hello universe",
        isPinned: false,
      });

    expect(updateNoteRes.status).toBe(200);
    expect(updateNoteRes.body.note.body).toContain("Hello universe");
    expect(updateNoteRes.body.note.isPinned).toBe(false);

    const listNotesRes = await agent
      .get("/notes")
      .set(authHeader)
      .expect(200);
    expect(listNotesRes.body.count).toBe(1);
    expect(listNotesRes.body.notes[0].id).toBe(noteId);

    const createListRes = await agent
      .post("/task-lists")
      .set(authHeader)
      .send({
        name: "Main",
        icon: "📋",
        color: "blue",
      });
    expect(createListRes.status).toBe(201);
    const listId = createListRes.body.list.id;

    const createTaskRes = await agent
      .post("/tasks")
      .set(authHeader)
      .send({
        listId,
        title: "Initial task",
        notes: "remember to test",
      });
    expect(createTaskRes.status).toBe(201);
    const taskId = createTaskRes.body.task.id;
    expect(createTaskRes.body.task.listId).toBe(listId);

    const updateTaskRes = await agent
      .patch(`/tasks/${taskId}`)
      .set(authHeader)
      .send({
        isDone: true,
        priority: 2,
      });
    expect(updateTaskRes.status).toBe(200);
    expect(updateTaskRes.body.task.isDone).toBe(true);
    expect(updateTaskRes.body.task.priority).toBe(2);

    const listTasksRes = await agent
      .get(`/tasks?listId=${listId}`)
      .set(authHeader)
      .expect(200);
    expect(listTasksRes.body.count).toBe(1);
    expect(listTasksRes.body.tasks[0].id).toBe(taskId);
  });

  it("pushes and pulls sync payloads with conflict metadata", async () => {
    const registration = await registerUser("Sync Device");
    const authHeader = { Authorization: `Bearer ${registration.token}` };
    const deviceId = registration.device.id;
    const listId = nanoid();
    const now = Date.now();

    const pushRes = await agent
      .post("/sync/push")
      .set(authHeader)
      .send({
        deviceId,
        lists: [
          {
            id: listId,
            name: "Inbox",
            createdAt: now,
            updatedAt: now,
            changedFields: ["name"],
          },
        ],
        notes: [
          {
            id: nanoid(),
            title: "Synced Note",
            body: "Content",
            isPinned: false,
            tags: [],
            createdAt: now,
            updatedAt: now,
            changedFields: ["title", "body"],
          },
        ],
        tasks: [
          {
            id: nanoid(),
            listId,
            title: "Synced Task",
            notes: "",
            isDone: false,
            createdAt: now,
            updatedAt: now,
            changedFields: ["title"],
          },
        ],
        sections: [],
      });

    expect(pushRes.status).toBe(200);
    expect(pushRes.body.results.notes.applied).toBe(1);
    expect(pushRes.body.results.lists.applied).toBe(1);
    expect(pushRes.body.results.tasks.applied).toBe(1);

    const pullRes = await agent
      .get("/sync/pull")
      .set(authHeader)
      .expect(200);

    expect(pullRes.body.notes.length).toBeGreaterThanOrEqual(1);
    expect(pullRes.body.lists.length).toBeGreaterThanOrEqual(1);
    expect(pullRes.body.tasks.length).toBeGreaterThanOrEqual(1);
    expect(pullRes.body.checkpoint).toBeTypeOf("number");
  });

  it("rejects sync push when device id mismatches token device", async () => {
    const registration = await registerUser();
    const authHeader = { Authorization: `Bearer ${registration.token}` };

    const res = await agent.post("/sync/push").set(authHeader).send({
      deviceId: "some-other-device",
      notes: [],
      tasks: [],
      lists: [],
      sections: [],
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("device_mismatch");
  });

  it("stores bodyMarkdown verbatim on create and update", async () => {
    const { token } = await registerUser();
    const authHeader = { Authorization: `Bearer ${token}` };
    const md = "- [ ] a\n  - [x] nested\n\n1. one\n2. two\n\n```js\nconst x = 1;\n```\n";

    const createRes = await agent
      .post("/notes")
      .set(authHeader)
      .send({ title: "Markdown", bodyMarkdown: md })
      .expect(201);
    const noteId = createRes.body.note.id;
    expect(createRes.body.note.bodyMarkdown).toBe(md);
    expect(createRes.body.note.body).toContain("<li>");

    const getRes = await agent.get(`/notes/${noteId}`).set(authHeader).expect(200);
    expect(getRes.body.note.bodyMarkdown).toBe(md);

    const md2 = "# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\\[x\\] literal\n";
    const updateRes = await agent
      .patch(`/notes/${noteId}`)
      .set(authHeader)
      .send({ bodyMarkdown: md2, body: "<p>ignored</p>" })
      .expect(200);
    expect(updateRes.body.note.bodyMarkdown).toBe(md2);

    const listRes = await agent.get("/notes").set(authHeader).expect(200);
    expect(listRes.body.notes[0].bodyMarkdown).toBe(md2);
  });

  it("keeps legacy HTML body writes working", async () => {
    const { token } = await registerUser();
    const authHeader = { Authorization: `Bearer ${token}` };

    const createRes = await agent
      .post("/notes")
      .set(authHeader)
      .send({ title: "Legacy", body: "<p>Hello <strong>there</strong></p>" })
      .expect(201);
    const noteId = createRes.body.note.id;
    expect(createRes.body.note.body).toContain("Hello");
    expect(createRes.body.note.bodyMarkdown).toBe("Hello **there**");

    const updateRes = await agent
      .patch(`/notes/${noteId}`)
      .set(authHeader)
      .send({ body: "<h1>Updated</h1>" })
      .expect(200);
    expect(updateRes.body.note.body).toContain("Updated");
    expect(updateRes.body.note.bodyMarkdown).toBe("# Updated");
  });

  it("task details round-trip flag, url, recurrence and time", async () => {
    const { token } = await registerUser();
    const authHeader = { Authorization: `Bearer ${token}` };
    const listRes = await agent
      .post("/task-lists")
      .set(authHeader)
      .send({ name: "Details" });
    const listId = listRes.body.list.id;

    const createRes = await agent
      .post("/tasks")
      .set(authHeader)
      .send({
        listId,
        title: "Pay rent",
        dueAt: Date.UTC(2099, 0, 10, 9),
        dueHasTime: false,
        flagged: true,
        url: "  https://example.com/rent  ",
        recurrence: "monthly",
      });
    expect(createRes.status).toBe(201);
    const task = createRes.body.task;
    expect(task.dueHasTime).toBe(false);
    expect(task.flagged).toBe(true);
    expect(task.url).toBe("https://example.com/rent");
    expect(task.recurrence).toBe("monthly");

    const updateRes = await agent
      .patch(`/tasks/${task.id}`)
      .set(authHeader)
      .send({ url: "", flagged: false, recurrence: "none", dueHasTime: true });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.task.url).toBeNull();
    expect(updateRes.body.task.flagged).toBe(false);
    expect(updateRes.body.task.recurrence).toBe("none");
    expect(updateRes.body.task.dueHasTime).toBe(true);

    const badRes = await agent
      .patch(`/tasks/${task.id}`)
      .set(authHeader)
      .send({ recurrence: "hourly" });
    expect(badRes.status).toBe(400);

    const subRes = await agent
      .post("/tasks")
      .set(authHeader)
      .send({ listId, parentId: task.id, title: "Call bank" });
    expect(subRes.status).toBe(201);

    const listTasksRes = await agent
      .get(`/tasks?listId=${listId}`)
      .set(authHeader)
      .expect(200);
    expect(listTasksRes.body.count).toBe(1);
    expect(listTasksRes.body.tasks[0].subtaskCount).toBe(1);
  });

  it("an event's alert and url round-trip and clear", async () => {
    const { token } = await registerUser();
    const authHeader = { Authorization: `Bearer ${token}` };
    const calRes = await agent
      .post("/calendars")
      .set(authHeader)
      .send({ name: "Home", color: "#007AFF", type: "internal" });
    expect(calRes.status).toBe(201);
    const calendarId = calRes.body.calendar.id;

    const createRes = await agent
      .post(`/calendars/${calendarId}/events`)
      .set(authHeader)
      .send({
        title: "Dentist",
        startTime: Date.UTC(2099, 0, 10, 9),
        endTime: Date.UTC(2099, 0, 10, 10),
        alertMinutes: 15,
        url: "  https://example.com/dentist  ",
      });
    expect(createRes.status).toBe(201);
    const event = createRes.body.event;
    expect(event.alertMinutes).toBe(15);
    expect(event.url).toBe("https://example.com/dentist");

    const updateRes = await agent
      .patch(`/calendars/events/${event.id}`)
      .set(authHeader)
      .send({ alertMinutes: 1440, url: "", description: "Bring forms" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.event.alertMinutes).toBe(1440);
    expect(updateRes.body.event.url).toBeNull();
    expect(updateRes.body.event.description).toBe("Bring forms");

    const clearRes = await agent
      .patch(`/calendars/events/${event.id}`)
      .set(authHeader)
      .send({ alertMinutes: null, description: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.event.alertMinutes).toBeNull();
    expect(clearRes.body.event.description).toBeNull();

    const listRes = await agent
      .get(`/calendars/user/events?startTime=${Date.UTC(2099, 0, 1)}&endTime=${Date.UTC(2099, 0, 31)}`)
      .set(authHeader)
      .expect(200);
    const listed = listRes.body.events.find((e) => e.id === event.id);
    expect(listed.alertMinutes).toBeNull();
    expect(listed.url).toBeNull();

    const badRes = await agent
      .patch(`/calendars/events/${event.id}`)
      .set(authHeader)
      .send({ alertMinutes: -5 });
    expect(badRes.status).toBe(400);
  });

  it("a repeating task advances its due date when checked off", async () => {
    const { token } = await registerUser();
    const authHeader = { Authorization: `Bearer ${token}` };
    const listRes = await agent
      .post("/task-lists")
      .set(authHeader)
      .send({ name: "Routines" });
    const listId = listRes.body.list.id;

    const createRes = await agent
      .post("/tasks")
      .set(authHeader)
      .send({
        listId,
        title: "Water plants",
        dueAt: Date.UTC(2099, 0, 10, 9),
        remindAt: Date.UTC(2099, 0, 10, 8),
        recurrence: "daily",
      });
    const taskId = createRes.body.task.id;

    const doneRes = await agent
      .patch(`/tasks/${taskId}`)
      .set(authHeader)
      .send({ isDone: true });
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.task.isDone).toBe(false);
    expect(doneRes.body.task.dueAt).toBe(Date.UTC(2099, 0, 11, 9));
    expect(doneRes.body.task.remindAt).toBe(Date.UTC(2099, 0, 11, 8));

    const againRes = await agent
      .patch(`/tasks/${taskId}`)
      .set(authHeader)
      .send({ isDone: true });
    expect(againRes.body.task.isDone).toBe(false);
    expect(againRes.body.task.dueAt).toBe(Date.UTC(2099, 0, 12, 9));

    const plainRes = await agent
      .post("/tasks")
      .set(authHeader)
      .send({ listId, title: "One off", dueAt: Date.UTC(2099, 0, 10, 9) });
    const plainDone = await agent
      .patch(`/tasks/${plainRes.body.task.id}`)
      .set(authHeader)
      .send({ isDone: true });
    expect(plainDone.body.task.isDone).toBe(true);
    expect(plainDone.body.task.dueAt).toBe(Date.UTC(2099, 0, 10, 9));
  });
});
