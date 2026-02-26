# Plan 17-02 Summary: Frontend Live Event Zone + Admin Status

## Result: COMPLETE

**Tasks:** 2/2 completed
**Commits:** 2

## What Was Done

### Task 1: Frontend live-event zone with rotation override
- Added `zone-live-event` div to `public/index.html` with overlay and YouTube container
- Added CSS in `public/styles.css` for fullscreen live event zone, gradient overlay, and fade-out transition
- Added `enterLiveEventMode()` function to app.js: stops rotation timer, hides all zones, shows live event zone, creates YouTube player for the live stream, shows title overlay that fades after 10 seconds
- Added `exitLiveEventMode()` function: destroys player, hides live event zone, resumes normal rotation from current position
- Added `destroyLiveEventPlayer()` helper for clean player teardown
- Modified `pollZoneState()` to detect `currentZone === 'live-event'` from server and trigger enter/exit
- Added early return guard in `advanceZone()` to prevent rotation during live event
- Added live-event deactivation handler in `showZone()` transition logic

### Task 2: Admin panel event status and Sheets Instructions
- Added Live Event card to admin dashboard grid with badge states: LIVE NOW (red pulse), Scheduled (yellow), No Event (gray)
- Added badge CSS with pulse animation to `admin.css`
- Added live event status rendering in Dashboard `updateServiceCards()` — reads `data.liveEvent` from `/api/admin/status` response
- Added "Refresh Live Event" button calling `POST /api/admin/refresh/live-event`
- Added LiveEvent tab documentation to `INSTRUCTIONS_CONTENT` in `sheets-client.js` covering all columns (Title, URL, Start, End, Enabled) with behavior notes
- Updated tab names reference in General Notes to include "LiveEvent"

## Commits

| Hash | Message |
|------|---------|
| bbbd980 | feat(17): add frontend live-event zone with rotation override |
| d21f4a7 | feat(17): add admin live event status card and Sheets Instructions docs |

## Files Modified

- `public/index.html` — added zone-live-event div
- `public/app.js` — live event state, enter/exit/destroy functions, poll detection, advance guard
- `public/styles.css` — live event zone and overlay CSS
- `public/admin/index.html` — live event dashboard card + status rendering JS
- `public/admin/admin.css` — badge styles with pulse animation
- `services/sheets-client.js` — LiveEvent tab documentation in Instructions content

## Decisions

- **No hidden class on live-event zone:** Uses the same `.zone` base class which defaults to opacity:0; the `.active` class controls visibility via CSS crossfade, consistent with all other zones
- **Overlay fade timeout:** 10 seconds chosen to give viewers time to read the event title without being distracting during a long live stream
- **No YT onStateChange handler:** Live streams don't end via player state; the server controls when the event window is over
- **Badge states from server data:** Uses `data.liveEvent.active` + `data.liveEvent.eventCount` to determine LIVE NOW / Scheduled / No Event, matching the server's status response structure from Plan 17-01
