import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

describe("list and section icon/color", () => {
  let context;
  let agent;
  let authHeader;

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    const res = await agent.post("/auth/register").send({
      email: `icons-${nanoid(6)}@example.com`,
      password: "Passw0rd!23",
      deviceName: "Icon Device",
    });
    expect(res.status).toBe(201);
    authHeader = { Authorization: `Bearer ${res.body.token}` };
  });

  afterEach(() => {
    context.cleanup();
  });

  it("round-trips task list icon and color on create, update and list", async () => {
    const created = await agent
      .post("/task-lists")
      .set(authHeader)
      .send({ name: "Groceries", icon: "shopping-cart", color: "#f59e0b" });
    expect(created.status).toBe(201);
    expect(created.body.list.icon).toBe("shopping-cart");
    expect(created.body.list.color).toBe("#f59e0b");

    const updated = await agent
      .patch(`/task-lists/${created.body.list.id}`)
      .set(authHeader)
      .send({ icon: "star", color: "" });
    expect(updated.status).toBe(200);
    expect(updated.body.list.icon).toBe("star");
    expect(updated.body.list.color).toBeNull();

    const listed = await agent.get("/task-lists").set(authHeader);
    const found = listed.body.lists.find((l) => l.id === created.body.list.id);
    expect(found.icon).toBe("star");
    expect(found.color).toBeNull();
  });

  it("round-trips task section icon and color on create, update and list", async () => {
    const list = await agent
      .post("/task-lists")
      .set(authHeader)
      .send({ name: "Work" });
    const listId = list.body.list.id;

    const created = await agent
      .post("/task-sections")
      .set(authHeader)
      .send({ listId, name: "Urgent", icon: "flame", color: "#ef4444" });
    expect(created.status).toBe(201);
    expect(created.body.section.icon).toBe("flame");
    expect(created.body.section.color).toBe("#ef4444");

    const sectionId = created.body.section.id;
    const updated = await agent
      .patch(`/task-sections/${sectionId}`)
      .set(authHeader)
      .send({ icon: "bolt", color: "#22c55e" });
    expect(updated.status).toBe(200);
    expect(updated.body.section.icon).toBe("bolt");
    expect(updated.body.section.color).toBe("#22c55e");
    expect(updated.body.section.name).toBe("Urgent");

    const cleared = await agent
      .patch(`/task-sections/${sectionId}`)
      .set(authHeader)
      .send({ icon: "" });
    expect(cleared.body.section.icon).toBeNull();

    const listed = await agent
      .get(`/task-sections?listId=${listId}`)
      .set(authHeader);
    const found = listed.body.sections.find((s) => s.id === sectionId);
    expect(found.color).toBe("#22c55e");
    expect(found.icon).toBeNull();
  });

  it("serves Lucide icon paths for an existing icon", async () => {
    const res = await agent.get("/lucide/star").set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("star");
    expect(Array.isArray(res.body.paths)).toBe(true);
    expect(res.body.paths.length).toBeGreaterThan(0);
    expect(res.body.paths.every((d) => typeof d === "string")).toBe(true);
  });

  it("returns 404 icon_not_found for an unknown icon", async () => {
    const res = await agent.get("/lucide/not-an-icon").set(authHeader);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "icon_not_found" });
  });

  it("returns 404 for an invalid icon name", async () => {
    const res = await agent.get("/lucide/..%2Fpackage").set(authHeader);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "icon_not_found" });
  });

  it("searches icon names by substring", async () => {
    const res = await agent.get("/lucide-search?q=sta").set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body.names).toContain("star");
    expect(res.body.names.length).toBeLessThanOrEqual(24);
  });

  it("requires authentication for icon routes", async () => {
    const res = await agent.get("/lucide/star");
    expect(res.status).toBe(401);
  });
});
