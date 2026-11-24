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

**Export Notes** (all need auth; own notes only, trashed excluded)

```
GET /notes/:id/export           → one .md ("# Title" + body)
GET /notes/export?folder=A/B    → zip of that folder and its subfolders, laid out as folders
GET /notes/export               → zip of the whole library
```
Entry names are the note titles (`Title (2).md` on repeats). App: `exportNotes` source downloads to `app:/tmp/export/` (`exactBodyTo`) then `saveFile`; UI: `note-export` (editor), `export-notes` (toolbar: folder with a folder filter, else library; also File ▸ Export on the Mac), persona menu "Export all notes".

**Import Notes**

```
POST /notes/import
Body: FormData with .zip or .md file
Response: { success: boolean, count: number }
```
A zip keeps its directories as note folders; a single `.md` is folderless. First `# Heading` becomes the title; text is stored as written.

**On disk:** `notes/<userId>/<folder>/<subfolder>/<noteId>.md`, one whole Markdown file per note (file name stays the note id; folder names sanitised, `..` dropped). Folder changes move the file; startup runs `notes.migrateLayout()` for the old flat layout (`notes/<userId>/<noteId>.md`), reads fall back to it.

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

## Nested folders (app)
- A folder is a path `A/B/C`. `lib.folders` (`withAncestors` in `app.ts`) carries every level, parents before children, so `A` exists when only `A/B` has notes.
- The notes home draws one section per folder with a header button (`folder-toggle-<path>`): indent `folderDepth(f) * 16`, the leaf name (`lastSegment`), a chevron. A header shows when a note sits in it or below it (`underFolder`); tapping folds it and everything under it (`shutFolders`, paths joined by `|`; `folderShut`, `insideShut`). Unfiled has no fold.
- The folder filter on a path includes its subfolders. Side-bar tree and the move-to-folder menu still list full paths.
- **New folder:** `new-note-folder` (toolbar, beside Sort) and `side-new-note-folder` (sidebar) open the `new-folder` dialog: name (`new-folder-name`) and an optional parent (`new-folder-parent`, defaults to the active folder filter). `makeNoteFolder` → `POST /note-folders {name, parent}`; `loadNotes` also reads `GET /note-folders` and merges it into `folders` (an older server without the route is ignored).

