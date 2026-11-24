# Database Schema

**Status:** ✅ Implemented | SQLite with migrations

## Overview
SQLite database with incremental migrations. Tables: users, notes, tasks, calendars, shares, notifications, attachments.

## Key Details

### Database Location
- File: `server/data/notient.db`
- Connection: `better-sqlite3`
- Migrations: `server/src/db/schema.js`

### Core Tables

**users**
```sql
id TEXT PRIMARY KEY
email TEXT UNIQUE
password_hash TEXT
display_name TEXT
avatar_url TEXT
avatar_blob BLOB
avatar_mime TEXT
avatar_updated_at INTEGER
avatar_icon TEXT (nullable; Lucide name, max 48)
avatar_color TEXT (nullable; max 32)
notification_preferences TEXT (JSON)
created_at INTEGER
```

**devices**
```sql
id TEXT PRIMARY KEY
user_id TEXT
name TEXT
last_seen INTEGER
FK: user_id → users(id) CASCADE
```

**notes**
```sql
id TEXT PRIMARY KEY
user_id TEXT
title TEXT
body TEXT
is_pinned INTEGER
tags TEXT (JSON array)
folder TEXT
sort_order REAL
created_at INTEGER
updated_at INTEGER
deleted_at INTEGER
version INTEGER
updated_by TEXT
shared_with TEXT (JSON array)
FK: user_id → users(id) CASCADE
```

**task_lists**
```sql
id TEXT PRIMARY KEY
user_id TEXT
name TEXT
icon TEXT
color TEXT
folder_id TEXT
sort_order INTEGER
created_at INTEGER
updated_at INTEGER
deleted_at INTEGER
version INTEGER
shared_with TEXT (JSON array)
FK: user_id → users(id) CASCADE, folder_id → tasklist_folders(id)
```

**task_sections**
```sql
id TEXT PRIMARY KEY
user_id TEXT
list_id TEXT
name TEXT
icon TEXT (nullable; Lucide name)
color TEXT (nullable)
sort_order REAL
created_at INTEGER
updated_at INTEGER
deleted_at INTEGER
version INTEGER
FK: user_id → users(id) CASCADE, list_id → task_lists(id) CASCADE
```

**tasks**
```sql
id TEXT PRIMARY KEY
user_id TEXT
list_id TEXT
parent_id TEXT
section_id TEXT
title TEXT
notes TEXT
is_done INTEGER
due_at INTEGER
due_has_time INTEGER (default 1; 0 = all-day)
remind_at INTEGER
flagged INTEGER (default 0)
recurrence TEXT (NULL = none; daily, weekdays, weekly, monthly, yearly)
url TEXT
priority INTEGER
tags TEXT (JSON array)
sort_order REAL
location_name TEXT
location_lat REAL
location_lng REAL
created_at INTEGER
updated_at INTEGER
deleted_at INTEGER
version INTEGER
shared_with TEXT (JSON array)
FK: user_id → users(id) CASCADE, list_id → task_lists(id) CASCADE, parent_id → tasks(id) CASCADE
```

**calendars**
```sql
id TEXT PRIMARY KEY
user_id TEXT
name TEXT
color TEXT
type TEXT (internal, caldav, tasks)
url TEXT
username TEXT
password TEXT (encrypted)
last_sync INTEGER
is_active INTEGER
sort_order INTEGER
created_at INTEGER
updated_at INTEGER
deleted_at INTEGER
version INTEGER
FK: user_id → users(id) CASCADE
```

**calendar_events**
```sql
id TEXT PRIMARY KEY
calendar_id TEXT
title TEXT
description TEXT
start_time INTEGER (ms)
end_time INTEGER (ms)
all_day INTEGER
location TEXT
recurrence TEXT (rrule)
alert_minutes INTEGER (minutes before start; NULL = none)
url TEXT
attendees TEXT (JSON array)
created_at INTEGER
updated_at INTEGER
deleted_at INTEGER
version INTEGER
FK: calendar_id → calendars(id) CASCADE
```

### Sharing Tables

**note_shares**
```sql
id TEXT PRIMARY KEY
note_id TEXT
shared_by_user_id TEXT
shared_with_user_id TEXT
permission TEXT (view, edit)
is_read INTEGER
created_at INTEGER
FK: note_id → notes(id) CASCADE
```

**task_shares**
```sql
id TEXT PRIMARY KEY
task_id TEXT
shared_by_user_id TEXT
shared_with_user_id TEXT
permission TEXT (view, edit)
is_read INTEGER
created_at INTEGER
FK: task_id → tasks(id) CASCADE
```

**task_list_shares**
```sql
id TEXT PRIMARY KEY
list_id TEXT
shared_by_user_id TEXT
shared_with_user_id TEXT
permission TEXT (view, edit)
is_read INTEGER
created_at INTEGER
FK: list_id → task_lists(id) CASCADE
```

**shareable_links**
```sql
id TEXT PRIMARY KEY
resource_type TEXT (note, task_list)
resource_id TEXT
slug TEXT UNIQUE
expires_at INTEGER
created_at INTEGER
FK: created_by_user_id → users(id) CASCADE
```

### Notifications & Attachments

**task_notifications**
```sql
id TEXT PRIMARY KEY
task_id TEXT
user_id TEXT
type TEXT (reminder, due_date, assigned, completed, overdue)
scheduled_at INTEGER
sent_at INTEGER
is_read INTEGER
payload TEXT
created_at INTEGER
deleted_at INTEGER
FK: user_id → users(id) CASCADE, task_id → tasks(id) CASCADE
```

**task_attachments**
```sql
id TEXT PRIMARY KEY
task_id TEXT
type TEXT (image, file, location)
name TEXT
url TEXT
file_path TEXT
file_size INTEGER
mime_type TEXT
location_lat REAL
location_lng REAL
location_name TEXT
created_at INTEGER
created_by TEXT
FK: task_id → tasks(id) CASCADE, created_by → users(id) CASCADE
```

**task_notes** (migration 36; a task's notes are a thread)
```sql
id TEXT PRIMARY KEY
task_id TEXT
user_id TEXT (author)
body TEXT
created_at INTEGER
FK: task_id → tasks(id) CASCADE
```
Migration 36 turns each task's old `tasks.notes` into its first note (`legacy-<taskId>`, by the task's owner). `POST /tasks` with `notes` creates the first note; `PATCH /tasks/:id` `notes` is no longer used by the app.

List rows (`tasksRepo.list`, so `GET /tasks`, `/tasks/board`) carry `latestNote {body, userId, createdAt}` (newest thread note, omitted when none): the board/list card subtext. List members (`createListAccess.members`) carry `avatarUrl`/`avatarUpdatedAt` for the card's avatar.

**templates** (migration 37; a person's saved note and list templates)
```sql
id TEXT PRIMARY KEY
user_id TEXT (owner, CASCADE)
kind TEXT ('note' | 'list')
name TEXT
payload TEXT (JSON: note {title, body}; list {icon, color, sections[{name,icon,color}], tasks[{title, section (index, -1 none), priority, flagged, tags, subtasks[]}]})
created_at INTEGER
```
Routes (`routes/templates.js`, owner only): `GET /templates` → `{templates}`, `POST /templates {kind,name,payload}` → 201, `DELETE /templates/:id`. Built-ins live in the app (`BUILTIN_NOTES`, `BUILTIN_LISTS` in `app/app.ts`).

**push_subscriptions**
```sql
id TEXT PRIMARY KEY
user_id TEXT
endpoint TEXT UNIQUE
p256dh TEXT
auth TEXT
created_at INTEGER
updated_at INTEGER
FK: user_id → users(id) CASCADE
```

### Sync

**checkpoints**
```sql
device_id TEXT PRIMARY KEY
last_pull INTEGER
FK: device_id → devices(id) CASCADE
```

### Folders

**tasklist_folders**
```sql
id TEXT PRIMARY KEY
user_id TEXT
name TEXT
color TEXT
icon TEXT
sort_order INTEGER
created_at INTEGER
updated_at INTEGER
deleted_at INTEGER
version INTEGER
FK: user_id → users(id) CASCADE
```

## Key Indexes
- `idx_notes_user_updated`: notes(user_id, updated_at)
- `idx_notes_user_sort`: notes(user_id, sort_order)
- `idx_tasks_user_updated`: tasks(user_id, updated_at)
- `idx_tasks_list_sort`: tasks(list_id, sort_order)
- `idx_calendar_events_time_range`: calendar_events(start_time, end_time)
- `idx_task_notifications_user_scheduled`: task_notifications(user_id, scheduled_at)

## Migration IDs
1. create_base_tables
2. add_updated_by_columns
3. add_user_profile_fields
4. add_note_folder_column
6. add_task_notification_system
7. add_notes_sort_order
8. add_s3_avatar_url
9. add_sharing_tables
10. add_tasklist_folders
11. add_calendar_system
12. add_push_and_read_status
13. fix_missing_notification_tables
14-16. fix columns
17. add_overdue_notification_type
18. add_task_due_has_time
19. add_task_flagged
20. add_task_recurrence
21. add_task_url
22. add_task_section_icon (`ALTER TABLE task_sections ADD COLUMN icon TEXT`)
23. add_task_section_color (`ALTER TABLE task_sections ADD COLUMN color TEXT`)
24. add_event_alert_minutes (`ALTER TABLE calendar_events ADD COLUMN alert_minutes INTEGER`)
25. add_event_url (`ALTER TABLE calendar_events ADD COLUMN url TEXT`)
26. add_user_avatar_icon (`ALTER TABLE users ADD COLUMN avatar_icon TEXT`)
27. add_user_avatar_color (`ALTER TABLE users ADD COLUMN avatar_color TEXT`)

## Related
- [services/sync.md](services/sync.md) - Sync protocol
- [services/auth.md](services/auth.md) - User authentication

## note_folders (migration 38)
`(user_id, path)` PK, `created_at`. Folders made on purpose so they exist before any note is filed in them; a note's folder stays a path on the note. `GET /note-folders` → `{folders}`; `POST /note-folders {name, parent?}` → `{path}` (name has no `/`, `.` or `..`). Repo `repos.noteFolders` (`src/db/noteFolders.js`), route `src/routes/noteFolders.js`.

