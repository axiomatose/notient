# Universal Search

**Status:** ✅ Implemented | one search over notes, tasks and events

## Overview
The notes-only inline search is gone. Wide windows (Mac/web) have a field centred in the title bar (`search-all`); phones get a Search button in the Notes, Tasks and Calendar headers (`search-open`, `search-open-tasks`, `search-open-calendar`) that opens the `search-sheet` dialog.

## Key Details
- State `searchQ`; resource `found = searchAll(searchQ)` (source in `app/app.ts`) → shape `Found {q, notes[], tasks[], events[]}`, each hit `{id, title, sub, …}` (`sub`: snippet or folder, list name, date and place).
- Results render in `SearchResults` (grouped Notes / Tasks / Events, `found-note-<id>`, `found-task-<id>`, `found-event-<id>`, `search-empty`). Tapping opens it (`openFoundNote` → `openSideNote`, `openFoundTask` → `openRecentTask`, `openFoundEvent` → `eventDetail`) and clears the search.
- Title-bar dropdown `search-pop` shows while `searchQ` is not empty; it sits under the page's own header buttons (z-index 9).
- The notes tag and folder filters remain; the sidebar's notes search field was removed.

## API
`GET /search?q=&limit=` (limit 1–25, default 8) → `{notes: [{id, title, folder, snippet, vault}], tasks: [{id, title, listId, parentId, isDone, listName}], events: [{id, title, startTime, allDay, location}]}`. Own items only (shared lists/notes not searched). Notes match title, tags and body (a vault note: title and tags only, snippet empty); tasks match title, tags and thread notes; events match title, location, description. `%` and `_` are literal. Code: `server/src/db/search.js`, `server/src/routes/search.js`; tests `server/tests/search.test.js`.

## Related: notes/notes.md, tasks/tasks-board.md
