# Calendar System

**Status:** ✅ Implemented | Internal + CalDAV integration

## Overview
View and manage events in calendar. Internal calendars + CalDAV sync (Google, iCloud, etc.).

## Key Details

### Calendar Model
```typescript
interface Calendar {
  id: string;
  userId: string;
  name: string;
  color: string;
  type: 'internal' | 'caldav' | 'tasks';
  url: string | null;
  username: string | null;
  password: string | null;  // Encrypted
  lastSync: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  version: number;
}
```

### Calendar Event Model
```typescript
interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  startTime: number;  // Unix timestamp in ms
  endTime: number;    // Unix timestamp in ms
  allDay: boolean;
  location: string | null;
  recurrence: string | null;  // rrule string
  alertMinutes: number | null; // minutes before start; null = none
  url: string | null;
  attendees: string[];        // JSON array
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  version: number;
}
```

### CRUD Operations

**Create Calendar**
```
POST /api/calendars
Body: { name, color, type, url?, username?, password? }
Response: { calendar }
```

**Create Event**
```
POST /api/calendars/:calendarId/events
Body: { title, startTime, endTime, allDay?, description?, location?, recurrence?, alertMinutes?, url?, attendees? }
Response: { event }
```

**Update Event**
```
PATCH /api/calendars/:calendarId/events/:eventId
Body: { title?, startTime?, endTime?, allDay?, description?, location?, recurrence?, alertMinutes?, url?, attendees? }
Response: { event }
```
- Nullable fields (`description`, `location`, `recurrence`, `alertMinutes`, `url`) are set when sent, `null` clears them; blank url is stored as null
- Invalid body → 400

**Delete Event**
```
DELETE /api/calendars/:calendarId/events/:eventId
Response: { success }
```

### Calendar Types
- `internal` - Native Notient events
- `caldav` - External CalDAV servers (Google, iCloud, Nextcloud)
- `tasks` - Tasks displayed as calendar events

### CalDAV Integration
**Sync Calendar**
```
POST /api/calendars/:id/sync
Response: { synced: count, updated, errors: [] }
```

**CalDAV Configuration**
- URL: CalDAV server endpoint
- Username: Account username
- Password: Encrypted password
- Auto-sync: Every 15 minutes

### Recurring Events
**RRule Format**
```
DTSTART:20250101T100000Z
RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR
```
- Supported: DAILY, WEEKLY, MONTHLY, YEARLY
- By day, month, date
- Count or until date

### Calendar Views
- Month view (grid)
- Week view (7 days)
- Day view (single day)
- Agenda view (list)

### Event Features
- All-day events
- Time range events
- Location support
- Description/notes
- Attendees (email list)
- Recurrence rules
- Multiple calendars overlay

### Task Calendar
- Tasks due on date shown as events
- Color-coded by priority
- Click to open task
- Syncs with task due dates

### Sync Integration
- Auto-sync on changes
- Conflict resolution via version
- Real-time updates from server
- CalDAV auto-sync every 15 minutes

### UI Components
**CalendarGrid:** Month/week/day views
**EventCard:** Individual event display
**CalendarSettings:** Manage calendars
**EventEditor:** `app.contract` one form, `creating` = New Event modal (POST), else edit (PATCH); see [calendar-ux.md](calendar-ux.md) Phase 3
**RecurrencePicker:** Set recurring rules

### Filter & Display
- Toggle calendars on/off
- Color-coded by calendar
- Search events
- Filter by date range

## Related
- [../components.md](../components.md) - UI components
- [../../backend/database.md](../../backend/database.md) - Calendars tables
- [../../backend/services/sync.md](../../backend/services/sync.md) - Sync protocol
- [../../backend/services/scheduler.md](../../backend/services/scheduler.md) - CalDAV sync