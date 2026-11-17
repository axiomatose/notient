# Notient - Personal Productivity Suite

**Status:** In Development | Cross-platform (Web, iOS, Android)

## Stack
- **Frontend:** React 18+, TypeScript, Vite, Tailwind CSS
- **Backend:** Node.js/Express
- **Database:** SQLite (file-based)
- **Storage:** Local file system (notes as Markdown, uploads)
- **Notifications:** Web Push API + Background sync
- **Deployment:** Docker (optional), Standalone Node.js

## Architecture
```
Server (Node.js/Express)
├── SQLite Database (users, notes, tasks, calendars, shares)
├── File System (notes, uploads)
├── Web Push Service
├── CalDAV Integration
└── Background Scheduler (notifications, sync)

Client (React/TypeScript)
├── PWA (Progressive Web App)
├── Offline-first with IndexedDB
├── Web Push Notifications
└── Mobile-responsive (iOS/Android)
```

## Core Features

**Notes System**
- Rich text notes with Markdown support
- Tags, folders, sorting, pinning
- Real-time sync across devices
- Shareable links and user-to-user sharing
- Import/Export (JSON, Markdown)
- Version tracking

**Task Management**
- Task lists with sections
- Subtasks, priorities, due dates, reminders
- Location-based tasks
- Attachments (images, files)
- Task folders and organization
- Sharing and collaboration
- Recurring tasks

**Calendar Integration**
- Internal calendar events
- CalDAV integration (Google Calendar, etc.)
- Task calendar views
- All-day events
- Recurring events (rrule)
- Multiple calendar support

**Sync & Collaboration**
- Conflict-free merge (vector clocks)
- Real-time push notifications
- Device management
- Offline-first with background sync
- Share with users via email/link
- Permission levels (view/edit)

**User Management**
- Email/password authentication
- Profile management (avatar, display name)
- Device tracking
- Notification preferences
- Quiet hours

## User Flow
1. Sign up/Login → 2. Create notes/tasks → 3. Share (optional) → 4. Receive notifications → 5. Sync across devices

## Documentation Map

**Start Here:**
- [TABLEOFCONTENTS.md](TABLEOFCONTENTS.md) - Navigation index (READ FIRST)
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture overview

**Backend:**
- [database.md](backend/database.md) - SQLite schema, migrations
- [services/auth.md](backend/services/auth.md) - Authentication, sessions
- [services/sync.md](backend/services/sync.md) - Sync protocol, conflict resolution
- [services/notifications.md](backend/services/notifications.md) - Push notifications
- [services/scheduler.md](backend/services/scheduler.md) - Background scheduler
- [middleware.md](backend/middleware.md) - Auth middleware, guards
- [storage.md](backend/storage.md) - file storage

**Frontend:**
- [components.md](frontend/components.md) - React components catalog
- [routing-auth.md](frontend/routing-auth.md) - Route protection

**Features:**
- [pages/notes/notes.md](frontend/pages/notes/notes.md) - Notes system
- [pages/tasks/tasks.md](frontend/pages/tasks/tasks.md) - Task management
- [pages/calendar/calendar.md](frontend/pages/calendar/calendar.md) - Calendar integration

**Styles:**
- [styles/mobile.md](styles/mobile.md) - Mobile components
- [styles/largescreens.md](styles/largescreens.md) - Desktop components

**Testing:**
- [testing.md](testing.md) - Unit tests, integration tests

## Development Standards
- Files ≤400 lines
- File headers link to documentation
- Type-safe TypeScript throughout
- Token-efficient documentation (see CLAUDE.md)