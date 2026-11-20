import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

// A 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("task attachments on a shared list", () => {
  let context;
  let agent;
  let owner;
  let editor;
  let viewer;
  let stranger;
  let taskId;

  async function signUp(tag) {
    const res = await agent.post("/auth/register").send({ email: `${tag}-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: `${tag} device` });
    expect(res.status).toBe(201);
    return { email: res.body.user.email, auth: { Authorization: `Bearer ${res.body.token}` } };
  }
  const upload = (who) => agent.post(`/task-attachments/task/${taskId}/images`).set(who.auth).attach("image", PNG, { filename: "a.png", contentType: "image/png" });

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    owner = await signUp("owner");
    editor = await signUp("editor");
    viewer = await signUp("viewer");
    stranger = await signUp("stranger");
    const list = await agent.post("/task-lists").set(owner.auth).send({ name: "Board" });
    const listId = list.body.list.id;
    await agent.post("/task-list-shares").set(owner.auth).send({ listId, sharedWithUserEmail: editor.email, permission: "edit" });
    await agent.post("/task-list-shares").set(owner.auth).send({ listId, sharedWithUserEmail: viewer.email, permission: "view" });
    const task = await agent.post("/tasks").set(owner.auth).send({ listId, title: "Pictures" });
    taskId = task.body.task.id;
  });

  afterEach(() => context.cleanup());

  it("lets an editor add an image that the owner, the editor and a viewer can all list", async () => {
    const up = await upload(editor);
    expect(up.status).toBe(201);
    for (const who of [owner, editor, viewer]) {
      const res = await agent.get(`/task-attachments/task/${taskId}`).set(who.auth);
      expect(res.status).toBe(200);
      expect(res.body.attachments).toHaveLength(1);
    }
  });

  it("keeps a viewer from adding or removing and a stranger from seeing anything", async () => {
    const up = await upload(owner);
    expect(up.status).toBe(201);
    expect((await upload(viewer)).status).toBe(403);
    const id = (await agent.get(`/task-attachments/task/${taskId}`).set(owner.auth)).body.attachments[0].id;
    expect((await agent.delete(`/task-attachments/${id}`).set(viewer.auth)).status).toBe(403);
    expect((await agent.get(`/task-attachments/task/${taskId}`).set(stranger.auth)).status).toBe(404);
    expect((await upload(stranger)).status).toBe(404);
    expect((await agent.delete(`/task-attachments/${id}`).set(editor.auth)).status).toBe(200);
  });
});
