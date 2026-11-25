# Documentation Table of Contents

**Purpose:** Quick navigation for AI to locate relevant documentation without reading all files.

## Authentication & Users
- **Email/password authentication, sessions** → [backend/services/auth.md](backend/services/auth.md)
- **Device tracking, session management** → [backend/services/auth.md](backend/services/auth.md)
- **Change password, profile avatar icon/color, avatar photo** → [backend/services/auth.md](backend/services/auth.md)
- **Route protection, auth guards** → [frontend/routing-auth.md](frontend/routing-auth.md)
- **Auth middleware, CSRF, rate limiting** → [backend/middleware.md](backend/middleware.md)

## Database & Storage
- **SQLite schema, tables, migrations** → [backend/database.md](backend/database.md)
- **File storage, avatars, attachments** → [backend/storage.md](backend/storage.md)

## Starter Content
- **New-account seed (welcome note, lists, events), demo user, seed env flags** → [backend/seed.md](backend/seed.md)

## Sync & Data
- **Sync protocol, pull/push, conflicts** → [backend/services/sync.md](backend/services/sync.md)
- **Version tracking, checkpoints** → [backend/database.md](backend/database.md)

## Notifications
- **Web Push API, subscriptions** → [backend/services/notifications.md](backend/services/notifications.md)
- **Task notifications, reminders** → [backend/services/notifications.md](backend/services/notifications.md)
- **Background scheduler, cron jobs** → [backend/services/scheduler.md](backend/services/scheduler.md)
- **Notification preferences, quiet hours** → [backend/services/auth.md](backend/services/auth.md)

## Notes System
- **Note CRUD, organization** → [frontend/pages/notes/notes.md](frontend/pages/notes/notes.md)
- **Tags, folders, pinning** → [frontend/pages/notes/notes.md](frontend/pages/notes/notes.md)
- **Note sharing, shareable links** → [frontend/pages/notes/notes.md](frontend/pages/notes/notes.md)
- **Import/Export notes** → [frontend/pages/notes/notes.md](frontend/pages/notes/notes.md)
- **Rich text editor/reader, markdown view, task toggles, code copy, iOS keyboard shim, native iOS format bar (hatch)** → [frontend/pages/notes/rich-text.md](frontend/pages/notes/rich-text.md)
- **Notes table schema** → [backend/database.md](backend/database.md)

## Task Management
- **Task lists, sections, subtasks** → [frontend/pages/tasks/tasks.md](frontend/pages/tasks/tasks.md)
- **Tasks UX: header actions, quick add FAB, kanban board, drag & drop** → [frontend/pages/tasks/tasks-board.md](frontend/pages/tasks/tasks-board.md)
- **Task CRUD, priorities, due dates** → [frontend/pages/tasks/tasks.md](frontend/pages/tasks/tasks.md)
- **Repeating tasks, recurrence advance on check-off, task detail fields** → [frontend/pages/tasks/tasks.md](frontend/pages/tasks/tasks.md)
- **Task attachments (images, files, locations)** → [frontend/pages/tasks/tasks.md](frontend/pages/tasks/tasks.md)
- **Task folders** → [frontend/pages/tasks/tasks.md](frontend/pages/tasks/tasks.md)
- **Task sharing** → [frontend/pages/tasks/tasks.md](frontend/pages/tasks/tasks.md)
- **Tasks table schemas** → [backend/database.md](backend/database.md)

## Calendar System
- **Internal calendars, events** → [frontend/pages/calendar/calendar.md](frontend/pages/calendar/calendar.md)
- **Calendar UX: header, views, event editor, calendar management** → [frontend/pages/calendar/calendar-ux.md](frontend/pages/calendar/calendar-ux.md)
- **CalDAV integration (Google, iCloud)** → [frontend/pages/calendar/calendar.md](frontend/pages/calendar/calendar.md)
- **Recurring events (RRule)** → [frontend/pages/calendar/calendar.md](frontend/pages/calendar/calendar.md)
- **Task calendar view** → [frontend/pages/calendar/calendar.md](frontend/pages/calendar/calendar.md)
- **Calendar sync** → [backend/services/scheduler.md](backend/services/scheduler.md)
- **Calendars table schema** → [backend/database.md](backend/database.md)

## Frontend Components
- **UI components (GlassModal, GlassButton)** → [frontend/components.md](frontend/components.md)
- **NotificationDropdown, SettingsModal** → [frontend/components.md](frontend/components.md)
- **Calendar components** → [frontend/components.md](frontend/components.md)
- **Design system, styling** → [frontend/components.md](frontend/components.md)

## Frontend Architecture
- **Routing structure, protected routes** → [frontend/routing-auth.md](frontend/routing-auth.md)
- **Auth context, session management** → [frontend/routing-auth.md](frontend/routing-auth.md)
- **API client, error handling** → [frontend/routing-auth.md](frontend/routing-auth.md)
- **CSRF handling** → [frontend/routing-auth.md](frontend/routing-auth.md)

## Backend Architecture
- **Express server setup, middleware** → [backend/middleware.md](backend/middleware.md)
- **Route structure** → [README.md](README.md)
- **Error handling** → [backend/middleware.md](backend/middleware.md)

## Sharing & Collaboration
- **Notification bell, assignee notifications, live kinds (notes/calendar)** → [backend/collaboration.md](backend/collaboration.md)
- **Self-hosting, published image, one image for any domain, web bundle address** → [backend/self-hosting.md](backend/self-hosting.md)
- **Installing the web app (PWA manifest, Android Chrome)** → [backend/pwa-install.md](backend/pwa-install.md)
- **Shared list access (view/edit), Claude's account** → [backend/collaboration.md](backend/collaboration.md)
- **Note sharing, task sharing** → [frontend/pages/notes/notes.md](frontend/pages/notes/notes.md), [frontend/pages/tasks/tasks.md](frontend/pages/tasks/tasks.md)
- **Shareable links (public access)** → [frontend/pages/notes/notes.md](frontend/pages/notes/notes.md)
- **Permissions (view/edit)** → [backend/database.md](backend/database.md)

## Responsive Design
- **Settings, avatar (icon, color, photo), Auto/Light/Dark, change password** → [frontend/pages/settings.md](frontend/pages/settings.md)
- **Mobile components, layouts** → [styles/mobile.md](styles/mobile.md)
- **Large screen layouts** → [styles/largescreens.md](styles/largescreens.md)
- **Desktop sidebar (≥900px), window width, Notes and Tasks trees (fold, fixed height + Show more)** → [frontend/pages/desktop-sidebar.md](frontend/pages/desktop-sidebar.md)
- **Templates (start a note/list from a built-in or saved template, save as template, templates table)** → [frontend/pages/templates.md](frontend/pages/templates.md), [backend/database.md](backend/database.md)
- **Import / drop zones (drop images on a note or task, Markdown files and folders become notes)** → [frontend/pages/import.md](frontend/pages/import.md)

## Deployment
- **Project overview, stack** → [README.md](README.md)
- **Testing framework** → [testing.md](testing.md)

## Migration
- **Exact conversion: API audit, phases, local file storage** → [exact-migration.md](exact-migration.md)

## Standards & Workflow
- **Token-efficient documentation format** → [../CLAUDE.md](../CLAUDE.md)
- **File size limits, headers** → [../CLAUDE.md](../CLAUDE.md)
- Calendar subscriptions (ICS links, CalDAV) → backend/services/calendar-sync.md
- Universal search (title bar / phone sheet, `GET /search`) → frontend/pages/search.md
