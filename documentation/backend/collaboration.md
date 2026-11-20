# Collaboration (shared task lists)

**Status:** ✅ Server access control for shared lists | ⏳ live sync, assigning people to tasks

## Overview
A list's owner shares it by email with permission `view` or `edit` (`POST /task-list-shares {listId, sharedWithUserEmail, permission}`; only the owner may share, the list must exist). A shared list's tasks and sections then work through the normal endpoints for the other person.

## Key Details
- `server/src/lib/listAccess.js` (`createListAccess(repos)`): `forList/forTask/forSection(id, userId)` → `{owner, ownerId, write}` or null; `readAs`/`writeAs` give the user id to query/write as (the list's owner, so records stay owned by one user); `writeAs` throws 403 `read_only_list` for a `view` share.
- `routes/tasks.js`, `routes/taskSections.js`: GET with `listId` (tasks also `parentId`), POST (`listId` in the body), PATCH `/:id` resolve access first. A user with no access sees an empty list / 404.
- Repos: `tasks.findAnyById`, `taskSections.findAnyById`.
- Shared lists reach the person via `GET /task-list-shares/shared-with-me` (returns the list's columns, `permission`, `sharedByEmail`); the app lists them under "Shared with me" and `allLists` gives the open list its name/look.
- `GET /tasks/board?listId=` (`routes/tasks.js`): one read for a board/list screen → `{sections, tasks, subtasks, members}`: exactly what `GET /task-sections?listId=`, `GET /tasks?listId=` (top-level), `GET /tasks?parentId=` for each task with `subtaskCount > 0` (concatenated), and `GET /task-list-shares/members/:listId` return. Owner or shared viewer/editor reads it as the owner; no access → 404 `task_list_not_found`; missing `listId` → 400 `invalid_query`.
- Attachments follow the task's list access (`routes/taskAttachments.js` `taskFor`): owner, editor and admin read and write, viewer reads, strangers get 404.
- Not yet shared: subtask counts across owners, task notifications, `/tasks?since` sync.
- Claude's own account: credentials in `~/.config/notient-claude/credentials.env` (outside the repo).

## Tests
`server/tests/collab.test.js`: private until shared; editor read/add/change/finish/add section; viewer read-only (403); stranger and non-owner sharing refused.

## Related: [database.md](database.md), [../frontend/pages/tasks/tasks-board.md](../frontend/pages/tasks/tasks-board.md)

## Live changes (WebSocket)
- **Server:** `lib/liveHub.js` (`ws`). `POST /live/ticket` (auth) → single-use 60 s ticket; `ws(s)://host/live?ticket=…` upgrades (`httpServer.on('upgrade')` in `index.js`, hub on `app.locals.liveHub`). Express middleware `liveHub.middleware` watches successful POST/PATCH/PUT/DELETE on `/tasks`, `/task-sections`, `/task-lists`, `/task-list-shares`, `/task-attachments` and sends `{type:"changed", listId, by}` to the actor, the list's owner and everyone it is shared with. First frame `{type:"hello"}`.
- **App:** sources `liveTicket(attempt)` and `liveEvents(attempt)` (`app.ts`, the exact socket-ticket recipe; grants `net.websocket $SOCKET_URL`; `.env.local` `SOCKET_URL`, default `ws://127.0.0.1:8787`). Resources `liveReady`, `live` (`Live{status,ticks,text}`); tasks `liveStart` (on sign-in), `liveRetry` (new ticket 4 s after `close`/`error`), `liveChanged` (each message → `livePullNow`: refresh `recentTasks`, `sharedLists`, `lists`, and the open list's `tasks`/`sections`).
- **Fallback:** task `livePoll` still refreshes every 30 s (see below).
- **Tests:** `server/tests/collab.test.js` (owner, sharer and stranger; single-use ticket); app test "the live channel connects and hears this account's own changes" (run with `SOCKET_URL=ws://127.0.0.1:8799`).

## Fallback polling
App (`app.contract` task `livePoll`): every 30 s while a list screen is open and nothing is being typed (`sectionAdding`, `sectionRenaming`, `listQuickOpen`) or dragged (pending reorder mutations), it refreshes `tasks`, `sections`, `recentTasks`; `sharedLists` refreshes every tick when signed in.

## Assigning people to tasks
- Server: `tasks.assignee_id` (migration 34), `assigneeId` on the task endpoints (create/update; `null` clears; 400 `invalid_assignee` unless the person is the list's owner or shared with it). `GET /task-list-shares/members/:listId` → `{members:[{id, role (owner|view|edit), email, displayName, avatarIcon, avatarColor}]}` for anyone who can see the list (`listAccess.members/isMember`).
- App: `Task.assigneeId`; resource `members` (`loadMembers(openList)`), derive `memberList`; source `assignTask(id, assigneeId)` / action `assignTaskNow` / mutation `taskAssigned` (refreshes tasks, subtasks, boardSubtasks, recentTasks). Task editor: "Assigned to" picker (testId `task-assignee`, only when editing a list with more than one person), a compact picker on each subtask (`subtask-assignee-<id>`), and the person's initial on their colour (`Assignee`, testId `assignee-mark`) before the title on list rows and board cards (`TaskLabel` prop `members`).
- Tests: `server/tests/collab.test.js` ("assigning people to tasks").

## Assignee notifications and wider live changes
- Assigning a task (create with `assigneeId`, or an update that changes it) to someone other than the actor writes a `task_notifications` row (`type 'assigned'`, payload `taskTitle, listName, listId, byUserId, byName`) and sends the assignee `{type:"notify", kind:"notifications"}` over the live channel. `GET /notifications` lists it as `task_assigned` ("Task assigned to you", message "<name> assigned you <task> in <list>", plus `listId`); `PATCH /notifications/read-all` marks all read.
- Live messages now carry `kind`: `tasks` (with `listId`), `notes` (the writer's devices and everyone the note is shared with), `calendar` (the writer's devices; `ensure-defaults` is not a change). The app routes each (`liveKind`, `livePullNow`): notes refresh `lib` (not while a note is being typed) and `shared`; calendar refreshes `view` and `recentEvents`; tasks as before.
- Fixed: the hub read `req.path` after the router had stripped its mount, so task PATCH changes never reached the people a list is shared with; it now uses `originalUrl`. `POST /note-shares` now needs an existing note owned by the caller (the ownership check was silently skipped).

## Notification bell
- App: sources `loadNotifications()` (`GET /notifications` → `{owner, items}`, `[]` signed out or failed) and `markNotificationsRead()` (`PATCH /notifications/read-all`) in `app.ts`; resource `notifications`, derives `notifRows` (newest 30) and `unreadCount`, mutation `notificationsRead` (refreshes `notifications`).
- Actions: `markAllRead` (sends the mutation), `openNotification(listId, taskId)` (hides popover `notif-pop`, opens the task like `openRecentTask`, always marks all read). UI: bell (`testId bell`, red `bell-count` badge when unread) in `DesktopSidebar`'s brand row (prop `unread`) and the narrow Notes/Tasks headers; popover `notif-pop` (heading, `notif-read-all`, `notif-<id>` rows with accent dot when unread, `notif-empty`).
- Tests: app test "the bell opens the notifications popover" (`app.test.contract`).
