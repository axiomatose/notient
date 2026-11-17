# System Architecture

**Status:** Production Ready | Client-Server PWA

## Overview
Notient is a personal productivity suite with offline-first architecture. React/TypeScript frontend, Node.js/Express backend, SQLite database, S3 storage.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (PWA)                         │
│  React 18 + TypeScript + Tailwind CSS + Vite            │
│  - IndexedDB (offline storage)                            │
│  - Service Worker (background sync)                         │
│  - Web Push Notifications                                │
│  - Responsive Design (mobile/desktop)                       │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS/WebSocket
                     │
┌────────────────────▼────────────────────────────────────────┐
│              API Gateway (Express)                          │
│  - Auth Middleware (sessions, CSRF)                        │
│  - Rate Limiting                                          │
│  - CORS, Helmet.js                                        │
│  - Request Logging (Pino)                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Service Layer                                 │
│  ├─ Auth Service          (login, register, sessions)     │
│  ├─ Sync Service          (pull, push, conflicts)          │
│  ├─ Notification Service  (Web Push, reminders)           │
│  ├─ Storage Service       (local files, uploads)         │
│  └─ Scheduler            (cron jobs, CalDAV sync)         │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Data Layer                                   │
│  ├─ SQLite Database      (better-sqlite3)                 │
│  └─ File System         (notes, uploads, avatars)         │
└─────────────────────────────────────────────────────────────┘
```

## Core Systems

### Authentication Flow
```
1. User enters credentials
2. POST /auth/login
3. Server validates (bcrypt)
4. Creates session cookie
5. Returns user data
6. Client stores in AuthContext
7. All requests include cookie
8. Middleware validates session
9. Attach req.user to request
```

### Sync Protocol
```
Client                              Server
  │                                   │
  ├── GET /sync/pull?checkpoint=X  →   │
  │                                   ├── Query changes since X
  │                                   ├── Return: notes, tasks, etc.
  │   ← { records, checkpoint }         │
  │                                   │
  ├── Merge with local state            │
  │                                   │
  ├── POST /sync/push               →   │
  │   { changes, device_checkpoint }    │
  │                                   ├── Validate ownership
  │                                   ├── Check conflicts
  │                                   ├── Apply changes
  │                                   ├── Increment versions
  │   ← { success, checkpoint }         │
  │                                   │
```

### Notification Flow
```
1. Client subscribes to Web Push
2. POST /push/subscribe
3. Server stores subscription
4. Scheduler runs every minute
5. Finds due notifications
6. Sends Web Push via web-push library
7. Client receives push
8. Displays notification
9. User clicks → opens app
```

### CalDAV Sync Flow
```
1. User adds CalDAV calendar
2. POST /api/calendars (type: 'caldav')
3. Server stores credentials (encrypted)
4. Scheduler runs every 15 minutes
5. POST /api/calendars/:id/sync
6. Fetches events from CalDAV server
7. Creates/updates calendar_events records
8. Updates last_sync timestamp
```

## Data Models

### User
```
User → Devices (1:N)
User → Notes (1:N)
User → TaskLists (1:N)
User → Calendars (1:N)
User → PushSubscriptions (1:N)
User → Notifications (1:N)
```

### Notes
```
Note → User (N:1)
Note → Shares (1:N via note_shares)
Note → ShareableLinks (1:N)
```

### Tasks
```
TaskList → User (N:1)
TaskList → Tasks (1:N)
TaskList → Sections (1:N)
TaskList → Shares (1:N via task_list_shares)

Task → User (N:1)
Task → TaskList (N:1)
Task → Section (N:1, optional)
Task → Parent (N:1, self-referential)
Task → Children (1:N, self-referential)
Task → Attachments (1:N)
Task → Notifications (1:N)
Task → Shares (1:N via task_shares)
```

### Calendars
```
Calendar → User (N:1)
Calendar → Events (1:N)
```

### Sync
```
Device → User (N:1)
Device → Checkpoint (1:1)
```

## Key Design Decisions

### SQLite over PostgreSQL
- Simpler deployment (single file)
- No database server required
- Easier backups (copy file)
- Sufficient for personal use
- Migrate to PostgreSQL later if needed

### Session-based Auth (not JWT)
- Simpler implementation
- HTTP-only cookies (secure)
- No token refresh logic
- Server-side invalidation
- CSRF protection required

### Version-based Sync
- Simple integer version
- Last-write-wins conflicts
- Vector clocks (future)
- Offline-first support
- Conflict history (future)

### CalDAV Support
- Standard protocol
- Works with Google, iCloud, etc.
- Two-way sync
- Recurring events (RRule)
- Read/write access

### Web Push Notifications
- Native browser notifications
- No mobile app required
- Works on all platforms
- Background delivery
- Custom payload support

## Technology Stack

### Frontend
- React 18 - UI framework
- TypeScript - Type safety
- Vite - Build tool
- Tailwind CSS - Styling
- React Router - Routing
- Zustand - State management
- IndexedDB - Offline storage
- Service Worker - PWA features

### Backend
- Node.js - Runtime
- Express - Web framework
- better-sqlite3 - Database
- bcrypt - Password hashing
- web-push - Push notifications
- node-schedule - Cron jobs

### Infrastructure
- SQLite - Database
- HTTP - Protocol
- HTTPS - Secure transport

## Security Considerations

### Authentication
- bcrypt password hashing (10 rounds)
- HTTP-only session cookies
- Secure cookies in production
- SameSite: 'none' (cross-origin)

### API Security
- CSRF protection on mutations
- Rate limiting (1000 req/15min)
- Sync rate limit (10 req/min)
- Helmet.js headers
- Content Security Policy

### Data Protection
- Encrypted CalDAV passwords
- Input validation
- SQL injection prevention (parameterized queries)
- XSS prevention (React escaping)
- File upload validation

### Authorization
- User-scoped data access
- Share permissions (view/edit)
- Public link expiration
- Device-based access control

## Performance Optimizations

### Database
- Indexed queries (user_id, updated_at)
- Soft deletes (preserve history)
- Version tracking (conflict detection)
- Efficient sync queries

### Frontend
- Lazy loading routes
- Virtual scrolling (long lists)
- Debounced search
- Optimistic UI updates
- IndexedDB caching

### Network
- Gzip compression
- HTTP/2 support
- Background sync
- Push notifications
- Delta sync (only changes)

## Deployment

### Development
```
npm run dev  - Vite dev server
npm run server  - Express server
```

### Production
```
Docker container
- Frontend: Vite build (static files)
- Backend: Node.js Express
- Database: SQLite file
- Storage: local disk (DATA_DIR)
```

### Environment Variables
```
NODE_ENV=production
PORT=3000
DATA_DIR=/data
CORS_ORIGINS=...
LOG_LEVEL=info
```

## Scalability Considerations

### Current Limits
- Single SQLite database
- Single server instance
- Synchronous operations
- In-process scheduler

### Future Enhancements
- PostgreSQL for multi-user
- Redis for caching
- Bull queue for jobs
- Horizontal scaling
- Database read replicas
- Microservices architecture

## Monitoring

### Logging
- Pino structured logging
- Request/response logs
- Error tracking
- Performance metrics

### Health Checks
- GET /health endpoint
- Database connectivity
- Service availability
- Uptime tracking

## Related
- [README.md](README.md) - Project overview
- [backend/database.md](backend/database.md) - Database schema
- [backend/services/sync.md](backend/services/sync.md) - Sync protocol
- [backend/services/auth.md](backend/services/auth.md) - Authentication