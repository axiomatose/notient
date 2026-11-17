import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

describe("POST /auth/change-password", () => {
  let context;
  let agent;
  let email;
  let token;
  const password = "Passw0rd!23";
  const newPassword = "N3wPassw0rd!";

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    email = `pw-${nanoid(6)}@example.com`;
    const res = await agent.post("/auth/register").send({
      email,
      password,
      deviceName: "Password Device",
    });
    expect(res.status).toBe(201);
    token = res.body.token;
  });

  afterEach(() => {
    context.cleanup();
  });

  const authHeader = () => ({ Authorization: `Bearer ${token}` });

  it("changes the password and the new password logs in", async () => {
    const res = await agent
      .post("/auth/change-password")
      .set(authHeader())
      .send({ currentPassword: password, newPassword });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const oldLogin = await agent.post("/auth/login").send({ email, password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await agent
      .post("/auth/login")
      .send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.token).toBeTruthy();
  });

  it("rejects a wrong current password with invalid_credentials", async () => {
    const res = await agent
      .post("/auth/change-password")
      .set(authHeader())
      .send({ currentPassword: "Wr0ngPassword!", newPassword });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");

    const stillOld = await agent.post("/auth/login").send({ email, password });
    expect(stillOld.status).toBe(200);
  });

  it("rejects a weak new password with the register policy", async () => {
    const res = await agent
      .post("/auth/change-password")
      .set(authHeader())
      .send({ currentPassword: password, newPassword: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_body");

    const stillOld = await agent.post("/auth/login").send({ email, password });
    expect(stillOld.status).toBe(200);
  });

  it("requires authentication", async () => {
    const res = await agent
      .post("/auth/change-password")
      .send({ currentPassword: password, newPassword });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("missing_token");
  });

  it("shares the login rate limiter", async () => {
    const maxAttempts = context.config.rateLimits.login.max;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const res = await agent
        .post("/auth/change-password")
        .set(authHeader())
        .send({ currentPassword: "Wr0ngPassword!", newPassword });
      expect(res.status).toBe(401);
    }

    const limited = await agent
      .post("/auth/change-password")
      .set(authHeader())
      .send({ currentPassword: password, newPassword });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("too_many_attempts");
  });
});
