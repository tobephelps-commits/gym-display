# Plan 03-02 Summary: Instagram Reels Integration

**Phase:** 03-video-system
**Plan:** 02
**Status:** Complete
**Date:** 2026-02-21

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create reels-fetcher service with API endpoints | `60a94aa` | services/reels-fetcher.js, server.js, config.yaml |
| 2 | Implement Reels player and YouTube-to-Reels transition | `409b852` | public/index.html, public/app.js, public/styles.css, server.js |

## What Was Built

### Reels Fetcher Service (`services/reels-fetcher.js`)
- Instagram Graph API v21.0 client fetches video media from user's feed
- Downloads .mp4 files to `cache/reels/` directory with deduplication (skip existing files)
- Automatic pruning of old reels not in current API response
- Token refresh logic: tracks token age, attempts refresh every 30 days (before 60-day expiry)
- Refreshed token stored in memory only (avoids config hot-reload loop), logged for manual persistence
- Config hot-reload: listens for config changes, enables/disables dynamically
- Graceful disabled mode: all methods return safe defaults when no credentials configured
- Singleton pattern matching existing codebase conventions

### API Endpoints (server.js)
- `GET /api/reels` -- returns enabled status, reels list, and fetch status
- `GET /api/reels/files/:filename` -- serves .mp4 files with Content-Type video/mp4 and Accept-Ranges
- Path traversal prevention: filename validated against `/^[a-zA-Z0-9_-]+\.mp4$/`
- `/api/config` updated to include sanitized instagram settings (enabled, min_display_seconds only)

### Two-Phase Video Zone (public/app.js)
- Phase 1: YouTube playlist plays with audio (existing behavior from Plan 01)
- Phase 2: When YouTube exhausts, transitions to muted Reels loop
- Fetches both `/api/videos` and `/api/reels` in parallel on zone activation
- Four content combinations handled:
  - YouTube+Reels: YouTube first, then Reels, then zone advance
  - YouTube-only: YouTube plays, then zone advance (Plan 01 behavior)
  - Reels-only: Reels play immediately when video zone activates
  - Neither: "No videos configured" fallback with timer-based zone advance
- `min_display_seconds` timer ensures Reels play for minimum duration before zone advance
- Reels advance on `ended` event only after min display time reached
- Safety timeout from Plan 01 (`fallback_seconds`) still applies as maximum cap

### Reels Player (public/index.html, public/styles.css)
- `<video>` element with muted autoplay playsinline attributes
- `object-fit: cover` fills 16:9 screen, cropping vertical Reels content from sides
- Play promise rejection handled gracefully (tries next reel)
- Pause and cleanup on zone deactivation

### Config Updates (config.yaml)
- Added `instagram` section: enabled, access_token, user_id, max_reels, fetch_interval_minutes, min_display_seconds
- Disabled by default with empty credentials

## Decisions Made

- Token refresh stores new token in memory only (writing back to config.yaml would trigger hot-reload loop)
- Reels use `object-fit: cover` since vertical video needs to fill horizontal display
- min_display_seconds defaults to 30 if not set
- Reels zone advance happens on `ended` event (natural video end) after min time, not mid-playback
- HTTP GET for Graph API uses Node built-in https module (no extra dependencies)
- Download follows redirects (Instagram media URLs may redirect)

## Verification Notes

- Reels fetcher loads in disabled mode without errors when no credentials configured
- `/api/reels` returns `{ enabled: false, reels: [], status: {...} }` when disabled
- `/api/config` includes instagram section with no credential exposure
- All services load together without errors
- Frontend syntax validated (no parse errors)
