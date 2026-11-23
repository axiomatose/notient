import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

describe("templates", () => {
  let context;
  let agent;
  let me;
  let other;

  async function signUp(tag) {
    const res = await agent.post("/auth/register").send({ email: `${tag}-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: `${tag} device` });
    expect(res.status).toBe(201);
    return { auth: { Authorization: `Bearer ${res.body.token}` } };
  }

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    me = await signUp("me");
    other = await signUp("other");
  });

  afterEach(() => context.cleanup());

  it("saves a note and a list template and hands them back, oldest first", async () => {
    const n = await agent.post("/templates").set(me.auth).send({ kind: "note", name: "Meeting", payload: { title: "Meeting", body: "## Agenda" } });
    expect(n.status).toBe(201);
    const l = await agent.post("/templates").set(me.auth).send({
      kind: "list",
      name: "Trip",
      payload: { sections: [{ name: "Before" }], tasks: [{ title: "Passport", section: 0, priority: 2, subtasks: ["Renew"] }] },
    });
    expect(l.status).toBe(201);
    const res = await agent.get("/templates").set(me.auth);
    expect(res.body.templates.map((t) => t.name)).toEqual(["Meeting", "Trip"]);
    expect(res.body.templates[1].payload.tasks[0].subtasks).toEqual(["Renew"]);
    expect(res.body.templates[1].payload.sections[0].icon).toBe("");
  });

  it("keeps templates private and refuses bad ones", async () => {
    const made = await agent.post("/templates").set(me.auth).send({ kind: "note", name: "Mine", payload: { title: "", body: "x" } });
    expect((await agent.get("/templates").set(other.auth)).body.templates).toEqual([]);
    expect((await agent.delete(`/templates/${made.body.template.id}`).set(other.auth)).status).toBe(404);
    expect((await agent.post("/templates").set(me.auth).send({ kind: "list", name: "", payload: {} })).status).toBe(400);
    expect((await agent.post("/templates").set(me.auth).send({ kind: "note", name: "x", payload: { body: 5 } })).status).toBe(400);
    expect((await agent.delete(`/templates/${made.body.template.id}`).set(me.auth)).status).toBe(200);
    expect((await agent.get("/templates").set(me.auth)).body.templates).toEqual([]);
  });
});
