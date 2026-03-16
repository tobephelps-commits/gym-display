# Plan 18-01 Summary: BriefExtractor Service

## Result: COMPLETE

**Tasks:** 2/2
**Date:** 2026-03-16

## Commits

| Hash | Message | Files |
|------|---------|-------|
| c04cb89 | feat(18-01): Create BriefExtractor service | services/brief-extractor.js |
| 183f598 | feat(18-01): Integrate BriefExtractor into server and WOD scrape cycle | server.js, services/wod-scraper.js, config.example.yaml |

## What Was Built

### BriefExtractor Service (`services/brief-extractor.js`)
- Extracts daily workout brief YouTube video from BTWB workout page
- Uses WodScraper's existing Puppeteer browser and BTWB cookies (no separate login)
- Three extraction strategies: iframe src, link href, regex HTML scan
- Writes to Sheets Playlist tab using `[Daily Brief]` sentinel row pattern
- Normalizes YouTube embed/short URLs to standard watch URLs
- Auto-disables stale brief rows (>24h) when no video found (rest days)
- Factory export pattern: `create(wodScraper, sheetsClient)`
- Fully non-fatal: all errors logged at WARN, never thrown

### Server Integration
- `GET /api/brief/status` — public status endpoint
- `POST /api/brief/refresh` — admin-protected manual trigger
- Brief status included in `GET /api/admin/status` aggregate
- `brief` case added to `POST /api/admin/refresh/:service` switch
- Post-scrape hook registered: runs after each WOD scrape cycle

### WodScraper Hook System
- `_postScrapeCallbacks` array + `onPostScrape(callback)` method
- Callbacks run after successful screenshot + HTML capture in session loop
- Each callback wrapped in try/catch (non-fatal)

### Config (`config.example.yaml`)
- `wodscreen.brief_enabled` — toggle extraction on/off
- `wodscreen.brief_url` — configurable BTWB page URL
- `wodscreen.brief_focus` — whether brief plays in focus rotation slot

## Decisions

- **Sentinel row pattern**: Uses `[Daily Brief]` as title to find/update the Playlist row, preventing duplicates
- **Post-scrape hook**: Rather than running on a separate timer, brief extraction hooks into WodScraper's existing session loop for natural timing alignment
- **Non-fatal throughout**: Brief extraction failures never disrupt the WOD scrape cycle or server operation

## Verification

- [x] `services/brief-extractor.js` exists with extractAndInject(), getStatus(), Sheets write-back
- [x] Module exports `create` factory function
- [x] No syntax errors (node require checks pass)
- [x] server.js creates briefExtractor and registers post-scrape hook
- [x] `/api/brief/status` and `/api/brief/refresh` endpoints exist
- [x] wod-scraper.js supports onPostScrape callbacks
- [x] config.example.yaml documents brief_enabled, brief_url, brief_focus
- [x] Server starts without errors
