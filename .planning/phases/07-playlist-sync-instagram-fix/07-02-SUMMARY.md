# Plan 07-02 Summary: Instagram Fix via yt-dlp + Sheets

## Result: SUCCESS

**Phase:** 07-playlist-sync-instagram-fix
**Plan:** 02
**Date:** 2026-02-23
**Tasks:** 2/2 completed

## What Was Done

### Task 1: Add yt-dlp download capability for Sheets playlist URLs
- Added `crypto` and `sheets-client` imports to ReelsFetcher
- Added `_isYouTubeUrl(url)` helper to filter out YouTube URLs (handled by VideoManager)
- Added `_isEnabledRow(row)` helper for case-insensitive enabled check ("TRUE", "true", "yes", "1")
- Added `_getReelUrlsFromSheets()` — reads Sheets "Playlist" tab, returns null when Sheets not configured (fallback signal), or array of `{url, title}` for non-YouTube enabled URLs
- Added `_generateFilename(url)` — stable MD5-based filename (12-char hex) to prevent re-downloads
- Added `_downloadWithYtDlp(url, outputFilename)` — shells out to yt-dlp with 120s timeout, graceful ENOENT handling with one-time warning
- Added `_runSheetsDownload()` — downloads new URLs, prunes stale reels removed from Sheets via `_urlFileMap` tracking
- Modified `runFetchCycle()` — tries Sheets first (`_getReelUrlsFromSheets()`), falls back to `_runInstaloader()` when Sheets returns null
- Added `getSource()` returning 'sheets' or 'instaloader'
- Added `_source` and `_ytDlpAvailable` and `_urlFileMap` instance properties

### Task 2: Update reels API response and verify integration
- Updated `getStatus()` to include `source` and `ytDlpAvailable` fields
- Added `_checkYtDlpAvailability()` in constructor — runs `yt-dlp --version` with 5s timeout at startup
- Verified `/api/reels` endpoint automatically returns enriched status (no server.js changes needed)
- Verified `_scanCachedReels()` works unchanged — scans .mp4 files regardless of download source
- Verified periodic `_startFetchCycle()` triggers new Sheets-or-instaloader flow

## Commits

| Hash | Message |
|------|---------|
| `6ff5ebf` | feat(reels): add yt-dlp download from Sheets playlist URLs |

## Files Modified

- `services/reels-fetcher.js` — added Sheets-based yt-dlp download, fallback to instaloader, enriched status

## Verification

- [x] `node -e "require('./services/reels-fetcher')"` loads without error
- [x] Server boots cleanly without Sheets configured
- [x] getStatus() returns source: 'instaloader' when Sheets not configured
- [x] getStatus() includes ytDlpAvailable field
- [x] Existing 10 cached reels still found and served
- [x] No new warnings or errors in startup (yt-dlp check is graceful)
- [x] Instaloader fallback path unchanged

## Decisions

- Combined Task 1 and Task 2 into a single commit since all changes are in the same file and logically coupled
- yt-dlp availability check is async/non-blocking in constructor — does not delay server startup
- Stale reel pruning uses URL-to-filename Map for tracking; only prunes files that were previously downloaded via Sheets (does not interfere with instaloader-downloaded files)
- YouTube URLs filtered out at the Sheets parsing level since VideoManager handles those separately

## Next Steps

- When Google Sheets is configured (Phase 06 user setup), coaches can add Instagram reel URLs to the Playlist tab
- Reels will be downloaded via yt-dlp instead of instaloader profile scraping, eliminating rate-limit issues
- yt-dlp must be installed on the Pi: `pip3 install yt-dlp`
