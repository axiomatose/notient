import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { nanoid } from "nanoid";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createTestContext } from "./helpers/testUtils.js";
import { createRepositories } from "../src/db/index.js";

describe("notes on disk and export", () => {
  let context;
  let agent;
  let auth;
  let userId;

  const notesDir = () => context.config.notesDir;
  const zipOf = (res) => new AdmZip(res.body).getEntries().map((e) => e.entryName).sort();

  async function add(body) {
    const res = await agent.post("/notes").set(auth).send(body);
    expect(res.status).toBe(201);
    return res.body.note;
  }

  beforeEach(async () => {
    context = await createTestContext();
    agent = request(context.app);
    const res = await agent.post("/auth/register").send({ email: `n-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: "d" });
    auth = { Authorization: `Bearer ${res.body.token}` };
    userId = res.body.user.id;
  });

  afterEach(() => context.cleanup());

  it("keeps each note as one file under its folders, and moves it with the folder", async () => {
    const n = await add({ title: "Plan", bodyMarkdown: "Body\n", folder: "Work/2024" });
    const at = join(notesDir(), userId, "Work", "2024", `${n.id}.md`);
    expect(readFileSync(at, "utf8")).toBe("Body\n");
    const loose = await add({ title: "Loose", bodyMarkdown: "x" });
    expect(existsSync(join(notesDir(), userId, `${loose.id}.md`))).toBe(true);

    const moved = await agent.patch(`/notes/${n.id}`).set(auth).send({ folder: "Home" });
    expect(moved.status).toBe(200);
    expect(existsSync(at)).toBe(false);
    expect(existsSync(join(notesDir(), userId, "Work"))).toBe(false);
    expect(readFileSync(join(notesDir(), userId, "Home", `${n.id}.md`), "utf8")).toBe("Body\n");
    expect((await agent.get(`/notes/${n.id}`).set(auth)).body.note.bodyMarkdown).toBe("Body\n");

    const edited = await agent.patch(`/notes/${n.id}`).set(auth).send({ folder: null, bodyMarkdown: "New\n" });
    expect(edited.status).toBe(200);
    expect(readFileSync(join(notesDir(), userId, `${n.id}.md`), "utf8")).toBe("New\n");
    expect(existsSync(join(notesDir(), userId, "Home"))).toBe(false);
  });

  it("never lets a folder name leave the user's directory", async () => {
    const n = await add({ title: "Sneaky", bodyMarkdown: "x", folder: "../../evil/a:b" });
    expect(existsSync(join(notesDir(), userId, "evil", "a b", `${n.id}.md`))).toBe(true);
  });

  it("moves notes saved in the old flat layout into their folders", async () => {
    const n = await add({ title: "Old", bodyMarkdown: "legacy", folder: "A/B" });
    const nested = join(notesDir(), userId, "A", "B", `${n.id}.md`);
    const flat = join(notesDir(), userId, `${n.id}.md`);
    writeFileSync(flat, readFileSync(nested, "utf8"));
    mkdirSync(join(notesDir(), userId), { recursive: true });
    rmSyncFile(nested);
    expect((await agent.get(`/notes/${n.id}`).set(auth)).body.note.bodyMarkdown).toBe("legacy");
    const repos = createRepositories(context.db, context.config);
    expect(repos.notes.migrateLayout()).toBe(1);
    expect(existsSync(nested)).toBe(true);
    expect(existsSync(flat)).toBe(false);
    expect(repos.notes.migrateLayout()).toBe(0);
  });

  it("exports one note, a folder with its subfolders, and the whole library", async () => {
    await add({ title: "Solo", bodyMarkdown: "alone" });
    await add({ title: "Plan", bodyMarkdown: "p", folder: "Work" });
    await add({ title: "Plan", bodyMarkdown: "q", folder: "Work" });
    await add({ title: "Deep", bodyMarkdown: "d", folder: "Work/2024" });
    await add({ title: "Other", bodyMarkdown: "o", folder: "Home" });
    const solo = (await agent.get("/notes").set(auth)).body.notes.find((x) => x.title === "Solo");

    const one = await agent.get(`/notes/${solo.id}/export`).set(auth);
    expect(one.status).toBe(200);
    expect(one.headers["content-disposition"]).toContain("Solo.md");
    expect(one.text).toBe("# Solo\n\nalone");

    const zip = (q) => agent.get(`/notes/export${q}`).set(auth).buffer(true).parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
    expect(zipOf(await zip(""))).toEqual(["Home/Other.md", "Solo.md", "Work/2024/Deep.md", "Work/Plan (2).md", "Work/Plan.md"]);
    expect(zipOf(await zip("?folder=Work"))).toEqual(["Work/2024/Deep.md", "Work/Plan (2).md", "Work/Plan.md"]);
  });

  it("leaves vault notes out of a library or folder export unless asked, and names them vault-", async () => {
    await add({ title: "Plain", bodyMarkdown: "p" });
    const v = await add({ title: "Codes", bodyMarkdown: "secret", tags: ["vault"], folder: "Safe" });
    const zip = (q) => agent.get(`/notes/export${q}`).set(auth).buffer(true).parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
    expect(zipOf(await zip(""))).toEqual(["Plain.md"]);
    expect(zipOf(await zip("?includeVaults=1"))).toEqual(["Plain.md", "Safe/vault-Codes.md"]);
    expect(zipOf(await zip("?folder=Safe"))).toEqual([]);
    const one = await agent.get(`/notes/${v.id}/export`).set(auth);
    expect(one.headers["content-disposition"]).toContain("vault-Codes.md");
  });

  it("exports only the signed-in person's notes", async () => {
    await add({ title: "Mine", bodyMarkdown: "m" });
    const o = await agent.post("/auth/register").send({ email: `o-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: "d" });
    const res = await agent.get("/notes/export").set({ Authorization: `Bearer ${o.body.token}` }).buffer(true).parse((r, cb) => { const c = []; r.on("data", (d) => c.push(d)); r.on("end", () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(zipOf(res)).toEqual([]);
  });
});

import { rmSync } from "node:fs";
function rmSyncFile(p) {
  rmSync(p, { force: true });
}
