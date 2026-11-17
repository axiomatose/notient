/**
 * Component: Web bundle address
 * Documentation: documentation/backend/self-hosting.md
 *
 * The web app bakes its server address in when it is built. The published image is built with a
 * placeholder address; at start the server copies the bundle and swaps the placeholder for
 * PUBLIC_URL, so one image serves any domain.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PLACEHOLDER_HOST = "notient-placeholder.invalid";

const TEXT = new Set([".js", ".mjs", ".json", ".html", ".grants", ".ts", ".map", ".css", ".txt"]);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

/** Copies `source` to `target`, pointing every baked address at `publicUrl`. Returns `target`. */
export function prepareWebBundle({ source, publicUrl, target }) {
  const { origin, host } = new URL(publicUrl);
  const socket = origin.replace(/^http/, "ws");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  let changed = 0;
  for (const file of files(target)) {
    if (!TEXT.has(path.extname(file))) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes(PLACEHOLDER_HOST)) continue;
    const next = text
      .replaceAll(`https://${PLACEHOLDER_HOST}`, () => origin)
      .replaceAll(`wss://${PLACEHOLDER_HOST}`, () => socket)
      .replaceAll(PLACEHOLDER_HOST, () => host);
    writeFileSync(file, next);
    changed += 1;
  }
  return { dir: target, changed };
}
