# Plan 17-01 Summary: LiveEventService + Server Integration

## Result: COMPLETE

**Tasks:** 2/2 completed
**Commits:** 2

## What Was Done

### Task 1: Create LiveEventService
- Created `services/live-event-service.js` following AnnouncementsService pattern
- Polls Google Sheets "LiveEvent" tab every 60 seconds
- Filters enabled events (TRUE/yes/1), parses Start/End dates with timezone awareness
- Finds first active event where `now >= start && now < end`
- Extracts YouTube video IDs from watch, youtu.be, live, embed, and v URL formats
- Exposes `getActiveEvent()`, `isActive()`, `getStatus()` for consumers
- Exported as singleton factory: `module.exports.create(sheetsClient, configLoader)`

### Task 2: Integrate with ZoneController, Server, Config
- **ZoneController:** Added `setLiveEventService()` late-binding method. `getZoneState()` now checks for active live event at the top and returns `currentZone: 'live-event'` with `durationMs: 0` (no auto-advance) and `liveEvent` object containing title, videoId, url, endsAt
- **Server routes:** Added `GET /api/live-event` (public), `POST /api/admin/refresh/live-event` (admin), added `liveEvent` to `GET /api/admin/status` response
- **Server lifecycle:** LiveEventService starts after Sheets polling, wired to ZoneController via `setLiveEventService()`, stopped in graceful shutdown
- **Config loader:** Added `'live-event'` to `VALID_ZONE_NAMES` array
- **Config example:** Added LiveEvent tab documentation in `config.example.yaml`

## Commits

| Hash | Message |
|------|---------|
| a07c6c3 | feat(17): create LiveEventService with Sheets polling and active event detection |
| 88f76f4 | feat(17): integrate LiveEventService with ZoneController, server routes, and config |

## Files Modified

- `services/live-event-service.js` (new)
- `services/zone-controller.js`
- `services/config-loader.js`
- `server.js`
- `config.example.yaml`

## Decisions

- **Timezone parsing:** Uses `Intl.DateTimeFormat` with iterative offset correction for "YYYY-MM-DD HH:MM" format dates, falling back to local system time if timezone unavailable
- **YouTube ID regex:** Extended video-manager pattern to also support `youtube.com/live/` URLs for live streams
- **No auto-advance:** Live event zone returns `durationMs: 0` so the frontend stays on the live event until it ends naturally
- **First-match wins:** When multiple events are active simultaneously, the first matching row from the sheet is used
