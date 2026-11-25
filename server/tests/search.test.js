import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

describe("search", () => {
  let context;
  let agent;
  let me;
  let other;

  async function signUp(tag) {
    const res = await agent.post("/auth/register").send({ email: `${tag}-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: `${tag} device` });
    expect(res.status).toBe(201);
    return { Authorization: `Bearer ${res.body.token}` };
  }

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    me = await signUp("me");
    other = await signUp("other");
    await agent.post("/notes").set(me).send({ title: "Garden plan", bodyMarkdown: "Plant the tomatoes in May", folder: "Home" });
    await agent.post("/notes").set(me).send({ title: "Wifi", bodyMarkdown: "tomato-secret-pass", tags: ["vault"] });
    await agent.post("/notes").set(other).send({ title: "Tomato soup", bodyMarkdown: "not mine" });
    const list = await agent.post("/task-lists").set(me).send({ name: "Chores" });
    await agent.post("/tasks").set(me).send({ listId: list.body.list.id, title: "Buy tomato seeds" });
    const cal = await agent.post("/calendars").set(me).send({ name: "Home", color: "#007AFF", type: "internal" });
    await agent.post(`/calendars/${cal.body.calendar.id}/events`).set(me).send({ title: "Tomato festival", startTime: Date.now() + 1e8, endTime: Date.now() + 1.1e8 });
  });

  afterEach(() => context.cleanup());

  it("finds notes, tasks and events, only the caller's, and never reads a vault body", async () => {
    const res = await agent.get("/search").query({ q: "Tomato" }).set(me);
    expect(res.status).toBe(200);
    expect(res.body.notes.map((n) => n.title)).toEqual(["Garden plan"]);
    expect(res.body.notes[0].snippet).toContain("tomatoes");
    expect(res.body.tasks.map((t) => t.title)).toEqual(["Buy tomato seeds"]);
    expect(res.body.tasks[0].listName).toBe("Chores");
    expect(res.body.events.map((e) => e.title)).toEqual(["Tomato festival"]);
  });

  it("finds folders (made on purpose or holding notes) and task lists by name", async () => {
    await agent.post("/note-folders").set(me).send({ name: "Chores", parent: "Home" });
    const home = await agent.get("/search").query({ q: "home" }).set(me);
    expect(home.body.folders).toEqual(["Home", "Home/Chores"]);
    const chores = await agent.get("/search").query({ q: "chores" }).set(me);
    expect(chores.body.folders).toEqual(["Home/Chores"]);
    expect(chores.body.lists.map((l) => l.name)).toEqual(["Chores"]);
  });

  it("matches a vault note by its title only", async () => {
    const res = await agent.get("/search").query({ q: "wifi" }).set(me);
    expect(res.body.notes.map((n) => n.title)).toEqual(["Wifi"]);
    expect(res.body.notes[0].snippet).toBe("");
  });

  it("treats % and _ as plain characters and refuses an empty search", async () => {
    expect((await agent.get("/search").query({ q: "%" }).set(me)).body.tasks).toEqual([]);
    expect((await agent.get("/search").query({ q: " " }).set(me)).status).toBe(400);
  });
});
