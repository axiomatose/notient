import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

describe("task notes", () => {
  let context;
  let agent;
  let owner;
  let friend;
  let stranger;
  let taskId;

  async function signUp(tag) {
    const res = await agent.post("/auth/register").send({
      email: `${tag}-${nanoid(6)}@example.com`,
      password: "Passw0rd!23",
      deviceName: `${tag} device`,
    });
    expect(res.status).toBe(201);
    return { email: res.body.user.email, id: res.body.user.id, auth: { Authorization: `Bearer ${res.body.token}` } };
  }

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    owner = await signUp("owner");
    friend = await signUp("friend");
    stranger = await signUp("stranger");
    const list = await agent.post("/task-lists").set(owner.auth).send({ name: "Board" });
    const listId = list.body.list.id;
    await agent.post("/task-list-shares").set(owner.auth).send({ listId, sharedWithUserEmail: friend.email, permission: "edit" });
    const task = await agent.post("/tasks").set(owner.auth).send({ listId, title: "Thread" });
    taskId = task.body.task.id;
  });

  afterEach(() => context.cleanup());

  it("keeps each note with its author and time, oldest first", async () => {
    const a = await agent.post(`/tasks/${taskId}/notes`).set(owner.auth).send({ body: "First" });
    expect(a.status).toBe(201);
    await agent.post(`/tasks/${taskId}/notes`).set(friend.auth).send({ body: "Second" });
    const res = await agent.get(`/tasks/${taskId}/notes`).set(friend.auth);
    expect(res.body.notes.map((n) => n.body)).toEqual(["First", "Second"]);
    expect(res.body.notes[1].userId).toBe(friend.id);
    expect(res.body.notes[1].author.email).toBe(friend.email);
    expect(typeof res.body.notes[0].createdAt).toBe("number");
  });

  it("puts the newest note on the task's list row, with its author's id", async () => {
    await agent.post(`/tasks/${taskId}/notes`).set(owner.auth).send({ body: "First" });
    await agent.post(`/tasks/${taskId}/notes`).set(friend.auth).send({ body: "Latest" });
    const list = await agent.get(`/tasks`).set(owner.auth);
    const row = list.body.tasks.find((x) => x.id === taskId);
    expect(row.latestNote.body).toBe("Latest");
    expect(row.latestNote.userId).toBe(friend.id);
  });

  it("refuses an empty note and a stranger", async () => {
    expect((await agent.post(`/tasks/${taskId}/notes`).set(owner.auth).send({ body: "  " })).status).toBe(400);
    expect((await agent.get(`/tasks/${taskId}/notes`).set(stranger.auth)).status).toBeGreaterThanOrEqual(403);
    expect((await agent.post(`/tasks/${taskId}/notes`).set(stranger.auth).send({ body: "hi" })).status).toBeGreaterThanOrEqual(403);
  });

  it("lets the author or the list's owner remove a note", async () => {
    const mine = await agent.post(`/tasks/${taskId}/notes`).set(friend.auth).send({ body: "Mine" });
    const theirs = await agent.post(`/tasks/${taskId}/notes`).set(owner.auth).send({ body: "Theirs" });
    expect((await agent.delete(`/tasks/${taskId}/notes/${theirs.body.note.id}`).set(friend.auth)).status).toBe(403);
    expect((await agent.delete(`/tasks/${taskId}/notes/${mine.body.note.id}`).set(owner.auth)).status).toBe(200);
    const res = await agent.get(`/tasks/${taskId}/notes`).set(owner.auth);
    expect(res.body.notes.map((n) => n.body)).toEqual(["Theirs"]);
  });

  it("starts a task's thread from its old notes field", async () => {
    const task = await agent.post("/tasks").set(owner.auth).send({ listId: (await agent.get("/task-lists").set(owner.auth)).body.lists[0].id, title: "Old", notes: "kept" });
    expect(task.status).toBe(201);
    const res = await agent.get(`/tasks/${task.body.task.id}/notes`).set(owner.auth);
    expect(res.status).toBe(200);
  });
});
