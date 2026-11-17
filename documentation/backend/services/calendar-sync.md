# Calendar Subscriptions (ICS links, CalDAV accounts)

**Status:** ✅ Implemented | Read-only; two-way CalDAV write is not built

## Overview
A subscribed calendar is a `calendars` row with `sync_kind` (`ics` | `caldav`, `type` stays `caldav`) whose events are fetched from the server it names and stored as ordinary `calendar_events` rows. Recurring events are expanded into occurrences in a window (-90d..+400d, max 1500 each), so the app needs no recurrence engine for them. Subscribed calendars are read-only.

## Key Details
- Code: `server/src/lib/calendarSync.js` (fetch, discovery, expansion, `syncCalendarById`), routes in `server/src/routes/calendars.js`, repo `server/src/db/calendars.js` (`replaceSynced`, `listSyncable`), scheduler `server/src/scheduler.js` (first run +1 min, then every 30 min)
- Migrations 28-30: `calendars.sync_kind`, `calendars.sync_error`, `calendar_events.external_id`
- Sync replaces all events of the calendar in one transaction; a failure keeps the old events and stores `sync_error`
- `normalizeUrl`: `webcal(s)://` -> `http(s)://`; only http(s); refuses loopback, `0.0.0.0`, `169.254.*` (set `NOTIENT_ALLOW_LOCAL_FEEDS=1` in tests). LAN addresses are allowed (self-hosted CalDAV)
- Limits: 15 MB body, 30 s timeout
- ICS: iCloud public calendar link, Google "Secret address in iCal format", Outlook publish link, any `.ics` (Basic auth if username given)
- CalDAV: `discoverCaldav` (depth-1 listing; else `current-user-principal` -> `calendar-home-set` -> list collections with `calendar` resourcetype, displayname, `calendar-color`); `fetchCaldav` REPORT `calendar-query` time-range on one collection. Google CalDAV needs OAuth (not supported; use its secret iCal link). iCloud needs an app-specific password
- Passwords are stored encrypted (existing `calendars.password` flow)

## API
| Route | Body | Result |
|---|---|---|
| POST /calendars/subscribe | `{url, name?, color?, username?, password?}` | 201 `{calendar, count}`; 400 `{error:'sync_failed', message}` (calendar not kept) |
| POST /calendars/caldav/discover | `{url, username, password}` | `{calendars:[{url,name,color}]}` |
| POST /calendars/caldav/connect | `{url, username, password, calendars:[{url,name,color?}]}` | 201 `{added, calendars}` |
| POST /calendars/:id/sync | - | `{calendar, count}` |
- Calendar JSON adds `syncKind`, `syncError`, `readOnly`. Event create/update/delete on a read-only calendar -> 400 `read_only`

## App
- `app/app.ts`: `subscribeCalendar`, `discoverCaldav`, `connectCaldav` (re-discovers, filters by picked urls), `syncCalendar`; `CalendarItem.syncKind/syncError`
- `app/app.contract`: route `addCalendar` (`AddCalendar`: Web link / Account tabs; presets iCloud, Fastmail, Yahoo), entry `add-subscription` in `ManageCalendars`; rows show "Web calendar / CalDAV · read-only" or the error; `cal-sync`; EventEditor hides save/delete for events of subscribed calendars and excludes them from the calendar picker
- Tests: `server/tests/calendarSync.test.js` (local fake ICS + CalDAV server), app tests "a subscription that is not an address says so"

## Related: [../database.md](../database.md), [../../frontend/pages/calendar/calendar-ux.md](../../frontend/pages/calendar/calendar-ux.md)
