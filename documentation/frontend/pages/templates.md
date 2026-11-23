# Templates (exact app)

**Status:** ✅ Implemented (wide windows) | Start a note or list from a built-in or saved template; save any note or list as one

## Overview
A "Start from a template" row (`TemplateRow`) on the wide Notes home and Tasks home (also in their empty states). Built-ins ship in the app; saved ones live on the server (`templates` table, `documentation/backend/database.md`).

## Key Details
- **Sources (`app/app.ts`):** `loadTemplates` (built-ins, then `GET /templates`; resource `templates` → `{notes, lists}` of `TemplateItem {id,name,blurb,builtin,title,body,json}`), `saveNoteTemplate`, `saveListTemplate(listId, name)` (open tasks and subtasks, sections in order; no dates, people or done tasks), `deleteTemplate`, `makeListFromTemplate(name, json)` (creates list, sections, tasks, subtasks in sequence; `ListMade {ok,error,id}`).
- **Built-ins:** notes: Meeting notes, Weekly review, Project brief, Daily journal; lists: Packing list, Project plan, Moving checklist.
- **Use:** note: `openNoteFromTemplate(title, body)` opens a new note in edit mode with the text filled (autosaves like any new note). List: `newListFromTemplate` then `afterListMade` opens the list.
- **Save:** note editor button `note-template` (`saveNoteAsTemplate`, name = title); list menu item `list-save-template` (`saveListAsTemplate`, name = list name). `templateNotice` shows in the title bar for 4 s (`template-notice`).
- **Delete:** saved templates have `template-delete-<id>` → dialog `delete-template`.
- **testIds:** `templates-note|list`, `template-<id>`, `template-delete-<id>`, `note-template`, `list-save-template`, `template-notice`, `delete-template-confirm|cancel`.
- **Tests:** "a new note can start from a template", "a list starts from a template, and a list can be saved as one".
- **Not yet:** phone layouts (the row lives on the wide homes only); a note template copies the body as is (images keep pointing at the original note's files).

## Related: desktop-sidebar.md, ../../backend/database.md

## Phones
- Notes/Tasks headers (narrow only) get a templates button (`templates-button-notes`/`-tasks`) opening popover `tpl-menu`: the open tab's templates (`tplAll`), `tpl-search` input (`tplQuery`) shown when more than 6, rows `tpl-<id>`.
