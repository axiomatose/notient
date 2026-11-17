# UI Components

**Status:** ✅ Implemented | React + Tailwind CSS

## Overview
Reusable React components with glassmorphism design. Modular architecture for consistent UI.

## Key Details

### UI Components
**Location:** `web/src/components/ui/`

**GlassModal**
```typescript
interface GlassModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}
```
- Glassmorphism design (blur + transparency)
- Backdrop click to close
- Escape key to close
- Smooth open/close animations

**GlassButton**
```typescript
interface GlassButtonProps {
  children: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}
```
- Glass effect with gradient
- Hover animations
- Loading state support
- Multiple variants

### Feature Components

**NotificationDropdown**
```typescript
interface NotificationDropdownProps {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
}
```
- Dropdown notification panel
- Real-time updates
- Mark as read
- Filter by type

**SettingsModal**
```typescript
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}
```
- Tabbed settings interface
- Profile, notifications, sync settings
- Form validation
- Auto-save support
- Form validation

**SlashMenu**
```typescript
interface SlashMenuProps {
  items: CommandItem[];
  command: (item: CommandItem) => void;
}
```
- Floating command menu
- Triggered by "/"
- Keyboard navigation (Up/Down/Enter)
- Commands: Formatting (Bold, Italic, Link, etc.), Blocks (Headers, Lists), Inserts (Link, Image)

**EditorBubbleMenu**
```typescript
interface EditorBubbleMenuProps {
  editor: Editor;
}
```
- Floating formatting menu for text selection
- Glassmorphism design
- Commands: Bold, Italic, Underline, Highlight, Clear, Headers, Alignment, Sub/Superscript

### Calendar Components
**Location:** `web/src/features/calendar/`

**CalendarSettingsModal**
```typescript
interface CalendarSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  calendars: Calendar[];
  onSave: (calendar: Calendar) => void;
}
```
- CalDAV configuration
- Calendar color picker
- Active/inactive toggle
- Sync settings

### Design System
**Colors:** Glass variants with blur, gradients
**Typography:** System fonts with Tailwind
**Spacing:** Tailwind spacing scale (4, 6, 8, 12, 16)
**Animations:** CSS transitions, framer-motion for complex animations
**Borders:** Thin glass borders (1px, rgba white)
**Shadows:** Soft colored shadows

### Component Patterns
```typescript
// Use consistent props interface
interface Props {
  // Required props
  // Optional props with defaults
}

// Use forwardRef for ref forwarding
export const Component = forwardRef<HTMLDivElement, Props>(...)

// Use useMemo for expensive calculations
const computed = useMemo(() => {...}, [deps])

// Use useCallback for event handlers
const handleClick = useCallback(() => {...}, [deps])
```

### Styling Approach
- Tailwind utility classes
- Custom glass utilities in `web/src/index.css`
- Theme tokens via CSS variables
- Responsive breakpoints (sm, md, lg, xl)

### State Management
- Zustand for global state
- React Context for feature-specific state
- Local state with useState/useReducer

### Form Handling
- React Hook Form for complex forms
- Zod validation schema
- Auto-save patterns

## Related
- [routing-auth.md](routing-auth.md) - Route protection
- [styles/mobile.md](../styles/mobile.md) - Mobile components
- [styles/largescreens.md](../styles/largescreens.md) - Desktop components