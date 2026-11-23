# Import and drop zones

**Status:** ✅ Implemented (macOS, Windows, web) | ⏳ phones/Linux/Android have no file drop; folder nesting is a flat path string

## Overview
Files dropped anywhere on the window (wide layouts) are routed by type. Images go to the open note or task; Markdown/text files and folders become notes.

## Key Details
- Contract: `main#app` declares `dragenter=dropEntered dragleave=dropLeft drop=filesDropped`; `dropOver` shows overlay `drop-overlay`. `fn isImagePath`, `fn lastSegment`.
- `filesDropped(e: DragEvent)`: `e.files` are `doc:` handles. Images (`.png .jpg .jpeg .gif .webp`) → `imageChosen` when a note editor is open (`crumbOnNote`), else `uploadTaskImages` (newline-separated names/paths) for `openTask`. Everything else → mutation `notesImported = importNotes(paths)` (`refreshes lib then afterImport`; result shown through `templateNotice`, "Imported N notes").
- `app.ts` source `importNotes` (grant `fs.read doc:/`): file `.md .markdown .mdown .txt` dropped alone → folderless note; a dropped folder is walked recursively (hidden entries and `node_modules` skipped), note folder = path below the drop joined by `/` including the dropped folder's name (`Notes/Work/2024`), cut to the server's 120 chars. Title = first `# Heading` (removed from body) else file name; max 3000 files, 2 MiB each. Other files are skipped silently.
- Notes are created through `POST /notes` (`folder`, `bodyMarkdown`); folders are flat strings, so nested paths appear as one folder name.
- No test-suite step can drop files; checked with the driver: `tap app drop <path…>` (`bun exact.mjs agent macos`).

## Not covered
- Relative image links inside imported Markdown (`![](img/a.png)`) are left as written.
- Frontmatter (tags, dates) is kept as body text.
- No file picker for hosts without drop (iOS, Android, Linux).

## Related: [templates.md](templates.md), [../../backend/collaboration.md](../../backend/collaboration.md)

## Export
See [notes/notes.md](notes/notes.md) (Import/Export): note, folder and library exports mirror the folder layout, so an export re-imports with its folders.
