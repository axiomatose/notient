# Notification Service

**Status:** ✅ Implemented | Web Push + Scheduled task notifications

## Overview
Web Push API for real-time notifications. Scheduled task reminders, due date alerts, share notifications.

## Key Details

### Web Push Endpoints

**Subscribe**
```
POST /push/subscribe
Body: { endpoint, p256dh, auth }
Response: { success, subscriptionId }
Auth: Required
```

**Unsubscribe**
```
DELETE /push/unsubscribe
Response: { success }
Auth: Required
```

**Get Subscriptions**
```
GET /push/subscriptions
Response: { subscriptions: [...] }
Auth: Required
```

### Task Notification Endpoints

**Create Task Notification**
```
POST /task-notifications
Body: { taskId, type, scheduledAt, payload? }
Response: { notification }
Auth: Required
```

**Get Notifications**
```
GET /task-notifications?unreadOnly=true
Response: { notifications: [...] }
Auth: Required
```

**Mark as Read**
```
PATCH /task-notifications/:id/read
Response: { success }
Auth: Required
```

**Delete Notification**
```
DELETE /task-notifications/:id
Response: { success }
Auth: Required
```

### Notification Types
- `reminder` - Custom reminder time
- `due_date` - Task due date approaching
- `assigned` - Task assigned to user
- `completed` - Task completed
- `overdue` - Task past due date

### Scheduler
- Runs every minute
- Checks `task_notifications` table
- Sends push notifications when `scheduled_at <= now`
- Updates `sent_at` timestamp
- Skips already sent notifications
- Location: `server/src/scheduler.js`

### Push Payload Format
```typescript
{
  type: 'task_reminder' | 'task_due' | 'task_assigned' | 'task_completed' | 'task_overdue';
  taskId: string;
  title: string;
  body: string;
  icon?: string;
  data?: {
    taskId: string;
    listId?: string;
    // Additional data for click handling
  };
}
```

### Notification Service
- Uses `web-push` library
- VAPID keys from config
- Sends to all user's subscriptions
- Handles subscription errors (removes invalid)
- Location: `server/src/services/notificationService.js`

### User Preferences
Stored in `users.notification_preferences`:
```typescript
{
  taskReminders: boolean;
  taskDueDates: boolean;
  taskAssigned: boolean;
  quietHoursStart: string | null;  // "HH:MM"
  quietHoursEnd: string | null;
}
```

### Quiet Hours
- No notifications sent during quiet hours
- Scheduled notifications sent after quiet hours end
- Per-user configuration

### Rate Limiting
- Standard API limiter applies
- No push-specific limits

### Web Push Flow
1. Client generates push subscription (VAPID)
2. Client sends subscription to `/push/subscribe`
3. Server stores in `push_subscriptions` table
4. Scheduler checks for due notifications
5. Server sends push to all user's subscriptions
6. Client receives and displays notification

## Related
- [database.md](../database.md) - task_notifications, push_subscriptions tables
- [services/auth.md](auth.md) - User preferences
- [scheduler.md](scheduler.md) - Background scheduler