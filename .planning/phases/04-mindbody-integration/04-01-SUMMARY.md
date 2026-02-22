# Plan 04-01 Summary: MindBody API Client & Endpoints

**Phase:** 04-mindbody-integration
**Plan:** 01
**Status:** COMPLETE
**Duration:** ~5 min

## What Was Done

### Task 1: Install axios and create MindBody API client service
- Installed axios dependency
- Created `services/mindbody.js` — singleton MindBodyClient class
- Token management with 6-day cache and automatic refresh
- `apiGet()` wrapper with 401 handling (clears token for retry)
- `pollSchedule()` — fetches today's classes, filters cancelled
- `getActiveClass()` — timezone-aware current class detection
- `pollActiveRoster()` — fetches class visits, filters signed-in, deduplicates by ClientId, formats "First L." display names
- `startPolling()` — two-tier: schedule every N minutes, roster every 60s
- Skips polling gracefully when placeholder credentials detected
- Defensive error handling throughout (logs warnings, never crashes)

### Task 2: Add roster and schedule API endpoints
- `GET /api/roster` — returns classInfo, athletes[], count, lastUpdated
- `GET /api/schedule` — returns simplified classes[] with count
- `GET /api/mindbody/status` — returns configured, polling, poll timestamps, activeClass
- MindBody polling initialized on server start (best-effort pattern)
- Added `mindbody.configured` boolean to `/api/config` sanitized response

## Files Modified
- `package.json` — added axios dependency
- `services/mindbody.js` — new file, MindBody API client singleton
- `server.js` — new endpoints and MindBody initialization

## Commits
- `9b3af27`: Add MindBody API client service with auth and two-tier polling
- `e2f29a0`: Add roster, schedule, and MindBody status API endpoints

## Decisions
- MindBody init is synchronous (just starts timers) — no async needed in server startup
- Placeholder credential detection: api_key === 'your_api_key' skips polling
- Display names use "First L." format with fallback to DisplayName
- Deduplication by ClientId handles known MindBody duplicate visit records
- Token refresh on 401 clears cached token so next call re-authenticates

## Verification
- [x] `npm start` runs without errors
- [x] `/api/roster` returns valid JSON with classInfo, athletes, count, lastUpdated
- [x] `/api/schedule` returns valid JSON with classes array
- [x] `/api/mindbody/status` returns valid JSON with configured field
- [x] `/api/config` includes mindbody.configured field
- [x] Existing endpoints (health, zones, videos, wod) unaffected
