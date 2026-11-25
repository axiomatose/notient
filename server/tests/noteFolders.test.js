import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

describe("note folders", () => {
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
  });

  afterEach(() => context.cleanup());

  it("makes an empty folder, nested under a parent, private to its owner", async () => {
    expect((await agent.post("/note-folders").set(me).send({ name: "Dev" })).body.path).toBe("Dev");
    const nested = await agent.post("/note-folders").set(me).send({ name: "Auth", parent: "Dev" });
    expect(nested.status).toBe(201);
    expect(nested.body.path).toBe("Dev/Auth");
    await agent.post("/note-folders").set(me).send({ name: "Auth", parent: "Dev" });
    expect((await agent.get("/note-folders").set(me)).body.folders).toEqual(["Dev", "Dev/Auth"]);
    expect((await agent.get("/note-folders").set(other)).body.folders).toEqual([]);
  });

  it("deletes an empty folder with its empty subfolders, but not one that holds a note", async () => {
    await agent.post("/note-folders").set(me).send({ name: "Dev" });
    await agent.post("/note-folders").set(me).send({ name: "Auth", parent: "Dev" });
    await agent.post("/note-folders").set(me).send({ name: "Other" });
    const note = await agent.post("/notes").set(me).send({ title: "n", bodyMarkdown: "x", folder: "Dev/Auth" });
    expect(note.status).toBe(201);
    const blocked = await agent.delete("/note-folders").query({ path: "Dev" }).set(me);
    expect(blocked.status).toBe(409);
    expect((await agent.delete("/note-folders").query({ path: "Other" }).set(me)).status).toBe(204);
    expect((await agent.get("/note-folders").set(me)).body.folders).toEqual(["Dev", "Dev/Auth"]);
    expect((await agent.delete("/note-folders").query({ path: "" }).set(me)).status).toBe(400);
  });

  it("refuses a name with a slash or dots", async () => {
    expect((await agent.post("/note-folders").set(me).send({ name: "a/b" })).status).toBe(400);
    expect((await agent.post("/note-folders").set(me).send({ name: ".." })).status).toBe(400);
    expect((await agent.post("/note-folders").set(me).send({ name: "x", parent: "../y" })).status).toBe(400);
  });
});
