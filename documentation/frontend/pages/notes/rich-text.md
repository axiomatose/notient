# Rich Text Editor & Reader (exact app)

**Status:** ⏳ In Progress | Markdown source stays the storage format; app-side block reader + exact's built-in Markdown editor

## Overview
Notes are Markdown strings. Edit mode uses exact's WYSIWYG `textarea markup="markdown"`; view mode renders the body as interactive blocks (tasks toggle, code blocks copy) built from the same source.

## Research Result (no external library)
- exact (upstream `expo/exact`, not forked) already ships:
  - Reader: `text <src> markup="markdown"` — headings/lists/quotes/code/links, one node, **no per-block events** (task boxes inert, no code tap).
  - Editor: `textarea markup="markdown"` — syntax hidden away from caret (web), dimmed (Apple); `format(id, cmd[, arg])` cmds: `bold italic code strike link heading(1-6) bullet ordered task toggleTask quote codeblock footnote figure indent outdent newline`; `select=` → `MarkdownSelection{formats, mixed, link, unavailable, atom}`; toolbar buttons need `retainFocus=true`.
  - Atoms (`atom`, `atoms=`, `atomFaces=`, `atompress=`) — pills with press events (mentions, file links).
  - Clipboard: `copyText(...)` from an action.
  - Reference app: `exact/apps/markdown-stress/app.contract` (full toolbar + link sheet).
- Browser rich-text libs (TipTap/ProseMirror/Lexical) are not usable: exact contracts render through host views, no DOM access.
- Decision: extend in-app, file upstream feedback (`bun exact.mjs feedback note`) for reader task/code events.

## Design
### View mode = block reader
- Split `editorBody` into blocks: `fence` (``` … ```), `task` (`- [ ]`/`- [x]` line, keeps indent), `md` (any other run of lines).
- Render per block:
  - `md` → `text markup="markdown"` (wraps, selectable)
  - `task` → checkbox + `text markup="markdown"`; toggle rewrites that source line (`[ ]`↔`[x]`), updates `editorBody`, saves via silent autosave mutation (no list refresh)
  - `fence` → monospace wrapped text + Copy button (`copyText`)
- Shared-with-me / public notes: same blocks, toggles disabled.
- Container: `scroll width=100% overflow-x=hidden`, text `overflow-wrap=anywhere` (fixed width, word wrap).

### Edit mode = exact Markdown editor
- Toolbar (edit + new-note): bold, italic, strike, code, heading, bullet, ordered, task, quote, codeblock, link (sheet for URL), indent/outdent.
- Active state from `select` → `MarkdownSelection.formats`; disable from `.unavailable`.

## Phases
| # | Scope | Status |
|---|---|---|
| 0 | View mode width/wrap fix | ✅ |
| 1 | Block reader: task toggles, code copy, shared/public reuse | ✅ web verified (390px driver run); shared/public not driven; toggle save unconfirmed after reopen |
| 2 | Lossless Markdown API: `bodyMarkdown` in/out (notes, shares, public links); app stops HTML round-trip | ✅ |
| 3 | Toolbar upgrade + active states + link sheet | ✅ web verified (new-note: bold, strike, link sheet, codeblock; NoteEditor 390px no overflow); `-code` is inline code, heading=`2`; Apple build not run |
| 4 | Tests in `app/app.test.contract` for toggle/copy/toolbar | ✅ 4 tests (task toggle persists across sign-out, code copy, `new-fmt-bold` on Shift+Arrow selection, lossless fidelity); suite 19/19 |

## Storage Fidelity (Phase 2)
- Server keeps `${notesDir}/<userId>/<noteId>.md`; legacy API `body` = HTML (`marked`) in, `turndown` out (`server/src/db/notes.js` readContent/writeContent).
- App previously did regex HTML↔md (`app/app.ts` toMarkdown/mdToHtml) → triple lossy round-trip (nested/ordered lists, fence langs, tables, `\[x\]` escaping).
- Fix: API also returns `bodyMarkdown` (raw file) and accepts `bodyMarkdown` (written verbatim, wins over `body`); app uses it exclusively.

## Toolbar & Scroll Chrome
- Toolbar: inline SVG icons (Lucide-style paths, `stroke="currentcolor"`; exact `symbol:` roles lack formatting glyphs, `symbol:sf/*` blank on web). Groups split by 1px dividers: inline (B I S code) | heading | lists (bullet, ordered, task) | blocks (quote, codeblock) | link | outdent/indent | image (only when `imageInput` prop != ""; calls `showPicker(imageInput)`, testId `note-image`). Active = `-exact-link` ink + tinted bg.
- Scroll chrome lives in `App` (`noteChromeHidden`, `noteLastY`, `noteChromeFor`, `noteScrolled`; reset in `openNote`/`startEdit`), passed to NoteEditor (`chromeHidden`, `onScroll`). Down >6px → header + title row hidden; reveal only on a true fast flick up (>2.5 px/ms between scroll events, `noteLastAt`) or y≤4. Toolbar row gets 19px top padding while the header is hidden (clears the status-bar fade). Format bar always shown in edit mode. Header title: "Edit Note" / "View Note" by mode.
- Edit scroller holds `column min-height="100%"`: textarea + `note-body-tap` filler (`flex=1`, `focusBody`: focus + caret at end), so taps below the text focus the body (see [settings.md](../settings.md) Fixed Issues).
- Textarea never self-scrolls (`field-sizing="content"`, `overflow-y="hidden"`); page scroller (`note-edit-scroll`/`note-view-scroll`) is the only scroll source. Info footer (`note-footer`: errors + metaLine) is an absolute translucent overlay at the bottom in both modes; content has 48px bottom padding to clear it.

## Keyboard (iOS Safari)
- exact JS web target only writes `interactive-widget` to the viewport meta (root `main interactive-widget="resizes-content"`); iOS Safari ignores it and pans the page → header/format bar pushed off top, tab bar under keyboard.
- Data module (`app.ts`) can't touch the DOM (sandboxed; no DOM types). Shim: `server/web/notient-keyboard.js`, injected by `server/index.js` into the client shell (`<script>` before `<title>`; static `index: false`).
- Shim: keyboard = `documentElement.clientHeight - visualViewport.height > 1` (iOS shrinks `innerHeight` too) → html/body height = visual viewport; body `translateY(vv.pageTop)` FOLLOWS Safari's pan (never `scrollTo(0,0)`: resetting on each vv scroll made the page bounce); `html[data-keyboard]` hides `[data-testid="tabs"]`; on open/`focusin`, 350ms later (after Safari's own focus scrolling of every scrollable ancestor; correcting during it made nested scrollers fight), smooth-scroll the focused field's scroller so the caret (selection rect, input rect, or textarea mirror) clears the footer; dispatches window `resize` when the pan changes.
- Top-layer popovers are NOT moved by the body translate and exact doesn't re-anchor them on pan → a popover with an input low on screen drifts/vanishes under the keyboard. Use in-flow absolutely positioned panels for low inputs (tasks quick add `quick-add-pop`, state `quickOpen`); popovers near the top (new list/folder, list menu) are fine.
- Modal jitter root cause: exact modals are `position: fixed`; their containing block is the body only while it has a transform. Body transform must stay set (`translateY(0px)` too) the whole time the keyboard is up, else the modal flips between full-layout-height and visible-height on focus → Safari re-pans → vibration loop. Also: `html[data-keyboard], body {overflow:hidden; overscroll-behavior:none}` (translate adds doc overflow a swipe could scroll), `fit` throttled to 1/frame (rAF), caret correction cancelled on `touchstart`.
- Forms inside scrollers: multi-line fields grow instead of scrolling (`field-sizing="content" overflow-y="hidden" min-height`: `task-notes`, `event-notes`) → one scroll container per form.
- Verified iOS 27.2 simulator with software keyboard (notes editor, New Event, New Reminder modal, tasks quick-add).

## Fixed Issues
- Notes saved before Phase 2 store tasks as `*   \[ \] label` (turndown). Parser (`fn taskRest`/`boxLen`) accepts `-`/`*`/`+`, any spacing, escaped boxes; toggle rewrites the line to canonical `- [x] label`.

## Key Locations
- `app/app.contract` — `component App`: `editorMode`, `editorBody`, `savedBody`, `autoSaveTick`, `fmtBody`; view at `testId="note-view-scroll"` / `note-body-view`
- `app/app.contract` `component MarkdownToolbar` (props `editor`, `prefix`, `formats`, `unavailable`, `link`; horizontal scroller, link sheet) + `component FmtTool` (one button); used by NoteEditor (`fmt-*`), TaskEditor (`tfmt-*`), EventEditor (`efmt-*`); each editor `select=selectedFmt` stores `fmtFormats`/`fmtUnavailable`/`fmtLink`
- Block parser: `app/app.contract` `fn blockStarts`/`blocksOf` (pure, no loops), `shape ViewBlock`; `component NoteBlocks` (shared/public via `editable=false`); `action toggleTaskLine` (silent `noteAutoSaved`)
- `app/app.ts` `toMarkdown`: `<pre><code>` → ``` fence (was flattened to backticks, losing fences on save/reopen)
- Build/deploy: `cd app && bun exact.mjs web-build && rm -rf target/app-dist && cp -R target/web-dist target/app-dist` (served by `server.ts` on :8787)

## Native format bar (iOS)
- iOS only: glass capsule (`UIGlassEffect` iOS 26+, `.systemThinMaterial` fallback) as the note body's `inputAccessoryView`; SF Symbols; scrolls; trailing dismiss bubble. Web unchanged (app.json `hatches: {"formatbar": ["ios"]}`; bridge input stays invisible, `nativeBar` false)
- Hatch word `formatbar` on two nodes (NoteEditor edit mode): `textarea#note-body` `data-role="editor"` and hidden `input testId="fmt-bridge"` `data-role="bridge"`. Data words (app.json `data`): `role`, `formats`, `unavailable`, `link` (current link target)
- Bridge protocol (Swift `bridge.input(text)` -> contract `bridgeInput`): `platform:ios` once on mount -> `nativeBar=true` (hides in-page `MarkdownToolbar` row); `cmd:<name>:<n>` -> `nativeCmd(name)`: `format("note-body", name)`; `heading` -> level 2; `image` -> `showPicker("note-image")`; `dismiss` -> `blur("note-body")`; `link:<n>:<url>` -> `format("note-body","link",url)` (empty url removes)
- Link tool is Swift-only (`LinkEntry`): a hidden proxy `UITextField` takes the keyboard (`.URL` keyboard = lowercase, `.com` key, no autocorrect) with `LinkBarView` (typed text mirror + cancel/apply glass bubbles) as its accessory; Apply prepends `https://` when no scheme, refocuses the text view (selection kept), sends `link:`; Return applies
- Active tools tinted `systemBlue`. Tools that cannot apply are hidden on iPhone (bar shrinks, dividers collapse) and muted on wider idioms; indent/outdent apply only on list lines (`bullet`/`ordered`/`task` in formats)
- `LinkStyler`: exact draws editor links underlined in body ink; the hatch restyles `.link` runs bold `systemBlue`, no underline, after each `NSTextStorage.didProcessEditingNotification`
- Buttons are UIControls (no focus steal), light haptic per tap
- Images: upload returns a URL; `imageInserted` appends `![image](url)` to `editorBody` (no server-side patch; the old HTML patch was never reflected in the editor and was overwritten by autosave)
- Files: `app/modules/apple/Hatches.swift` (module), `app/modules/apple/FormatBarHatch.swift` (bar, link entry, styler); contract: `NoteEditor` `bridgeInput`/`nativeCmd`. `exact hatch` refuses (no `apple/` dir), files written by hand

## View-mode links and images
- The markdown reader paints links as underlined body-colour text and shows an image as its alt text only. `NoteBlocks` therefore parses two more block kinds (`fn isImageLine`, `isLinkLine`, one source line each):
  - `image` (`![alt](src)` or linked `[![alt](src)](href)` on its own line): `image src width=100%`; linked ones wrap it in `link href` (`view-image-link-<line>`, plain `view-image-<line>`)
  - `link` (any other line with `[label](url)`): drawn as `text` + child spans (`spansOf`/`pieceSpans`), links bold `-exact-system-blue` with `href`; heading level, bullet and quote markers handled (`headLevel`, `lineBody`); inline bold/italic on such lines shows raw
- Pitfall: an unknown method (`lastIndexOf`) reports a misleading unrelated type error first (`fetched expects IconPaths[]`)
- Image insert lands at the caret (`caret` from the textarea's `selectionchange`, `setRangeText`), on its own line; the editor itself shows `![image` with the destination hidden

## Moving and removing images
- The editor hides an image's `](address)` and refuses to delete it (backspace, cut), so images are managed from `image-bar` (testIds `image-up`, `image-down`, `image-remove`), shown when the caret's line is an image line (`caretOnImage`, from `caret`/`caretLine`). `imageOp`: remove drops the line plus one adjacent blank; up/down swap the image line with the nearest non-blank line above/below, then put the caret on it.

## New note
- No separate sheet: `openNewNote` blanks the editor state (`editorNoteId=""`) and pushes `/new` rendering `NoteEditor(fresh=true)` in edit mode (title field open). Server note is created on first autosave tick (2s idle, `startNote(false)`) or Save (`startNote(true)`, pops back) once title or body is non-blank; title defaults to the first body line (`draftTitle`). `adoptNote` takes the id; later saves PATCH as for any note. Mutation `noteStarted` (`createNoteDraft` -> `CreatedNote{ok,error,id,title,body}`). Tests use `note-title`/`note-body`/`note-save` on the new route

## Folder and tag suggestions
- Freesolo popovers in `NoteEditor`: `note-folder-pop` shows up to 5 `folder-suggest-<i>` buttons from `folderPool` (App derive `recentFolders`: `lib.folders` minus "" ordered by newest active-note `updatedAt`, `fn folderActivity`); typing filters case-insensitive `includes`, still recent-first; current value and "" never offered; tap = `pickFolder` → `editFolder` + `hidePopover("note-folder-pop")`.
- `note-tags-pop` shows up to 6 `tag-suggest-<i>` from `tagPool` (App derive `popularTags`: `lib.tags` by count of active notes carrying the tag); last token of `tagsText` (`tagLast`) empty → popular tags, partial → `startsWith` case-insensitive, popular-first; tags among the other tokens (`tagOthers`) never offered; tap = `pickTag` replaces the last token and ends `", "` (popover stays open for more).
- Pools passed as props `folderPool`/`tagPool` at both call sites (note + new-note). Test: "the editor's popovers suggest recent folders and popular tags".

## Related: [notes.md](notes.md), [../../../exact-migration.md](../../../exact-migration.md)

## Tap to edit
- View mode: empty space under the note (`note-view-tap`, min 160pt) → `tapToEdit` (state `wantFocus` → textarea `autofocus`) enters edit with the keyboard up.
- The in-page `MarkdownToolbar` is hidden whenever the native bar reports `platform:ios` (`nativeBar`); it remains only on the web, which has no keyboard accessory.
- Task and event Notes fields use the same native bar (`hatch="formatbar"`, `data-images="0"` hides the image tool; bridge `task-notes-bridge`/`event-notes-bridge` inside the title row) and hide their in-page `MarkdownToolbar` when `nativeBar`. The notes row has `press=focusNotes` (focus + caret at end): inside a native list cell the field-sized-to-content UITextView was not tappable in its empty area.

## Code block colouring (view mode)
- Data source `highlightCode(body)` (`app.ts`, `tokenizeCode`): language-agnostic scanner (comments `//`, `#`, `/* */`; strings; numbers; keywords; calls; Capitalized types). Root resource `codeHl` (`hlBody`: the open note when viewing, shared or public body); `NoteBlocks` prop `hl` finds its block by exact text and draws token `text`s coloured by `tokenColor` (Xcode-like light/dark pairs); plain text while loading. The language after the fence is ignored. Tests: `codeHl.blocks.0 .tokens.0 .k == "kw"`.

## Escaped characters in app-drawn lines
The editor stores markdown escapes (`GH\_COM\_TOKEN`). Inline-code lines and link lines are drawn app-side, so their plain spans pass through `unescapeMd` (`app.contract`); code spans are untouched.

## Vault notes
- A vault note is a note tagged `vault` (no server column). Editor header button `note-vault` (lock, accent when on) → `toggleVault` adds/removes the tag and saves (`noteSaved`, refreshes `lib`). Derive `editorVault`.
- In view mode its inline code (and single-line/fenced code blocks) draws as `••••••••` (`vaultMask()`); tapping still copies the real text; the eye (`view-code-eye-<block>[-<span>]`, Lucide `eye`/`eye-off` from `iconNames`) shows or hides each one (`NoteBlocks` state `shownKeys`).
- Search skips a vault note's body (`matchesNote`); the wide Notes pane shows "Vault note" instead of a preview.
- Test: "a vault note hides its code, copies on tap and shows it from the eye".

## Previews and the Mac editor
- Pane cards use `previewOf(body)` (`plainLine`: heading/bullet/box/fence/bold/code marks and escapes removed).
- `textarea markup="markdown"` hides syntax on the web only; on macOS and iOS the platform text view dims it (exact's documented behaviour), so the native editor shows dimmed marks.

## Code button on a bare caret
`format(editor, "code")` with nothing selected leaves an empty pair (`` ` ` ``) whose caret the editor draws outside it, so typing missed the ticks. The note editor tracks the selection (`selMoved`: `selStart/selEnd`) and `MarkdownToolbar` calls `codePlaceholder` instead when the caret is bare and not already in code: it inserts `` `code` `` and selects the word, so typing or pasting replaces it. Task and event notes keep the plain command (`collapsed=false`). Test: "the code button on a bare caret puts a selected placeholder between ticks".
- Fixed: a new note's first save (`createNoteDraft`) now sends the folder, tags and pin chosen before it (they were dropped until the next edit).
