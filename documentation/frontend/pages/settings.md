# Settings, Avatar & Appearance (exact app)

**Status:** ✅ Implemented | Avatar component, Settings modal, Auto/Light/Dark, password change

## Overview
User menu (`persona-menu`) → Settings modal route `settings` ("/settings", `navigationPresentation="modal"`, rendered in App's stack loop so it opens from any tab). Avatar shows in the mobile headers (32px) and the desktop sidebar user button (32px) and the menu header (40px).

## Avatar (`component Avatar`, app/app.contract)
- Props: `size` (px), `name`, `icon`, `color`, `photoUrl`, `fetched: IconPaths[]`, `testId`, `show` (display flex/none).
- Priority: photo (`image` cover, circle) → icon (white LucideIcon on `color`, else AccentColor) → initial of `name` (AccentColor, or `color`).
- Data: root `profile` (`loadProfile` → GET `/profile`) → `Profile{owner, displayName, avatarUrl, avatarIcon, avatarColor}`; App derives `avatarUrl/avatarIcon/avatarColor` only when `profile.owner == session.email`.
- Photo URL gets `?v=<avatar.updatedAt>` (server reuses one file name; the query busts the image cache).
- `iconNames` includes `avatarIcon` (non-bundled names fetched via `lucideIcon`).
- Mobile headers: testId `avatar-mobile` (hidden when `wide`). Menu: `persona-avatar`. Sidebar: `sidebar-avatar` (`sidebar-brand` stays the Notient logo).

## Settings (`component Settings`)
- Header "Settings", `settings-done` (Done → `back`).
- Sheet width: root column `width="100%" min-width="min(34rem, 100%)"`, list `width="100%"` (Mac sizes a modal route to its content; web/iOS unaffected — same rule on EditListSheet, NewSectionSheet, TaskEditor, ManageCalendars, AddCalendar roots).
- Avatar: `settings-avatar-preview`; `avatar-style` toggles IconColorPicker (`pick-icon-<name>`, `pick-color-<hex>`; picks save whole via `saveStyle(icon,color)` → PUT `/profile` avatarIcon/avatarColor); `avatar-upload` → `showPicker("settings-avatar")` → `pickPhoto` → `uploadAvatar` (POST `/profile/avatar` multipart `avatar`, ≤2 MB, png/jpeg/webp); `avatar-remove` → `removeAvatar` (DELETE `/profile/avatar`); `avatar-initials` → clears icon+color; `avatar-error`.
- Name: `settings-name` input, `settings-name-save` → `saveName` → `updateName` (PUT `/profile` displayName; also stores `name` so `shown` updates); `settings-name-error`.
- Appearance: `radiogroup` `appearance-auto|light|dark` → `pickAppearance` (see below).
- Password: `pw-current`, `pw-new`, `pw-confirm`; `pw-save` disabled unless current≠"", new≥8 chars, new==confirm; → `changePasswordNow` → `changePassword` (POST `/auth/change-password`). Errors `pw-error`: `Wrong current password.` (401 invalid_credentials), `Use at least 8 characters.` (400 invalid_body), else server text. Success `pw-done` "Password changed". Fields are not cleared after success.

## Menu (`persona-menu`)
- Header: avatar 40px + `persona-name` + `persona-email`; items `menu-settings` (`openSettings`), `sign-out`.
- Surface: `light-dark(#ffffff, #2c2c2e)`, radius 14, shadow `0 8px 28px #00000040`, min-width 15rem. Same surface on every `role="menu"` popover: `tag-menu`, `folder-menu`, `sort-menu`, `list-menu-pop`, `cal-mode`, `cal-menu-pop` (they were transparent on mobile).

## Appearance
- State `appearance` ("auto"|"light"|"dark"). Stored in the app's store under `appearance` (grant `secret.keep appearance`; `loadPrefs` → `Prefs{appearance}`, `saveAppearance` on pick).
- Applied with exact's app scheme: `setScheme("system"|"light"|"dark")` (Auto = "system") in `showAppearance`, called by `pickAppearance` and by `restoreAppearance`.
- Restore: `task restoreAppearance when keptAppearance != "" key=keptAppearance` → `after(1, restoreNow)` (store answers async; `after(0)` is refused by the compiler).
- `setScheme` is app-wide (bars, sheets, windows). It is not kept across launches by exact, so the task re-applies it. Limit: until the store answers, the system scheme shows (a brief flash on a pinned launch).

## Fixed Issues
- Note edit: tapping below the text did nothing (textarea only as tall as its content). Edit scroller now holds a `column min-height="100%"`: textarea + `note-body-tap` filler (`flex=1`, `focusBody`: `focus("note-body")` then `setSelectionRange(body.length, body.length)`). `server/web/notient-keyboard.js` unchanged.
- Popovers were transparent on mobile: fixed by the menu surface above.

## Tests (app.test.contract)
- "settings: display name and appearance are saved" (`profile.displayName`, `appearance`)
- "change password: wrong current is refused, then it works and the new password signs in"
- "choosing an avatar icon and color is saved" (`profile.avatarIcon == "star"`, `avatarColor == "#34C759"`)

## Related: [../../TABLEOFCONTENTS.md](../../TABLEOFCONTENTS.md), [../desktop-sidebar.md](desktop-sidebar.md), [../../backend/services/auth.md](../../backend/services/auth.md), [notes/rich-text.md](notes/rich-text.md)
