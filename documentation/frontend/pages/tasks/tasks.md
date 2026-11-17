# Task Management System

**Status:** ✅ Implemented | Lists, sections, subtasks, attachments

## Overview

Organize tasks in lists with sections. Subtasks, priorities, due dates, reminders, attachments.

## Key Details

### Task List Model

```typescript
interface TaskList {
  id: string;
  userId: string;
  name: string;
  icon: string;
  color: string;
  folderId: string | null;
  sortOrder: number;
  sharedWith: string[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  version: number;
}
```

### Task Section Model

```typescript
interface TaskSection {
  id: string;
  userId: string;
  listId: string;
  name: string;
  icon: string | null;        // Lucide icon name (e.g. "star")
  color: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  version: number;
}
```

### Task Section CRUD

```
POST /api/task-sections
Body: { listId, name, icon?, color?, sortOrder? }   (icon/color trim, max 32; "" clears to null on PATCH)
Response: 201 { section }
PATCH /api/task-sections/:id
Body: { name?, listId?, icon?, color?, sortOrder?, deletedAt? }
Response: { section } (404 task_section_not_found)
```

### Task Model

```typescript
interface Task {
  id: string;
  userId: string;
  listId: string;
  parentId: string | null;
  sectionId: string | null;
  title: string;
  notes: string;
  isDone: boolean;
  dueAt: number | null;
  dueHasTime: boolean;        // false = all-day (due at 09:00 local)
  remindAt: number | null;
  flagged: boolean;
  recurrence: "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly"; // stored NULL for none
  url: string | null;
  priority: number | null;    // 0 none, 1 low, 2 medium, 3 high
  tags: string[];
  sortOrder: number;
  subtaskCount?: number;      // list responses only (GET /tasks?listId)
  locationName: string | null;
  locationLat: number | null;
  locationLng: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  version: number;
  sharedWith: string[];
}
```

### CRUD Operations

**Create Task List**

```
POST /api/task-lists
Body: { name, icon?, color?, folderId?, sortOrder? }
Response: { taskList }
```

**Create Task**

```
POST /api/tasks
Body: { listId, title, sectionId?, parentId?, notes?, dueAt?, dueHasTime?, remindAt?, flagged?, recurrence?, url?, priority?, tags?, sortOrder? }
Response: { task }
```

**Update Task**

```
PATCH /api/tasks/:id
Body: { title?, notes?, listId?, sectionId? (null = Uncategorized), parentId?, isDone?, dueAt?, dueHasTime?, remindAt?, flagged?, recurrence?, url? ("" or null clears), priority?, tags?, sortOrder?, deletedAt? }
Validation: recurrence in none|daily|weekdays|weekly|monthly|yearly (zod, else 400 invalid_body).
Recurrence advance: see Recurrence Rule below.
Response: { task }
```

**Delete Task**

```
DELETE /api/tasks/:id
Response: { success }
```

### Recurrence Rule (server, PATCH /tasks/:id)
- Trigger: `isDone` true on a task that was open, recurrence set (not none), dueAt set, and body has no `dueAt`.
- Effect: one update; `dueAt` moves to the next occurrence, `remindAt` shifts by the same delta, `isDone` stays false, version +1.
- Step (UTC calendar math, `server/src/lib/recurrence.js`): daily +1d; weekdays next Mon-Fri; weekly +7d; monthly +1 month (day clamped to month end); yearly +1 year.
- Skips past occurrences: repeats the step until dueAt > now.
- Sync push (`applySync`) does not advance; only the REST PATCH does.

### Lucide Icons (list/section icons)

- Lists and sections store `icon` (Lucide name) and `color` (free string, max 32).
- `GET /api/lucide/:name` (auth) → `{ name, paths: string[] }`; every SVG shape (path/circle/ellipse/rect/line/polyline/polygon) converted to path `d` (viewBox 0 0 24 24, stroke-based). Invalid or unknown name → 404 `{ error: "icon_not_found" }`.
- `GET /api/lucide-search?q=` (auth) → `{ names: string[] }`, up to 24 icon names (prefix matches first, then substring; cached dir listing from `lucide-static`).
- Code: `server/src/lib/lucide.js`, `server/src/routes/lucide.js`.

### Task Features

- Subtasks (parent-child relationships)
- Sections within lists
- Priorities (low, medium, high)
- Due dates (date-only or with time) with reminders, repeat, flag, URL
- Repeat (recurrence), see Recurrence Rule
- Tags for organization
- Location support
- Custom sort order
- Soft delete
- **Views:** List (vertical) and Board (Kanban/horizontal)
- **Mobile:**
  - Swipe-to-delete in List view (implemented with `framer-motion`, `touch-action: pan-y`, and `overflow-x-hidden` containers)
  - Tap-to-delete in Board view (tap completed task to reveal delete button)

### Task Attachments

**Create Attachment**

```
POST /api/task-attachments
Body: { taskId, type, name?, url?, filePath?, locationLat?, locationLng?, locationName? }
Response: { attachment }
```

**Attachment Types**

- `image` - Image files
- `file` - Documents, PDFs
- `location` - GPS coordinates

### Task Notifications

**Create Notification**

```
POST /api/task-notifications
Body: { taskId, type, scheduledAt, payload? }
Response: { notification }
```

**Notification Types**

- `reminder` - Custom reminder
- `due_date` - Due date alert
- `assigned` - Task assignment
- `completed` - Task completed
- `overdue` - Past due date

### Sharing

**Share Task List**

```
POST /api/task-list-shares
Body: { listId, sharedWithUserId, permission }
Response: { share }
```

**Share Individual Task**

```
POST /api/task-shares
Body: { taskId, sharedWithUserId, permission }
Response: { share }
```

**Shareable Link**

```
POST /api/shareable-links
Body: { resourceType: 'task_list', resourceId, expiresAt? }
Response: { link, slug }
```

### Task Folders

**Create Folder**

```
POST /api/tasklist-folders
Body: { name, color?, icon?, sortOrder? }
Response: { folder }
```

**Folder Model**

```typescript
interface TasklistFolder {
  id: string;
  userId: string;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  version: number;
}
```

### Client Storage

**IndexedDB:** `notient-tasks` store

- Stores all tasks locally
- Enables offline access
- Syncs with server on connection

### UI Components

**TaskList:** Display list of tasks
**TaskCard:** Individual task item
**TaskEditor:** Edit task details
**SectionHeader:** Task section
**AttachmentPreview:** File/image preview
**DatePicker:** Due date selection
**ReminderPicker:** Set reminders

### Sync Integration

- Auto-sync on changes
- Conflict resolution via version
- Real-time updates from server
- Offline support with queued changes

### Task Detail Screen (app.contract `TaskEditor`)
- Explicit Save (`task-save`); one PATCH with every field. Layout: grouped rows.
- Title `task-title`, notes `task-notes` (+ Markdown toolbar), URL `task-url` (type=url).
- Date switch `task-date-toggle` → date `task-due` (type=date, YYYY-MM-DD); Time switch `task-time-toggle` → time `task-time` (type=time, HH:MM; off = all-day, dueHasTime false).
- Repeat `task-repeat` (Never/Every Day/Every Weekday/Every Week/Every Month/Every Year); Reminder `task-reminder` (none, due, 1h before, 1d before, Custom=keep). Repeat and Reminder show only with a date.
- Flag switch `task-flag`; priority `task-priority` (0-3); tags `task-tags` (comma separated).
- List `task-list` and Section `task-section` (Uncategorized = ""). Save with another list moves the task and returns to the list (it leaves this screen).
- Subtasks: list + `subtask-draft`/`add-subtask`; checkboxes `subtask-<id>`. Images: `task-image` upload + thumbnails. Move Up/Down (`task-up`/`task-down`). Delete `task-delete` (bottom row).
- App mapping (app.ts): `taskRecord()` adds dueDay (YYYY-MM-DD) and dueTime (HH:MM) in device zone; `updateTask()` composes dueAt with Date.parse (device zone, as events do), remindAt from reminder choice (omitted when Custom).

### List Rows and Board Cards (`TaskLabel`)
- Under the title: priority bangs (`!`/`!!`/`!!!` orange, before title), flag `⚑` orange, first notes line (1 line clamp), meta line: due (red if overdue: past day, or today and timed and past), repeat icon, "n subtasks", #tag chips.
- Subtasks never appear as rows: `GET /tasks?listId` returns parent_id IS NULL only.
- List rows fixed 76px (virtualized; rowsHeight = n × 76).

## Related

- [../components.md](../components.md) - UI components
- [../../backend/database.md](../../backend/database.md) - Tasks tables
- [../../backend/services/sync.md](../../backend/services/sync.md) - Sync protocol
- [../../backend/services/notifications.md](../../backend/services/notifications.md) - Notifications
