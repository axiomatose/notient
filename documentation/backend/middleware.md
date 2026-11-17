# Middleware

**Status:** ✅ Implemented | Auth (JWT Bearer), Rate limiting, CORS

## Overview
Express middleware for authentication, security headers, rate limiting, request logging.

## Key Details

### Auth Middleware
**Location:** `server/src/middleware/auth.js`

**requireAuth**
```typescript
createAuthMiddleware({ config, repos })
```
- Requires `Authorization: Bearer <JWT>` header (12h expiry)
- Verifies JWT (issuer `notient-api`, audience `notient-clients`)
- Looks up user + device; device must belong to user
- Attaches `req.auth = { user, device, userId, deviceId }`
- Returns 401 on missing/invalid token, unknown user or device

**Note:** Auth is header-based only (no cookie sessions), so there is no CSRF protection — removed along with `/auth/csrf-token` and the `csurf`/`cookie-parser` deps (see [../exact-migration.md](../exact-migration.md)).

### Rate Limiting
**Location:** `server/src/server.js`

**API Limiter**
```
Window: 15 minutes
Max: 1000 requests per IP (`API_RATE_MAX`; the app's test server sets 100000, a test run exceeds 1000)
Skip: /health endpoint
```

**Sync Limiter**
```
Window: 1 minute
Max: 10 requests per IP
Applies to: /sync/* routes
```

### CORS
**Configuration:**
```typescript
origin: (origin) => config.corsOrigins.includes(origin)
credentials: true
methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
allowedHeaders: Content-Type, Authorization, X-Requested-With, 
                X-Device-Id, X-CSRF-Token, X-XSRF-Token
```

### Helmet.js
**CSP Directives:**
```typescript
defaultSrc: ['self']
scriptSrc: ['self', 'unsafe-inline', 'unsafe-eval']
styleSrc: ['self', 'unsafe-inline']
imgSrc: ['self', 'data:', 'https:']
connectSrc: ['self', VITE_API_URL]
fontSrc: ['self', 'data:']
objectSrc: ['none']
mediaSrc: ['self']
frameSrc: ['none']
```

### HTTP Logging
**Pino-HTTP Configuration:**
```typescript
level: config.logLevel
genReqId: Random UUID or from header
customLogLevel: error (500+), warn (400+), info (default)
customProps: env
```

### Compression
- Middleware: `compression()`
- Gzips all responses
- Configured for web performance

### Error Handling
**HTTP Errors:**
```typescript
isHttpError(err) → true/false
Response: { error: err.code, message: err.message }
Status: err.status
```

**Unhandled Errors:**
- Logs error with Pino
- Returns 500 status
- Returns `{ error: "internal_error" }`

### Device ID Header
- Header name: `X-Device-Id` (case-insensitive)
- Used for sync checkpoints
- Auto-generated if not provided
- Tracked in `devices` table

### Request ID
- Header: `X-Request-Id` or `X-RequestId`
- Auto-generated if not provided
- Set as response header
- Used for request tracing in logs

## Related
- [services/auth.md](services/auth.md) - Authentication
- [services/sync.md](services/sync.md) - Device tracking
- [database.md](database.md) - Users, devices tables