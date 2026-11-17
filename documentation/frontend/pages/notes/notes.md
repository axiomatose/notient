# Notes System

**Status:** ✅ Implemented | Rich notes with sync

## Overview

Create, edit, organize notes with Markdown support. Real-time sync across devices.

## Key Details

### Note Model

```typescript
interface Note {
  id: string;
  userId: string;
  title: string;
  body: string;          // HTML (legacy web client)
  bodyMarkdown: string;  // raw Markdown file (app source of truth)
  isPinned: boolean;
  tags: string[];
  folder: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  version: number;
  sharedWith: string[];
}
```

### CRUD Operations

**Create Note**

```
POST /api/notes
Body: { title, body?, bodyMarkdown?, tags?, folder?, sortOrder? }  // bodyMarkdown wins over body
Response: { note }
```

**Update Note**

```
PATCH /api/notes/:id
Body: { title?, body?, bodyMarkdown?, isPinned?, tags?, folder?, sortOrder? }  // bodyMarkdown wins over body
Response: { note }
```

**Delete Note**

```
DELETE /api/notes/:id
Response: { success }
```

**Get Notes**

```
GET /api/notes?folder=x&sort=updated
Response: { notes: [] }
```

### Note Features

- Rich text with Markdown
- Tags for organization
- Folder support
- Pin important notes
- Custom sort order
- Soft delete (deletedAt)
- Version tracking
- **Lists:** Bulleted, ordered, and task lists with nesting support (Indent/Outdent)
- **Slash Menu:** Type `/` to access formatting commands
- **Toolbar Toggle:** Show/hide toolbar in Settings

### Sync Integration

- Auto-sync on changes
- Conflict resolution via version
- Real-time updates from server
- Offline support with queued changes

### Sharing

**User Sharing**

```
POST /api/note-shares
Body: { noteId, sharedWithUserId, permission }
Response: { share }
```

**Shareable Link**

```
POST /api/shareable-links
Body: { resourceType: 'note', resourceId, expiresAt? }
Response: { link, slug }
```

### Import/Export

**Export Notes**

```
GET /api/notes/export
Response: JSON file with all notes
```

**Import Notes**

```
POST /api/notes/import
Body: FormData with .zip or .md file
Response: { success: boolean, count: number }
```

### Client Storage

**IndexedDB:** `notient-notes` store

- Stores all notes locally
- Enables offline access
- Syncs with server on connection

### UI Components

**NoteList:** Display notes with search/filter
**NoteEditor:** Rich text editor with preview
**NoteCard:** Individual note preview
**TagPicker:** Add/remove tags
**FolderSelector:** Select/organize folders

### Search & Filter

- Full-text search (title + body)
- Filter by folder
- Filter by tags
- Sort by date, title, pinned

## Related

- [../components.md](../components.md) - UI components
- [../../backend/database.md](../../backend/database.md) - Notes table
- [../../backend/services/sync.md](../../backend/services/sync.md) - Sync protocol
