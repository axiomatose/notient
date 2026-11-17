import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("profile avatar icon/color and photo", () => {
  let context;
  let agent;
  let authHeader;
  let userId;

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    const res = await agent.post("/auth/register").send({
      email: `profile-${nanoid(6)}@example.com`,
      password: "Passw0rd!23",
      deviceName: "Profile Device",
    });
    expect(res.status).toBe(201);
    authHeader = { Authorization: `Bearer ${res.body.token}` };
    userId = res.body.user.id;
  });

  afterEach(() => {
    context.cleanup();
  });

  it("returns null avatarIcon/avatarColor by default", async () => {
    const res = await agent.get("/profile").set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body.avatarIcon).toBeNull();
    expect(res.body.avatarColor).toBeNull();
    expect(res.body.avatar).toBeNull();
  });

  it("round-trips avatarIcon and avatarColor and clears them with empty strings", async () => {
    const set = await agent
      .put("/profile")
      .set(authHeader)
      .send({ avatarIcon: "user-round", avatarColor: "#3b82f6" });
    expect(set.status).toBe(200);
    expect(set.body.avatarIcon).toBe("user-round");
    expect(set.body.avatarColor).toBe("#3b82f6");

    const partial = await agent
      .put("/profile")
      .set(authHeader)
      .send({ avatarColor: "" });
    expect(partial.body.avatarIcon).toBe("user-round");
    expect(partial.body.avatarColor).toBeNull();

    const cleared = await agent
      .put("/profile")
      .set(authHeader)
      .send({ avatarIcon: "" });
    expect(cleared.body.avatarIcon).toBeNull();

    const fetched = await agent.get("/profile").set(authHeader);
    expect(fetched.body.avatarIcon).toBeNull();
    expect(fetched.body.avatarColor).toBeNull();
  });

  it("rejects avatarIcon longer than 48 characters", async () => {
    const res = await agent
      .put("/profile")
      .set(authHeader)
      .send({ avatarIcon: "a".repeat(49) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");
  });

  it("uploads a photo, serves it by URL, and deletes it", async () => {
    const upload = await agent
      .post("/profile/avatar")
      .set(authHeader)
      .attach("avatar", TINY_PNG, { filename: "tiny.png", contentType: "image/png" });

    expect(upload.status).toBe(200);
    expect(upload.body.avatar.url).toContain(`/files/profiles/${userId}/avatar.jpg`);
    expect(upload.body.avatar.mimeType).toBe("image/png");

    const profile = await agent.get("/profile").set(authHeader);
    expect(profile.body.avatar.url).toBe(upload.body.avatar.url);

    const path = new URL(profile.body.avatar.url).pathname;
    const image = await agent.get(path).buffer(true).parse(binaryParser);
    expect(image.status).toBe(200);
    expect(image.body.length).toBe(TINY_PNG.length);

    const removed = await agent.delete("/profile/avatar").set(authHeader);
    expect(removed.status).toBe(200);
    expect(removed.body.avatar).toBeNull();

    const gone = await agent.get(path);
    expect(gone.status).toBe(404);
  });
});

function binaryParser(res, callback) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}
