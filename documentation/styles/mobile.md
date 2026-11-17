# Mobile Styling Guidelines

**Status:** ✅ Implemented | Viewport height, safe areas, touch targets

## Mobile Viewport
- **Height:** Use `dvh` (Dynamic Viewport Height) instead of `vh` or `%`.
  - Root: `height: 100dvh`, `min-height: 100dvh`, `min-height: -webkit-fill-available`.
  - Body/HTML should use `overscroll-behavior-y: none` to prevent iOS background overscroll.
- **Width:** `w-full` logic usually suffices.

## Safe Areas
- Use `safe-top` and `safe-bottom` utilities (mapped to `env(safe-area-inset-*)`) for fixed elements.
- Ensure bottom navigation and FABs respect home indicator areas.

## Touch Targets
- Minimum touch target size: 44x44px.
- Use `touch-action: pan-y` for swipeable list items to prevent gesture conflicts.

## Components
- **Navigation:** Bottom tab bar on mobile, top bar on desktop.
- **Lists:** `overflow-y-auto` with `overscroll-behavior-y: contain` (if needed) for smooth scrolling.
- **Modals:** Full-screen or bottom-sheet style on mobile.
