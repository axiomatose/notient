import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareWebBundle, PLACEHOLDER_HOST } from "../src/lib/webBundle.js";

describe("web bundle address", () => {
  it("points the placeholder at PUBLIC_URL and leaves the source alone", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "nb-"));
    const src = path.join(root, "src");
    mkdirSync(path.join(src, ".gen"), { recursive: true });
    writeFileSync(path.join(src, "app.js"), `fetch("https://${PLACEHOLDER_HOST}/x"); new WebSocket("wss://${PLACEHOLDER_HOST}/live")`);
    writeFileSync(path.join(src, ".gen", "a.grants"), `net.fetch https://${PLACEHOLDER_HOST}\nnet.websocket wss://${PLACEHOLDER_HOST}`);
    writeFileSync(path.join(src, "logo.png"), `https://${PLACEHOLDER_HOST}`);
    const out = prepareWebBundle({ source: src, publicUrl: "https://notes.example.com:8443/", target: path.join(root, "out") });
    expect(out.changed).toBe(2);
    expect(readFileSync(path.join(root, "out", "app.js"), "utf8")).toBe('fetch("https://notes.example.com:8443/x"); new WebSocket("wss://notes.example.com:8443/live")');
    expect(readFileSync(path.join(root, "out", ".gen", "a.grants"), "utf8")).toBe("net.fetch https://notes.example.com:8443\nnet.websocket wss://notes.example.com:8443");
    expect(readFileSync(path.join(root, "out", "logo.png"), "utf8")).toContain(PLACEHOLDER_HOST);
    expect(readFileSync(path.join(src, "app.js"), "utf8")).toContain(PLACEHOLDER_HOST);
    // plain http, for a LAN address
    const lan = prepareWebBundle({ source: src, publicUrl: "http://192.168.1.5:3301", target: path.join(root, "lan") });
    expect(readFileSync(path.join(root, "lan", "app.js"), "utf8")).toContain("ws://192.168.1.5:3301/live");
    expect(lan.changed).toBe(2);
  });
});
