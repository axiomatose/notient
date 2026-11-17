# Routing & Authentication

**Status:** ✅ Implemented | React Router + Protected routes

## Overview
Client-side routing with authentication guards. Auto-redirect on auth failure, session management.

## Key Details

### Router Setup
**Location:** `web/src/App.tsx`
- React Router v6
- Hash-based routing (for PWA)
- Route nesting with outlet

### Protected Routes
**Components:** `ProtectedRoute`, `PublicRoute`

**ProtectedRoute**
```typescript
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  
  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/auth/login" />;
  
  return children;
}
```

**PublicRoute**
```typescript
function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  
  if (loading) return <LoadingSpinner />;
  if (user) return <Navigate to="/" />;
  
  return children;
}
```

### Route Structure
```
/                           (Protected) - Dashboard
/auth/login                 (Public) - Login page
/auth/register              (Public) - Register page
/notes                      (Protected) - Notes list
/notes/:id                  (Protected) - Note detail
/tasks                      (Protected) - Task lists
/tasks/:listId              (Protected) - Task list
/calendar                   (Protected) - Calendar view
/settings                   (Protected) - Settings
/public/share/:slug         (Public) - Shared resource
```

### Auth Context
**Location:** `web/src/features/auth/AuthContext.tsx`

**useAuth Hook**
```typescript
const {
  user: User | null;
  loading: boolean;
  login: (email, password, rememberMe?) => Promise<void>;
  register: (email, password) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data) => Promise<void>;
} = useAuth();
```

### Session Management
- HTTP-only cookie for session
- **Standard:** 12-hour expiry
- **Remember Me:** 10-year expiry (persistent)
- Auto-refresh on mount
- Session check interval (5 minutes)
- Auto-logout on session expiry
- Persist user state in memory

### Auth Provider
**Features:**
- Fetches current user on mount
- Stores user in context
- Provides logout function
- Handles API errors
- Redirects on auth failure

### Device ID
- Generated on app start
- Stored in localStorage
- Sent with every API request
- Used for sync checkpoints

### API Client
**Location:** `web/src/lib/api.ts`

**Authenticated Request**
```typescript
async function apiRequest<T>(
  endpoint: string,
  options?: RequestOptions
): Promise<T> {
  // Adds CSRF token
  // Includes device ID
  // Handles auth errors
  // Returns typed response
}
```

**Error Handling**
- 401: Redirect to login
- 403: Show error toast
- 429: Rate limit warning
- 500: Server error toast

### Navigation Guards
**AuthGuard Component**
```typescript
function AuthGuard({ children }) {
  const location = useLocation();
  const { user } = useAuth();
  
  // Store intended destination
  if (!user) {
    return <Navigate to="/auth/login" state={{ from: location }} />;
  }
  
  return children;
}
```

**Redirect After Login**
```typescript
function Login() {
  const { user } = useAuth();
  const location = useLocation();
  const from = location.state?.from || '/';
  
  if (user) return <Navigate to={from} />;
  
  // Render login form
}
```

### CSRF Handling
- Fetch CSRF token on mount
- Include in all mutation requests
- Stored in memory
- Auto-refresh on expiry

### Service Worker Integration
- Sync in background
- Push notifications
- Offline fallback
- Cache-first strategy

## Related
- [components.md](components.md) - UI components
- [../backend/services/auth.md](../backend/services/auth.md) - Backend auth
- [../backend/middleware.md](../backend/middleware.md) - Auth middleware