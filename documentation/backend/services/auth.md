# Authentication Service

**Status:** ✅ Implemented | Email/password + Device tracking

## Overview
Handles user registration, login, password hashing, device management. Session-less JWT or cookie-based auth.

## Key Details

### Password Hashing
- Algorithm: argon2id (memoryCost 2^16, timeCost 3, parallelism 1)
- Policy: 8-128 chars (register, change-password)
- Location: `server/src/utils/passwords.js`

### Device Tracking
- Device ID from header: `X-Device-Id`
- Auto-registration on auth
- Tracks: name, last_seen

### Endpoints

**Register**
```
POST /auth/register
Body: { email, password, displayName?, avatarData? }
Response: { user }
Headers: X-Device-Id (optional)
```

**Login**
```
POST /auth/login
Body: { email, password, rememberMe? }
Response: { user }
Headers: X-Device-Id (optional), Set-Cookie (session)
Note: rememberMe=true sets token expiry to 10 years
```

**Logout**
```
POST /auth/logout
Response: { success }
Headers: Clear-Cookie
```

**Get Current User**
```
GET /auth/me
Response: { user }
Auth: Required
```

**Change Password**
```
POST /auth/change-password
Body: { currentPassword (1-128), newPassword (8-128) }
Response: { ok: true }
Auth: Bearer (requireAuth) → shares login rate limiter (failures only)
Errors: 401 invalid_credentials (wrong current) | 400 invalid_body | 401 missing_token | 429 too_many_attempts
Note: existing JWTs/devices stay valid (no session revocation)
```

### Profile (`/profile`, all Bearer auth)

```
GET    /profile          → Profile
PUT    /profile          Body: { displayName?, avatarIcon?, avatarColor?, avatar? } → Profile
POST   /profile/avatar   multipart field "avatar" (png|jpeg|webp, ≤2MB) → Profile
DELETE /profile/avatar   → Profile (avatar null)
GET    /profile/avatar   → 302 to avatar url (404 if none)
```

**Profile**
```
{ id, email, createdAt, displayName|null,
  avatarIcon|null, avatarColor|null,
  avatar: null | { url, mimeType, updatedAt } }
```
- `avatarIcon` (≤48, Lucide name) / `avatarColor` (≤32): omitted = unchanged; `""` or `null` = clear
- Photo `avatar.url` = `{API}/files/profiles/{userId}/avatar.jpg` (absolute, from `publicUrl`), served by `/files/*` with NO auth header (unguessable userId in path); file is always stored as `.jpg` regardless of mime; `Cache-Control: immutable` on a fixed key, so re-uploads may show stale images until cache clears
- Invalid icon/color length → 400 `invalid_body`; bad photo type → 400 `invalid_avatar_type`
- Tests: `server/tests/account.test.js`, `server/tests/profile.test.js`

### Auth Middleware

**requireAuth**
- Validates session/cookie
- Attaches `req.user` and `req.deviceId`
- Returns 401 if invalid
- Location: `server/src/middleware/auth.js`

### Session Management
- HTTP-only cookies in production
- SameSite: 'none' (production), 'lax' (dev)
- Secure: true (production)
- Cookie name: session

### Device Model
```typescript
{
  id: string;
  user_id: string;
  name: string;  // Auto-generated or provided
  last_seen: number;  // Unix timestamp
}
```

### User Model
```typescript
{
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  notification_preferences: {
    taskReminders: boolean;
    taskDueDates: boolean;
    taskAssigned: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  };
  created_at: number;
}
```

### Security
- Rate limiting: 1000 req/15min
- CSRF protection on state-changing routes
- Helmet.js headers
- CORS configured
- Password validation (min 8 chars)

## Related
- [database.md](../database.md) - Users table
- [middleware.md](../middleware.md) - Auth guards
- [services/notifications.md](notifications.md) - Push notifications