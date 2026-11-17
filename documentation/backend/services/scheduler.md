# Background Scheduler

**Status:** ✅ Implemented | Cron-based job runner

## Overview
Node-schedule based cron scheduler for recurring tasks. Handles notifications, reminders, CalDAV sync.

## Key Details

### Scheduler Configuration
**Location:** `server/src/scheduler.js`
- Interval: Every minute (`*/1 * * * *`)
- Persistent across server restarts
- Auto-starts on server init

### Scheduled Jobs

**Send Task Notifications**
- Runs: Every minute
- Checks: `task_notifications` table
- Condition: `scheduled_at <= now` AND `sent_at IS NULL`
- Action: Send Web Push notification
- Update: Set `sent_at = now`
- Skips: Already sent notifications

**Check Overdue Tasks**
- Runs: Every minute
- Checks: `tasks` table
- Condition: `due_at < now` AND `is_done = 0`
- Action: Create overdue notification
- Duplicates: Checks existing notifications first

**Sync CalDAV Calendars**
- Runs: Every 15 minutes
- Checks: `calendars` table
- Condition: `type = 'caldav'` AND `is_active = 1`
- Action: Fetch events from CalDAV server
- Update: Create/update `calendar_events` records

### Job Initialization
```typescript
function startScheduler({ repos, notificationService }) {
  // Register all jobs
  // Start interval
  // Return job handle
}
```

### Notification Preferences Check
Before sending notifications:
1. Fetch user's `notification_preferences`
2. Check `quietHoursStart` and `quietHoursEnd`
3. Skip if current time is in quiet hours
4. Respect per-type preferences (taskReminders, etc.)

### Notification Types Handled
- `reminder` - Custom time-based reminders
- `due_date` - Due date approaching
- `overdue` - Past due date
- `assigned` - Task assignment

### Error Handling
- Logs errors to Pino logger
- Continues running on job failure
- Does not stop scheduler on errors
- Individual job failures isolated

### Time Zone
- Uses server's local time
- Unix timestamps in milliseconds
- Stored in database as `INTEGER`

### Job Queue
- Not using Bull queue (future enhancement)
- Simple interval-based execution
- Synchronous operations
- Blocking jobs delay scheduler

### Performance
- Efficient queries with indexes
- Batches notifications per user
- Limits notifications per cycle
- Prevents notification spam

### Database Queries
```sql
-- Due notifications
SELECT * FROM task_notifications 
WHERE scheduled_at <= ? AND sent_at IS NULL
ORDER BY scheduled_at ASC
LIMIT 100;

-- Overdue tasks
SELECT * FROM tasks 
WHERE due_at < ? AND is_done = 0
LIMIT 50;

-- CalDAV calendars
SELECT * FROM calendars 
WHERE type = 'caldav' AND is_active = 1;
```

## Related
- [database.md](../database.md) - task_notifications, calendars tables
- [services/notifications.md](notifications.md) - Push notifications
- [services/sync.md](sync.md) - Calendar sync