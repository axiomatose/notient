# Sync Service

**Status:** ✅ Implemented | Conflict-free merge with vector clocks

## Overview
Multi-device synchronization using version-based conflict resolution. Supports incremental pulls and pushes.

## Key Details

### Sync Protocol

**Pull (Get Changes)**
```
GET /sync/pull?checkpoint=<timestamp>
Response: {
  notes: [...],
  task_lists: [...],
  tasks: [...],
  task_sections: [...],
  calendars: [...],
  calendar_events: [...],
  checkpoint: <new_timestamp>
}
Auth: Required
```

**Push (Send Changes)**
```
POST /sync/push
Body: {
  notes: [...],
  task_lists: [...],
  tasks: [...],
  task_sections: [...],
  calendars: [...],
  calendar_events: [...],
  device_checkpoint: <timestamp>
}
Response: {
  success: true,
  checkpoint: <new_timestamp>,
  conflicts: [...]  // If any
}
Auth: Required
```

### Version Tracking
- Each record has `version` integer
- Increment on every update
- Server version > client version = conflict
- Server wins on conflicts (client receives server state)

### Conflict Resolution
- Server-side version comparison
- Last-write-wins based on `updated_at`
- Returns conflict details in response
- Client re-fetches after conflict

### Checkpoints
- Device-specific last pull timestamp
- Stored in `checkpoints` table
- Filters records where `updated_at > checkpoint`
- Reset on full sync

### Pull Filters
- Only records owned by user
- Include shared records where user is recipient
- Respect `deleted_at` (soft deletes)
- Include records with `updated_at > checkpoint`

### Push Validation
- Verify ownership of all records
- Validate `version` matches expected
- Reject foreign record modifications
- Increment version on server

### Rate Limiting
- Sync: 10 requests/minute
- Separate from API rate limiter

### Offline Support
- Client stores records in IndexedDB
- Queues changes while offline
- Auto-sync on reconnect
- Background sync via Service Worker

## Sync Flow
1. Client sends device ID in header
2. Server creates/retrieves device record
3. Client pulls changes since last checkpoint
4. Client merges with local state
5. Client pushes local changes
6. Server validates, applies, returns conflicts
7. Client resolves conflicts, re-pulls if needed

## Related
- [database.md](../database.md) - Version columns, checkpoints table
- [services/auth.md](auth.md) - Device tracking
- [middleware.md](../middleware.md) - Device ID handling