# Self-hosting and the published image

**Status:** ✅ Implemented | one container serves API + web; image on ghcr.io

## Overview
`ghcr.io/axiomatose/notient` (built by `.github/workflows/docker.yml`, manual trigger) runs the Express API and serves the web app from the same origin. Settings come from `.env` (`.env.example`, `server/.env.example`).

## Key Details
- **One image, any domain:** the web bundle is built with `API_BASE_URL=https://notient-placeholder.invalid`, `SOCKET_URL=wss://notient-placeholder.invalid`. At start `server/index.js` calls `prepareWebBundle` (`server/src/lib/webBundle.js`): copies `WEB_DIST` to `$TMPDIR/notient-web` and replaces the placeholder in text files with `config.publicUrl` (`https://` → origin, `wss://` → `ws(s)://` origin, bare host → host). The source bundle is never modified, so changing `PUBLIC_URL` and restarting is enough.
- **Why grants are scheme-wide:** the app's grants (`app/app.ts`) are `net.fetch https: / http: / local-network`, `net.websocket wss: / ws: / local-network`. A grant naming the build's origin is sealed by the build (FNV `seal` in the grant set, checked by `grant-admission.js`), so rewriting the origin would invalidate it. ATS still blocks plain http beyond the LAN on Apple platforms.
- **Native apps:** sign-in page → "Use your own server" (`secret.keep server`); saving signs out. `originOf(store)` in `app.ts` picks it over the build's address.
- **Dockerfile:** node:22-slim; `web-dist/` (filled by CI, `.gitkeep` otherwise) is exported as `WEB_DIST` when it holds `index.html`.
- **Data:** `DATA_DIR` (`/data` in compose): `app.db`, `notes/`, `uploads/`.

## Image workflow
- Actions → "Docker image" → Run workflow; inputs `tag` (default `latest`), `exact_repo`, `exact_ref`. Secret `EXACT_TOKEN` only if Exact is private.
- Builds linux/amd64 + linux/arm64; tags `<tag>` and `sha-<short>`; pushes with `GITHUB_TOKEN`.

## Related
- [pwa-install.md](pwa-install.md) - Installing the web app
- [collaboration.md](collaboration.md) - Live channel and shares
