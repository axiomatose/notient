# Desktop Sidebar (exact app)

**Status:** ✅ Implemented | Custom sidebar at window width ≥ 900px with Notes and Tasks trees; replaces exact's automatic tablist sidebar

## Overview
Root `main` reports its width (`resize=onWinResize`) into state `winW`; `derive wide = winW >= 900`. Wide: row layout `[DesktopSidebar 21rem][content column flex=1]`, native `tabs` tablist `display="none"`. Narrow (<900): unchanged column, tablist as bottom tab bar (screenshot at 390x844 byte-identical to pre-change).

## Title bar (wide, signed in)
- `app.json` `display_override: ["window-controls-overlay"]`, `main viewport-fit="cover"`; every route root says `navigationBar=(wide ? "none" : "auto")`, so the platform's back/forward bar is gone on wide windows and phones keep theirs.
- Own row `titlebar` (38 px, absolute, z-index 10), left inset `env(titlebar-area-x)` + 8 clears the traffic lights; content column `margin-top=38`.
- Contents: `sidebar-toggle` (state `sideOpen`), "Notient", crumbs. Tasks: `Tasks / Folder / List` (on a list); Notes: `Notes / Folder / Note / View|Edit` (on a note; `crumb-mode` runs `crumbMode` = startEdit / saveAndClose); Calendar: none. `crumbHome` opens the tab home (no folder view yet).
- The board's own list title row shows on phones only (`if not wide`).

## Key Details
- **State:** `winW = 0` (until first resize); `derive wide`.
- **Resources:**
  - `recentTasks` ← `loadRecentTasks()`: GET `/tasks` (no listId: server returns all user's top-level tasks, all lists). App filters `!isDone`, sorts `updatedAt` desc, keeps the 5 newest per list. Shape `RecentTasks{owner, tasks: RecentTask[{id,title,listId}]}`.
  - `recentEvents` ← `loadRecentEvents(today, hiddenCals)`: GET `/calendars/user/events?startTime&endTime` (today−90d … today+366d). Upcoming (startTime ≥ local midnight) soonest first, then past desc; hidden calendars excluded; 10. Shape `RecentEvents{owner, events: EventRow[]}`.
- **Derives:** `sideNotes` (= `notesShown`: the active notes under the sort and search, owner-gated), `recentTaskRows`, `recentEventRows`, `detailEvents` (event editor lookup: period cells + sidebar events).
- **Component:** `DesktopSidebar` props: data `notes, noteFolders, query, tasks, events, lists, folders`; tree state `notesOpen, notesTall, tasksOpen, tasksTall, foldedRows`; the folder popover's `folderDraft, folderError`; actions `pick, openNote, openTask, openList, search, newNote, trash, newList, editFolder, addFolder, toggleNotes, toggleNotesTall, toggleTasks, toggleTasksTall, toggleFold`.
- **Trees (Notes, Tasks):** header row = fold chevron, tab button (icon + title, selects the tab), icon buttons (Notes: New Note, Trash; Tasks: New list, New folder). The tree opens at `max-height 16rem` (scrolls inside); "Show more" (`side-*-more`, shown when more than 9 rows) drops the cap so the sidebar's own scroll takes it. Chevron folds the whole tree. State `sideNotesOpen/Tall`, `sideTasksOpen/Tall`, `sideOpened` (space-separated keys `n:<folder>` notes folder, `f:<id>` task folder, `l:<id>` list; helpers `folded`, `opened`); session-only. Notes and task folders start open (`n:`/`f:` keys shut them by hand); lists start shut (`l:` keys open them); the open list always shows open, and its folder and the selected note's folder cannot be shut.
  - Notes: search field (`notesQuery`: title, body, tags) + sort button (opens the shared `sort-menu`); folders → notes; the folder rows show only when a real folder exists.
  - Tasks: folders → lists (icon or colour dot) → up to 5 newest open tasks per list. New folder opens the sidebar's own popover `side-folder-pop` (shares `folderDraft`/`addFolder`).
- **Main pane when wide:** the Notes and Tasks root routes show an empty state (`notes-pane`, `tasks-pane`; "Select a Note/List") instead of their lists and headers; notes and lists open beside the sidebar. Narrow layouts are unchanged.
- **Actions:**
  - `onWinResize(w, h)` → `winW = w`.
  - `openNewNote`, `openTrash`, `openNewList`: `open(nav, …)` when wide (lands in the right tab from the sidebar), `push` otherwise. `openSideList(id)` → `open(nav, /tasks/id)`.
  - `openSideNote(id)` → `loadNoteEditor(id)` (shared with `openNote`) + `open(nav, /note/id)` (lands in Notes tab).
  - `openRecentTask(listId, id)` → `push(open(nav, /tasks/listId), /task/id)` (`taskDetail` reads `openList`).
  - `follow`: `/event/` urls → `open` (so the calendar lands in its own tab); other urls unchanged.
- **Refresh:** `recentTasks` on taskSaved, taskDeleted, taskMoved, taskDropped, taskReordered, taskToggled, sectionTaskAdded, listQuickAdded, newTaskAdded, listDeleted, authReply. `recentEvents` on eventAdded, eventSaved, eventDeleted, calendarDeleted, authReply.
- **Headers:** `Avatar` (testId `avatar-mobile`, `show=(not wide)`) and `persona*` buttons `display=(wide ? "none" : "flex")`; header keeps actions + flex spacer. No brand block: the sidebar starts with a 32 px spacer (`sidebar-top`) under the title bar.
- **User:** `sidebar-user` (`Avatar` 32px, testId `sidebar-avatar`, + name + email) → `popovertarget="persona-menu"`; shown only when signed in.
- **Layout units:** sidebar `width="21rem"` (rem avoids `lower-text-px-width`).

## TestIds
`sidebar`, `sidebar-top`, `titlebar`, `sidebar-toggle`, `crumb-section|folder|leaf|mode`, `side-tab-notes|tasks|calendar`, `side-notes-fold|tasks-fold`, `side-new-note`, `side-trash`, `side-search`, `side-sort`, `side-notes-tree|tasks-tree`, `side-notes-more|tasks-more`, `side-notes-empty|tasks-empty`, `side-new-list`, `side-new-folder`, `side-folder-pop|draft|error`, `side-add-folder`, `side-folder-<name>` (notes folder), `side-task-folder-<id>`, `side-list-<id>`, `side-list-fold-<id>`, `side-note-<id>` (button), `side-task-<id>` (button), `side-event-<id>` (link, "Mon 16" + title), `sidebar-user`.

## Breakpoint & Why Custom
- 900px: `wide` threshold (exact's own automatic sidebar also starts at 900px web, Mac always).
- Custom because exact's auto sidebar has no slots for per-tab recents or a user footer, and exact has no media queries: width comes from `resize`.

## Tests (app.test.contract)
- "the desktop sidebar shows brand, recents and user" (1280x800): `expect state winW == 1280`, sideNotes.0 title (made via `side-new-note`), `sidebar-user` → `persona-name`.
- "the sidebar's notes tree searches, folds and grows": search narrows `sideNotes`, `side-notes-fold` toggles `side-notes-tree`.
- "the sidebar's tasks tree shows lists with their newest tasks and folds": `side-new-list`, `side-tasks-fold`, `side-new-folder` → `taskFolders`.
- "the desktop sidebar switches tabs" (1280x800): `side-tab-*` → `nav.tab`.
- "the phone layout keeps the tab bar" (390x844): `tabs` present, `sidebar` missing.

## Related: [../../TABLEOFCONTENTS.md](../../TABLEOFCONTENTS.md), [tasks/tasks-board.md](tasks/tasks-board.md), [calendar/calendar-ux.md](calendar/calendar-ux.md)

## Signed-out screen
No sidebar and no header (any width): the Notes/Tasks/Calendar roots draw only `SignIn` (logo `auth-logo`, form, footer `auth-footer` with `privacy-link`, `terms-link`); `navigationBar="none"` on the route. `/privacy` and `/terms` are Notes-tab routes (`LegalPage`, `legal-body`) whose text is a placeholder until the documents exist; the server's `appRoute` list serves them.

## Wide main pane and look (2026-11)
- Notes root: "Pick up where you left off" cards (`pane-note-<id>`, 6 newest of `sideNotes`), `pane-add-note`; empty: "Nothing written yet". Tasks root: list cards (`pane-list-<id>`: name, up to 3 open tasks) and `pane-new-list`; empty: "No lists yet".
- `openSideNote`/`openSideList` replace the top route when it is already a note/list, so sidebar clicks don't stack Back entries; Back stays as the way to close a note or list.
- The task list view is capped at 46rem and centred. Sidebar ground `#eef1f6`/`#1a1c21`, active tab in `AccentColor`. The sidebar's scroll area is `flex="1 1 0%"` so it shrinks above the pinned user card (Calendar row was covered at 800px).

## Form sheets as a bottom drawer (wide)
- On a wide window (≥900 px, signed in) settings, new/edit list, new section, new task, new event, event detail, manage calendars and add calendar open in one root-level drawer instead of a modal route: state `sheet` (`settings|editList|newList|newSection|newTask|newEvent|event|manageCalendars|addCalendar`), `sheetArg` (list or event id), `sheetBack` (the sheet to return to: Add Calendar over Manage); actions `openSheet(name, arg)`, `closeSheet`. The layer (`sheet-layer`) covers the content pane (left 21rem = the sidebar's width); a scrim (`sheet-scrim`, tap to dismiss) and the panel (`sheet`, `grabber`: `sheet-grabber`; `min(40rem, 100% − 2rem)` wide, `min(86%, 46rem)` high, bottom aligned). Narrow windows and iOS keep the modal routes.
- The components (`Settings`, `EditListSheet`, `NewSectionSheet`, `ManageCalendars`, `AddCalendar`, `EventEditor`, `TaskEditor`) have no root frame (multi-root views: `header`, `list`, …); each route call site wraps them in a route column (`navigationKey`, `navigationPresentation="modal"`, `navigationScroll`), and the drawer instantiates them again with `route=0` and `cancel/done=closeSheet`. After-save/delete hooks close the sheet too (`closeSheet()` beside the `top(nav).name == …` + `back` pair). `follow("/event/<id>")` opens the event sheet on wide windows; `newTaskOpen` also reads `sheet`.
- Tests: "on a wide window settings and new list open as a bottom drawer and close again".
