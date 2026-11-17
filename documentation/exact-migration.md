# Exact Migration — API Audit & Plan

**Status:** ✅ Phase 1 (API) + Phase 2 (Exact app: auth, sidebar, notes, tasks, calendar v1) complete

## Overview
Audit of `server/` for the Exact conversion, plus the phased migration plan. Phase 1 modernizes the API in place (no endpoint contract changes).

## Audit Findings (2026-11)

### API Surface
- Express 5, ~90 endpoints, 22 routers under `/server/src/routes/`
- Error shape: `{error: code, message}` via `HttpError` (src/errors.js)
- Sync: vector-clock pull/push (`GET /sync/pull`, `POST /sync/push`) — keep as-is

### Auth
- JWT Bearer (12h) in `Authorization` header only; device records tracked per token
- **No cookie sessions** — web client stores token in localStorage
- `csurf` middleware therefore protects nothing real (deprecated pkg, vulnerable `cookie<0.7` transitively) → removed in Phase 1
- `/auth/csrf-token` endpoint removed with it; old web client logs a harmless error on mutations during transition

### Storage (Phase 1: local disk)
- Files under `DATA_DIR/uploads/<category>/<key>`; served by `GET /files/*splat` (immutable cache; keys are nanoid-unguessable)
- URLs: `${PUBLIC_URL}/files/...` — new `PUBLIC_URL` env (default `http://localhost:3001`)

### Dependencies (Phase 1)
- Removed: `@types/marked`, `csurf`, `cookie-parser`
- Majors bumped: dotenv 18, archiver 8, adm-zip 0.6, file-type 22, marked 18, nanoid 6, uuid 14, web-push 4, node-ical 0.27, better-sqlite3 13, ical-generator 11, argon2 0.45, eslint 10, vitest 5
- Fixes all 8 npm audit vulns (high: adm-zip ≤0.6.0; chains: csurf/cookie, archiver/glob/minimatch)
- Pre-existing breakage fixed: tests failed because `ENCRYPTION_MASTER_KEY` (<32 chars throws, read from process.env in `utils/encryption.js`, not config) was unset in test env; test config also lacked `notesDir`/`vapid`
- Other pre-existing issues left as-is: no eslint flat config exists (`npm run lint` broken), stale CRUD assertion updated to match HTML round-trip contract
- ESM API updates for majors: `archiver` → `new ZipArchive(opts)`, `web-push` → named imports
- `x-csrf-token` kept in CORS allowedHeaders during transition (old web client sends it; server ignores it)

## Exact-Readiness (API side)
- Bearer-only auth: native-ready. CORS: `CORS_ORIGINS` config; native fetch sends no Origin -> allowed; non-production also allows any `localhost`/`127.0.0.1` origin (Exact web dev server)
- Drop candidates for native: web-push/VAPID (-> native push), PWA plugin; keep import/export zip

## Phase 2 (done): the Exact app at `app/`

**Layout:** root tablist (Notes/Tasks/Calendar) = iOS tab bar on a phone, a sidebar at 900px+; per-tab stacks (note detail, task list detail, modal sheets for new note/event); who is signed in is the header persona button -> popover menu (name, email, Sign Out); signed-out shows the sign-in/register form in place.

**Files (`app/`):**
- `app.contract` - the view: routes, shapes, App root (all resources/mutations) + SignIn/NoteEditor/EventEditor children
- `app.ts` - data module: fetch with Bearer token (`secret.keep token/name/email` grants), HTML<->text seam for note bodies, day-grouped events; `API_BASE_URL` env (default `http://127.0.0.1:8787`)
- `server.ts` - spawns the Express API (`node ../server/index.js`) on an empty DB (`DB` env) for `bun exact.mjs test/verify`; `bun server.ts` runs it by hand
- `app.test.contract` - 5 tests (sign-up, note CRUD, sign-out/in, tasks, event); each starts signed-out on empty storage and registers its own account; calendar test pins `epoch`

**Commands (`cd app`):**
- `bun exact.mjs verify` - build + tests + layout checks (clean as of this writing)
- `bun exact.mjs web` - dev loop (start `bun server.ts` first)
- `bun exact.mjs ios --run` - simulator build (not yet run on this machine)

**Notes (full):** list grouped by folder (Unfiled last) with Folder/Tag filter selects and Sort (Newest/Oldest/Title); search across title, body and tags; pin (editor toggle, pinned sort first, pin glyph in rows); tags (comma-separated in editor, drive the Tag filter); folders (free-text in editor, sections + filter built from use); Trash route — soft delete (`deletedAt`), restore, delete-forever (confirm dialog, iOS swipe-to-delete on trash rows); **rich text** — `textarea markup="markdown"` editors (live-rendered markdown, syntax hidden from the caret) with a `format()` toolbar (B/I/H/List/1./Tasks/Quote/Code) in the note editor (new notes open it too); markdown ↔ HTML converted at the app.ts seam (`mdToHtml` on write, `toMarkdown` on read) so the API's turndown/marked store stays clean and formatting round-trips; note images (Add Image picker → `POST /uploads/images` → markdown `![image](url)` appended server-side, rendered inline by the editor); sharing — shareable links (create + auto-copy + revoke, in-app public viewer at `/public/:slug`) and person shares (by email, view/edit permission, Shared-with-me section with read-only viewer); offline reads (`app:/data/notes-cache.json` cache; on a lost connection the last good list shows with an "Offline" row). Server additions: `GET /notes/:id` (was missing), shared-with-me rows now carry file-based bodies. Known framework issue (feedback filed): `text markup="markdown"` readers with resource-derived values crash web boot, so public/shared views show plain text.

**Running the dev loop while testing:** `bun server.ts` (API, 8787) and `bun exact.mjs web` (app, 8765) can stay up; run tests/verify without stopping them via `API_BASE_URL=http://10.144.1.2:8790 bun exact.mjs test web` (or `verify`).

**Phone/remote access (single origin):** `server/index.js` serves the built web client from the API origin when `WEB_DIST` is set (server.ts passes `target/app-dist` — a stable copy: deploy with `mkdir -p target/app-dist && cp -R target/web-dist/. target/app-dist/`; do NOT point it at target/web-dist, whose hashed chunks change on every dev rebuild and strand cached clients) — so `http://10.144.1.2:8787` serves the app AND its API on one port: no CORS, no port mismatch, and API GETs are excluded from the SPA fallback. `.env.local` bakes `API_BASE_URL=http://10.144.1.2:8787` (change it + rebuild if the address changes). `CORS_ORIGINS` covers the dev-loop origins too. The 8765 dev loop remains for development; phone/VPN users should use the 8787 origin. ETags are off (`app.set("etag", false)`) — 304s broke clients reading every reply as a body.

**Tasks (full):** lists filed into folders (folder create inline, Folder select when editing a list, sections by folder with an "Unfiled" bucket); list edit sheet (rename, folder, delete with confirm, share entry); **list sharing** (by email view/edit, remove shares, Shared-with-me section with a read-in list view); **sections** in a list (create inline, tasks added into a chosen section via select, grouped rows with section headers); **task detail editor** (markdown notes editor with the same B/I/H/List/Tasks/Quote toolbar, due date text field, priority None/Low/Medium/High, tags, subtasks with checkboxes, image attachments via the picker, delete with cascade to subtasks); task rows show due labels (formatDay; overdue in red) and priority colors. Server fixes: `GET /tasks?listId=` now returns top-level tasks only (subtasks leak fixed), deleting a task cascades to subtasks, and task-list folder creation no longer stores a NULL id.

**Calendar (full):** Month / Week / Day views (a View select in the toolbar; prev/next steps by month/week/day, Today resets) over a shared cell model — the month view is a real 7-column grid (weekday header, leading/trailing days dimmed, today highlighted, event dots capped at 3, tap a day cell to open that day); events grouped by day with all-day/timed labels; **event detail editor** (tap an event: title, markdown description with toolbar, date, time empty = all-day, location, delete with confirm); **add-event sheet** (title, calendar picker, date, time, description, location); **multiple calendars** (create inline at the bottom of the calendar tab; picker in the add-event sheet; the API's default "Notient Events" + "Tasks Due" are auto-provisioned). Recurrence (Never/Daily/Weekly/Monthly/Yearly → `FREQ=…`) and attendee emails are edited in the add-event sheet and the event editor; task and section ordering uses Move Up/Down controls (task editor + section headers) — Exact's drag `reorderdrop` needs a flat virtualized list, incompatible with grouped sections, so no drag handles; the iOS simulator build runs (`bun exact.mjs ios --run`, iPhone 18 Pro) — registered and browsed on-device. Calendar toolbar layout: header is one wrapped line; period label, View select and nav sit in rows inside a scroll (the whole month content scrolls, so the grid is never squeezed by controls). Known polish debt: at the maximum accessibility text size (53px root) the month grid's last column overruns the 390px phone width by ~10px (14 verify findings, all the same cause) — needs a responsive month fallback (e.g. week-sections list) if it matters.

## Verification
- `npm test` (server): 5/5 passing
- Live smoke: boot → register → note create (no CSRF) → image upload → `GET /files/*` 200 bytes-identical → traversal blocked (400) → avatar upload 200
- `npm audit --omit=dev`: 0 vulnerabilities
- Docker build NOT run: Docker is not installed on this machine — run `docker compose -f docker-compose-example.yml build api` before deploying

## Related: [backend/storage.md](backend/storage.md), [backend/middleware.md](backend/middleware.md), [backend/services/sync.md](backend/services/sync.md)
