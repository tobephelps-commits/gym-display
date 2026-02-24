---
phase: 11-production-credentials-deployment
plan: 01
subsystem: infra
tags: [mindbody, yt-dlp, deployment, credentials, instagram]

# Dependency graph
requires:
  - phase: 10-web-admin-panel
    provides: Full application stack ready for production credentials
provides:
  - yt-dlp installed on Pi for Instagram reel downloads
  - Production config.yaml on Pi (MindBody pending API activation)
affects: []

# Tech tracking
tech-stack:
  added: [yt-dlp]
  patterns: []

key-files:
  created: []
  modified: [config.yaml (on Pi only, gitignored)]

key-decisions:
  - "Deferred MindBody activation — API key lacks access to site 24936, requires MindBody developer portal activation"
  - "yt-dlp was already installed on Pi — no action needed"

patterns-established: []

# Metrics
duration: ~20min
completed: 2026-02-23
---

# Phase 11: Production Credentials & Deployment Summary

**yt-dlp confirmed working with Instagram reels from Sheets playlist; MindBody deferred pending API key site activation**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-02-23
- **Completed:** 2026-02-23
- **Tasks:** 2/4 completed, 2 deferred (MindBody)
- **Files modified:** 0 code files (config.yaml on Pi only)

## Accomplishments
- Confirmed yt-dlp installed and working on Pi (version 2026.02.21)
- Instagram reels downloading and playing in video zone from Sheets playlist
- Diagnosed MindBody 403 error: API key not authorized for site ID 24936
- MindBody credentials entered in config.yaml, ready once API access is granted

## Task Commits

1. **Task 1: Update MindBody credentials** - N/A (human action on Pi, config.yaml gitignored)
2. **Task 2: Verify MindBody roster** - DEFERRED (API key lacks site access)
3. **Task 3: Install yt-dlp** - Already installed, no action needed
4. **Task 4: Verify video zone** - Confirmed working (reels playing)

## Files Created/Modified
- `config.yaml` (on Pi only, gitignored) - MindBody production credentials added

## Decisions Made
- Deferred MindBody roster zone: API key returns "You do not have access to siteId 24936" — requires activation in MindBody developer portal
- Skipped yt-dlp install task: already installed on Pi (version 2026.02.21)

## Deviations from Plan

### MindBody API Access Issue
- **Found during:** Task 2 (verify roster)
- **Issue:** MindBody API returns 403 "You do not have access to siteId 24936"
- **Resolution:** Deferred — user needs to activate API key for their site in MindBody developer portal
- **Impact:** Roster zone will not display until API access is granted

## Issues Encountered
- MindBody 403: API key not authorized for site 24936. This is an external service activation issue, not a code bug.

## User Setup Required

**MindBody API activation still needed:**
- Go to MindBody developer portal
- Ensure your API key has access to site ID 24936
- Or verify the correct site ID for your gym
- Once activated, restart gym-display service: `sudo systemctl restart gym-display`

## Next Phase Readiness
- Video zone fully production-ready (yt-dlp + Sheets playlist working)
- WOD zone working (wodscreen.com scraper)
- Announcements zone working (Sheets)
- Leaderboard zone working (Sheets)
- Roster zone blocked on MindBody API activation (external dependency)

---
*Phase: 11-production-credentials-deployment*
*Completed: 2026-02-23*
