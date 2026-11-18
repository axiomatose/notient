import { createServer } from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import express from "express";
import { loadConfig } from "./src/config.js";
import { initializeDatabase } from "./src/db/index.js";
import { buildApp } from "./src/server.js";
import { createRepositories } from "./src/db/index.js";
import { createFileStorage } from "./src/lib/storage.js";
import { ensureDemoUser } from "./src/lib/seedUser.js";
import logger from "./src/utils/logger.js";
import { prepareWebBundle } from "./src/lib/webBundle.js";

const config = loadConfig();
const db = initializeDatabase(config);

// Serve the built web client from this origin when WEB_DIST is set, so the
// browser app and the API it calls share one address (one port, no CORS).
let webDist = process.env.WEB_DIST;
// A bundle built with the placeholder address is pointed at PUBLIC_URL (lib/webBundle.js).
if (webDist) {
  const prepared = prepareWebBundle({
    source: webDist,
    publicUrl: config.publicUrl,
    target: path.join(os.tmpdir(), "notient-web"),
  });
  webDist = prepared.dir;
}
const app = express();
if (webDist) {
  // The app's own routes (the only GETs that should return the client shell);
  // everything else falls through to the API. /public/:slug is the app's
  // public-note viewer; the API's data endpoint is /public/notes/:slug.
  const appRoute = /^(?:\/|\/new|\/trash|\/privacy|\/terms|\/tasks|\/calendar|\/new-event|\/(?:note|share|shared|public|tasks|edit-list|task|share-list|event)\/[^/]+)$/;
  // The client shell gets web/notient-keyboard.js (iOS keyboard viewport fix)
  // added to its head; exact's web build has no hook for page scripts.
  const shimDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");
  const shell = () =>
    readFileSync(path.join(webDist, "index.html"), "utf8").replace(
      "<title>",
      '<script src="/notient-keyboard.js"></script><title>',
    );
  app.get("/notient-keyboard.js", (_req, res) => res.sendFile(path.join(shimDir, "notient-keyboard.js")));
  app.use(express.static(webDist, { index: false }));
  app.use((req, res, next) => {
    // A browser navigation never carries the API's Authorization header.
    if (req.method !== "GET" || req.get("authorization") || !appRoute.test(req.path)) {
      return next();
    }
    res.type("html").set("Cache-Control", "no-cache").send(shell());
  });
}

// The demo account for testing and the live demo (SEED_DEMO_USER=true; demo@demo.com). Created once, kept after that.
if (config.seedDemoUser) {
  try {
    const made = await ensureDemoUser({ repos: createRepositories(db, config), config, storage: createFileStorage(config) });
    logger.info(`Demo user ${made}`);
  } catch (error) {
    logger.error({ err: error }, "Demo user could not be created");
  }
}

const api = await buildApp({ config, db });
app.use(api);

const httpServer = createServer(app);
api.locals.liveHub?.attach(httpServer);

httpServer.listen(config.port, config.host, () => {
  logger.info(
    `API listening on http://${config.host}:${config.port} (env: ${config.env})`,
  );
});
