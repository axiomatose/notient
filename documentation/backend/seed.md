# Starter content and demo user

**Status:** ✅ Implemented | `server/src/lib/seedUser.js`

## Overview
Every new account gets a welcome note, a vault note, three task lists and a few calendar events. An optional demo account (`demo@demo.com` / `demo1234`) is created at startup.

## Key Details
- **Hook:** `POST /auth/register` calls `seedNewUser` after the user row exists. A failed seed is logged and never fails sign-up.
- **Config (env):** `SEED_NEW_USERS` (default on; `false` disables), `REGISTRATION_ENABLED` (default on), `SEED_DEMO_USER` (default off; `true` creates the demo user once, at startup in `index.js`).
- **Content:** note "Welcome to Notient" (pinned, folder Welcome, tag welcome; headings, emphasis, quote, divider, lists, checklist, code block, logo + Mac/iPhone/Android pictures), note "Vault" (tag `vault`), lists "Getting Started" (timed tasks, show in Tasks Due), "Groceries" (grocery mode, aisle sections), "Sample Board" (`viewMode: board`, sections To Do / In Progress / Done), events on "Notient Events" (coffee today, check-in tomorrow, all-day weekend).
- **Pictures:** `server/seed-assets/{logo,mac,ios,android}.png`, copied per user through `storage.uploadNoteImage`; a missing file leaves its line out. Links are absolute (`PUBLIC_URL` at seed time).
- **Exact quirk:** emphasis stays literal in a paragraph that also holds inline code or a link, so the welcome note keeps each in its own paragraph.
- **Demo user:** with `SEED_DEMO_USER=true`, `keepDemoUserAsSeeded` (`index.js`) resets the account at startup (delete + reseed), then every 5 min hashes its rows (`demoFingerprint`: notes, lists, sections, tasks, folders, calendars, events, profile, password) and resets it when the hash differs from the one taken after seeding. Resets sign demo sessions out. The old hardcoded demo seeding in `db/index.js` was removed.
- **Sign-in screen:** `GET /auth/options` (public) → `{ registration, demo: {email,password} | null }`; the app shows the demo login and the 5-minute wipe note under Register when `demo` is set, and hides Register when `registration` is false.
- **Registration:** `REGISTRATION_ENABLED=false` closes sign-up (`POST /auth/register` → 403 `registration_disabled`); sign-in is unaffected. Default on.
- **Tests:** `server/tests/seed.test.js`.

## Related: [database.md](database.md), [storage.md](storage.md)
