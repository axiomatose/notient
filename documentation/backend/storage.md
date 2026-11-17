# Storage Service

**Status:** ✅ Implemented | Local filesystem storage

## Overview
Uploaded images (avatars, note images, task images, backgrounds) are stored on local disk under `DATA_DIR/uploads/` and served by the API at `/files/*`.

## Key Details

### Configuration
- `DATA_DIR` — root data directory (uploads live at `DATA_DIR/uploads/`)
- `PUBLIC_URL` — public origin of the API, used to build absolute file URLs (default `http://localhost:3001`)

### Storage Module
**Location:** `server/src/lib/storage.js`
- `createFileStorage({ dataDir, publicUrl })` factory (instantiated once in `buildApp`, passed to upload/profile/task-attachment routers)
- `uploadFile(key, buffer)` / `deleteFile(key)` / `getPublicUrl(key)`
- Keys are path-traversal checked (`resolve` must stay under uploads root)
- Wrappers: `uploadProfileImage`, `uploadNoteImage`, `uploadTaskImage`, `uploadBackgroundImage` (+ deletes)

### Serving
- `GET /files/*splat` in `server/src/server.js`
- No auth: keys are nanoid-unguessable (the unguessable key is the access control)
- `Cache-Control: public, max-age=31536000, immutable` (unique key per upload)
- Mounted before rate limiters so image loads don't consume API quota

### Key Formats
- Avatars: `profiles/{userId}/avatar.jpg` (URL in `users.avatar_url`)
- Note images: `notes/{noteId}/{nanoid}.{ext}` (URL inside note HTML/markdown)
- Task images: `tasks/{nanoid}.{ext}` (`task_attachments.url`, `file_path`)
- Backgrounds: `backgrounds/{nanoid}.{ext}` (URL client-side only)

### Note Bodies (Markdown)
- File: `${notesDir}/<userId>/<noteId>.md` (`server/src/db/notes.js`)
- `bodyMarkdown` = raw file text, written verbatim (`readMarkdown`/`writeMarkdown`)
- `body` = HTML via `marked` on read; legacy HTML write via `turndown` (`writeContent`)
- Returned as `bodyMarkdown` + `body` by notes list/get/sync, create/update, shared-with-me, `GET /public/notes/:slug` (`bodyMarkdown` alongside `content`)
- Create/update accept `bodyMarkdown`; when present it wins over `body`

### Upload Endpoints
- `POST /uploads/images` (multipart `image`, optional `noteId`) → `{ success, file: { url, name, size, type } }`
- `POST /uploads/backgrounds` (multipart `background`) → same + `uploadedAt`
- `POST /profile/avatar` (multipart `avatar`) → profile JSON
- Task image/file posts under `/task-attachments` → attachment JSON
- All auth-required; MIME sniffed via `file-type`; max 10MB (avatars 2MB)

## Related
- [database.md](database.md) - Users, task_attachments tables
- [exact-migration.md](../exact-migration.md) - Exact conversion notes
- [services/notifications.md](services/notifications.md) - Attachment notifications
