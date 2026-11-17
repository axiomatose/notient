import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

describe("shared task lists", () => {
  let context;
  let agent;
  let owner;
  let friend;
  let stranger;
  let listId;

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
    listId = list.body.list.id;
    await agent.post("/tasks").set(owner.auth).send({ listId, title: "First" });
  });

  afterEach(() => context.cleanup());

  const share = (permission) =>
    agent.post("/task-list-shares").set(owner.auth).send({ listId, sharedWithUserEmail: friend.email, permission });

  it("keeps a list private until it is shared", async () => {
    const res = await agent.get(`/tasks?listId=${listId}`).set(friend.auth);
    expect(res.body.tasks).toEqual([]);
  });

  it("lets an editor read, add, change and finish tasks, and add sections", async () => {
    expect((await share("edit")).status).toBe(201);
    const read = await agent.get(`/tasks?listId=${listId}`).set(friend.auth);
    expect(read.body.tasks.map((t) => t.title)).toEqual(["First"]);

    const made = await agent.post("/tasks").set(friend.auth).send({ listId, title: "From friend" });
    expect(made.status).toBe(201);
    expect(made.body.task.userId).toBe(owner.id);

    const done = await agent.patch(`/tasks/${made.body.task.id}`).set(friend.auth).send({ isDone: true, notes: "done by friend" });
    expect(done.status).toBe(200);
    const ownerView = await agent.get(`/tasks?listId=${listId}`).set(owner.auth);
    expect(ownerView.body.tasks.find((t) => t.title === "From friend")).toMatchObject({ isDone: true, notes: "done by friend" });

    const section = await agent.post("/task-sections").set(friend.auth).send({ listId, name: "Doing" });
    expect(section.status).toBe(201);
    const sections = await agent.get(`/task-sections?listId=${listId}`).set(friend.auth);
    expect(sections.body.sections.map((s) => s.name)).toEqual(["Doing"]);
  });

  it("lets a viewer read but not change", async () => {
    expect((await share("view")).status).toBe(201);
    const read = await agent.get(`/tasks?listId=${listId}`).set(friend.auth);
    expect(read.body.tasks).toHaveLength(1);
    const add = await agent.post("/tasks").set(friend.auth).send({ listId, title: "Nope" });
    expect(add.status).toBe(403);
    const patch = await agent.patch(`/tasks/${read.body.tasks[0].id}`).set(friend.auth).send({ isDone: true });
    expect(patch.status).toBe(403);
  });

  it("keeps a stranger out and only the owner shares", async () => {
    await share("edit");
    const read = await agent.get(`/tasks?listId=${listId}`).set(stranger.auth);
    expect(read.body.tasks).toEqual([]);
    const own = await agent.get(`/tasks?listId=${listId}`).set(owner.auth);
    const patch = await agent.patch(`/tasks/${own.body.tasks[0].id}`).set(stranger.auth).send({ isDone: true });
    expect(patch.status).toBe(404);
    const reshare = await agent
      .post("/task-list-shares")
      .set(friend.auth)
      .send({ listId, sharedWithUserEmail: stranger.email, permission: "edit" });
    expect(reshare.status).toBe(403);
    const grab = await agent
      .post("/task-list-shares")
      .set(stranger.auth)
      .send({ listId, sharedWithUserEmail: stranger.email, permission: "edit" });
    expect([400, 403]).toContain(grab.status);
  });
});

import { createServer } from "node:http";
import WebSocket from "ws";

describe("live changes over a WebSocket", () => {
  let context;
  let agent;
  let server;
  let port;

  async function signUp(tag) {
    const res = await agent.post("/auth/register").send({
      email: `${tag}-${nanoid(6)}@example.com`,
      password: "Passw0rd!23",
      deviceName: `${tag} device`,
    });
    return { email: res.body.user.email, id: res.body.user.id, auth: { Authorization: `Bearer ${res.body.token}` } };
  }

  async function connect(user) {
    const { body } = await agent.post("/live/ticket").set(user.auth);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live?ticket=${body.ticket}`);
    const messages = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
    });
    return { ws, messages, ticket: body.ticket };
  }

  const settle = () => new Promise((r) => setTimeout(r, 150));

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    server = createServer(context.app);
    context.app.locals.liveHub.attach(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });

  afterEach(async () => {
    context.app.locals.liveHub.close();
    await new Promise((r) => server.close(r));
    context.cleanup();
  });

  it("tells the owner and the people a list is shared with, and nobody else", async () => {
    const owner = await signUp("owner");
    const friend = await signUp("friend");
    const stranger = await signUp("stranger");
    const list = await agent.post("/task-lists").set(owner.auth).send({ name: "Board" });
    const listId = list.body.list.id;
    await agent
      .post("/task-list-shares")
      .set(owner.auth)
      .send({ listId, sharedWithUserEmail: friend.email, permission: "edit" });

    const a = await connect(owner);
    const b = await connect(friend);
    const c = await connect(stranger);
    await settle();
    await agent.post("/tasks").set(friend.auth).send({ listId, title: "Live one" });
    await settle();

    expect(a.messages.filter((m) => m.type === "changed")).toHaveLength(1);
    expect(b.messages.find((m) => m.type === "changed")).toMatchObject({ listId, by: friend.id });
    expect(c.messages.filter((m) => m.type === "changed")).toHaveLength(0);
    [a, b, c].forEach((x) => x.ws.close());
  });

  it("opens a socket once per ticket and refuses a bad one", async () => {
    const user = await signUp("one");
    const first = await connect(user);
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/live?ticket=${first.ticket}`);
        ws.on("open", () => reject(new Error("a used ticket opened")));
        ws.on("error", resolve);
        ws.on("unexpected-response", () => resolve("refused"));
      }),
    ).resolves.toBeDefined();
    first.ws.close();
  });
});

describe("assigning people to tasks", () => {
  let context;
  let agent;

  async function signUp(tag, displayName) {
    const res = await agent.post("/auth/register").send({
      email: `${tag}-${nanoid(6)}@example.com`,
      password: "Passw0rd!23",
      deviceName: `${tag} device`,
    });
    const auth = { Authorization: `Bearer ${res.body.token}` };
    if (displayName) await agent.put("/profile").set(auth).send({ displayName });
    return { email: res.body.user.email, id: res.body.user.id, auth };
  }

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
  });
  afterEach(() => context.cleanup());

  it("serves a board in one request: sections, tasks, subtasks and members", async () => {
    const owner = await signUp("owner", "Olive");
    const friend = await signUp("friend", "Fern");
    const stranger = await signUp("stranger");
    const list = (await agent.post("/task-lists").set(owner.auth).send({ name: "Board" })).body.list;
    const section = (await agent.post("/task-sections").set(owner.auth).send({ listId: list.id, name: "Doing" })).body.section;
    const parent = (await agent.post("/tasks").set(owner.auth).send({ listId: list.id, sectionId: section.id, title: "Parent" })).body.task;
    await agent.post("/tasks").set(owner.auth).send({ listId: list.id, title: "Alone" });
    await agent.post("/tasks").set(owner.auth).send({ listId: list.id, parentId: parent.id, title: "Child A" });
    await agent.post("/tasks").set(owner.auth).send({ listId: list.id, parentId: parent.id, title: "Child B" });
    await agent
      .post("/task-list-shares")
      .set(owner.auth)
      .send({ listId: list.id, sharedWithUserEmail: friend.email, permission: "view" });

    const board = await agent.get(`/tasks/board?listId=${list.id}`).set(owner.auth);
    expect(board.status).toBe(200);
    expect(Object.keys(board.body).sort()).toEqual(["members", "sections", "subtasks", "tasks"]);
    // Each part is what its own route returns.
    const own = (path) => agent.get(path).set(owner.auth);
    expect(board.body.tasks).toEqual((await own(`/tasks?listId=${list.id}`)).body.tasks);
    expect(board.body.sections).toEqual((await own(`/task-sections?listId=${list.id}`)).body.sections);
    expect(board.body.members).toEqual((await own(`/task-list-shares/members/${list.id}`)).body.members);
    expect(board.body.tasks.map((t) => t.title).sort()).toEqual(["Alone", "Parent"]);
    expect(board.body.subtasks.map((t) => t.title).sort()).toEqual(["Child A", "Child B"]);
    expect(board.body.subtasks.every((t) => t.parentId === parent.id)).toBe(true);
    expect(board.body.sections.map((s) => s.name)).toEqual(["Doing"]);

    // A viewer reads the owner's board; a stranger is refused; a missing list id is a bad query.
    const viewed = await agent.get(`/tasks/board?listId=${list.id}`).set(friend.auth);
    expect(viewed.status).toBe(200);
    expect(viewed.body.tasks.map((t) => t.title).sort()).toEqual(["Alone", "Parent"]);
    expect(viewed.body.subtasks).toHaveLength(2);
    expect((await agent.get(`/tasks/board?listId=${list.id}`).set(stranger.auth)).status).toBe(404);
    expect((await agent.get("/tasks/board").set(owner.auth)).status).toBe(400);
    expect((await agent.get(`/tasks/board?listId=${list.id}`)).status).toBe(401);
  });

  it("lists the people on a list and assigns only them", async () => {
    const owner = await signUp("owner", "Olive");
    const friend = await signUp("friend", "Fern");
    const stranger = await signUp("stranger");
    const list = (await agent.post("/task-lists").set(owner.auth).send({ name: "Board" })).body.list;
    await agent
      .post("/task-list-shares")
      .set(owner.auth)
      .send({ listId: list.id, sharedWithUserEmail: friend.email, permission: "edit" });

    const members = await agent.get(`/task-list-shares/members/${list.id}`).set(friend.auth);
    expect(members.status).toBe(200);
    expect(members.body.members.map((m) => [m.role, m.displayName])).toEqual([
      ["owner", "Olive"],
      ["edit", "Fern"],
    ]);
    expect((await agent.get(`/task-list-shares/members/${list.id}`).set(stranger.auth)).status).toBe(404);

    const task = (await agent.post("/tasks").set(owner.auth).send({ listId: list.id, title: "Do it", assigneeId: friend.id })).body.task;
    expect(task.assigneeId).toBe(friend.id);
    const mine = await agent.patch(`/tasks/${task.id}`).set(friend.auth).send({ assigneeId: owner.id });
    expect(mine.body.task.assigneeId).toBe(owner.id);
    const bad = await agent.patch(`/tasks/${task.id}`).set(owner.auth).send({ assigneeId: stranger.id });
    expect(bad.status).toBe(400);
    const cleared = await agent.patch(`/tasks/${task.id}`).set(owner.auth).send({ assigneeId: null });
    expect(cleared.body.task.assigneeId).toBeNull();
  });
});

describe("when a task was finished", () => {
  let context;
  let agent;
  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
  });
  afterEach(() => context.cleanup());

  it("stamps completedAt as a task is done and clears it when it reopens", async () => {
    const res = await agent.post("/auth/register").send({ email: `c-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: "d" });
    const auth = { Authorization: `Bearer ${res.body.token}` };
    const list = (await agent.post("/task-lists").set(auth).send({ name: "L" })).body.list;
    const task = (await agent.post("/tasks").set(auth).send({ listId: list.id, title: "T" })).body.task;
    expect(task.completedAt).toBeNull();
    const done = (await agent.patch(`/tasks/${task.id}`).set(auth).send({ isDone: true })).body.task;
    expect(done.completedAt).toBeGreaterThan(0);
    const edited = (await agent.patch(`/tasks/${task.id}`).set(auth).send({ notes: "later" })).body.task;
    expect(edited.completedAt).toBe(done.completedAt);
    const reopened = (await agent.patch(`/tasks/${task.id}`).set(auth).send({ isDone: false })).body.task;
    expect(reopened.completedAt).toBeNull();
  });
});

describe("assignee notifications and wider live changes", () => {
  let context;
  let agent;
  let server;
  let port;

  async function signUp(tag, displayName) {
    const res = await agent.post("/auth/register").send({ email: `${tag}-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: "d" });
    const auth = { Authorization: `Bearer ${res.body.token}` };
    if (displayName) await agent.put("/profile").set(auth).send({ displayName });
    return { email: res.body.user.email, id: res.body.user.id, auth };
  }
  async function connect(user) {
    const { body } = await agent.post("/live/ticket").set(user.auth);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live?ticket=${body.ticket}`);
    const messages = [];
    ws.on("message", (m) => messages.push(JSON.parse(String(m))));
    await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
    return { ws, messages };
  }
  const settle = () => new Promise((r) => setTimeout(r, 150));

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    server = createServer(context.app);
    context.app.locals.liveHub.attach(server);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  afterEach(async () => {
    context.app.locals.liveHub.close();
    await new Promise((r) => server.close(r));
    context.cleanup();
  });

  it("notifies the person a task is assigned to, once, and nudges them live", async () => {
    const owner = await signUp("owner", "Olive");
    const friend = await signUp("friend");
    const list = (await agent.post("/task-lists").set(owner.auth).send({ name: "Board" })).body.list;
    await agent.post("/task-list-shares").set(owner.auth).send({ listId: list.id, sharedWithUserEmail: friend.email, permission: "edit" });
    const task = (await agent.post("/tasks").set(owner.auth).send({ listId: list.id, title: "Paint fence" })).body.task;
    const live = await connect(friend);
    await settle();
    await agent.patch(`/tasks/${task.id}`).set(owner.auth).send({ assigneeId: friend.id });
    await agent.patch(`/tasks/${task.id}`).set(owner.auth).send({ notes: "no new notification" });
    await settle();
    expect(live.messages.some((m) => m.type === "notify" && m.kind === "notifications")).toBe(true);
    const res = await agent.get("/notifications").set(friend.auth);
    const mine = res.body.notifications.filter((n) => n.type === "task_assigned");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: "Task assigned to you", resourceId: task.id, listId: list.id });
    expect(mine[0].message).toContain("Olive assigned you Paint fence");
    // assigning yourself tells nobody
    await agent.patch(`/tasks/${task.id}`).set(owner.auth).send({ assigneeId: owner.id });
    expect((await agent.get("/notifications").set(owner.auth)).body.notifications.filter((n) => n.type === "task_assigned")).toHaveLength(0);
    live.ws.close();
  });

  it("announces note changes to the people a note is shared with", async () => {
    const owner = await signUp("owner");
    const friend = await signUp("friend");
    const note = (await agent.post("/notes").set(owner.auth).send({ title: "N", bodyMarkdown: "x" })).body.note;
    const sh = await agent.post("/note-shares").set(owner.auth).send({ noteId: note.id, sharedWithUserEmail: friend.email, permission: "view" });
    expect(sh.status).toBe(201);
    const live = await connect(friend);
    await settle();
    const patched = await agent.patch(`/notes/${note.id}`).set(owner.auth).send({ bodyMarkdown: "y" });
    expect(patched.status).toBe(200);
    await settle();
    expect(live.messages.some((m) => m.type === "changed" && m.kind === "notes")).toBe(true);
    live.ws.close();
  });
});

describe("sharing a note", () => {
  it("is only for its owner", async () => {
    const context = await createTestContext();
    const agent = request(context.app);
    const up = async (tag) => {
      const r = await agent.post("/auth/register").send({ email: `${tag}-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: "d" });
      return { email: r.body.user.email, auth: { Authorization: `Bearer ${r.body.token}` } };
    };
    const owner = await up("owner");
    const other = await up("other");
    const note = (await agent.post("/notes").set(owner.auth).send({ title: "Secret", bodyMarkdown: "x" })).body.note;
    const grab = await agent.post("/note-shares").set(other.auth).send({ noteId: note.id, sharedWithUserEmail: other.email, permission: "view" });
    expect([400, 403]).toContain(grab.status);
    const steal = await agent.post("/note-shares").set(other.auth).send({ noteId: note.id, sharedWithUserEmail: owner.email, permission: "view" });
    expect(steal.status).toBe(403);
    const ok = await agent.post("/note-shares").set(owner.auth).send({ noteId: note.id, sharedWithUserEmail: other.email, permission: "view" });
    expect(ok.status).toBe(201);
    context.cleanup();
  });
});

describe("managing shares by their owner", () => {
  it("lets only the owner (or the person shared with) change or remove a share", async () => {
    const context = await createTestContext();
    const agent = request(context.app);
    const up = async (tag) => {
      const r = await agent.post("/auth/register").send({ email: `${tag}-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: "d" });
      return { email: r.body.user.email, auth: { Authorization: `Bearer ${r.body.token}` } };
    };
    const owner = await up("owner");
    const friend = await up("friend");
    const other = await up("other");

    // notes
    const note = (await agent.post("/notes").set(owner.auth).send({ title: "N", bodyMarkdown: "x" })).body.note;
    const ns = (await agent.post("/note-shares").set(owner.auth).send({ noteId: note.id, sharedWithUserEmail: friend.email, permission: "view" })).body.share;
    expect((await agent.get(`/note-shares/note/${note.id}`).set(other.auth)).status).toBe(403);
    expect((await agent.patch(`/note-shares/${ns.id}`).set(other.auth).send({ permission: "edit" })).status).toBe(403);
    expect((await agent.patch(`/note-shares/${ns.id}`).set(friend.auth).send({ permission: "edit" })).status).toBe(403);
    expect((await agent.patch(`/note-shares/${ns.id}`).set(owner.auth).send({ permission: "edit" })).status).toBe(200);
    expect((await agent.delete(`/note-shares/${ns.id}`).set(other.auth)).status).toBe(403);
    expect((await agent.delete(`/note-shares/${ns.id}`).set(owner.auth)).status).toBe(200);

    // task lists
    const list = (await agent.post("/task-lists").set(owner.auth).send({ name: "L" })).body.list;
    const ls = (await agent.post("/task-list-shares").set(owner.auth).send({ listId: list.id, sharedWithUserEmail: friend.email, permission: "view" })).body.share;
    expect((await agent.patch(`/task-list-shares/${ls.id}`).set(other.auth).send({ permission: "edit" })).status).toBe(403);
    expect((await agent.patch(`/task-list-shares/${ls.id}`).set(friend.auth).send({ permission: "edit" })).status).toBe(403);
    expect((await agent.patch(`/task-list-shares/${ls.id}`).set(owner.auth).send({ permission: "edit" })).status).toBe(200);
    expect((await agent.delete(`/task-list-shares/${ls.id}`).set(other.auth)).status).toBe(403);
    expect((await agent.delete(`/task-list-shares/${ls.id}`).set(friend.auth)).status).toBe(200);

    // single tasks
    const task = (await agent.post("/tasks").set(owner.auth).send({ listId: list.id, title: "T" })).body.task;
    const ts = await agent.post("/task-shares").set(owner.auth).send({ taskId: task.id, sharedWithUserEmail: friend.email, permission: "view" });
    expect(ts.status).toBe(201);
    expect((await agent.patch(`/task-shares/${ts.body.share.id}`).set(other.auth).send({ permission: "edit" })).status).toBe(403);
    expect((await agent.delete(`/task-shares/${ts.body.share.id}`).set(other.auth)).status).toBe(403);
    expect((await agent.delete(`/task-shares/${ts.body.share.id}`).set(owner.auth)).status).toBe(200);
    context.cleanup();
  });
});
