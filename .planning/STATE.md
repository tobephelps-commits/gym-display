# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** The three-zone rotation (WOD, video, roster) must cycle reliably and continuously without crashes, stalls, or manual intervention
**Current focus:** v1.0 MVP — Phase 3 Video System

## Current Position

Milestone: v1.0 MVP
Phase: 3 of 5 (Video System)
Plan: 2 of 2 in current phase
Status: Plan complete
Last activity: 2026-02-21 — Completed 03-02-PLAN.md

Progress: ██████░░░░ 60%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: ~3 min
- Total execution time: ~0.3 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2 | ~10 min | ~5 min |
| 02-wod-display | 2 | ~4 min | ~2 min |
| 03-video-system | 2 | ~6 min | ~3 min |

**Recent Trend:**
- Last 5 plans: 02-01, 02-02, 03-01, 03-02
- Trend: Steady

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Server binds to 0.0.0.0 for dev (will lock to 127.0.0.1 in deployment phase)
- Frontend uses 30s polling for config updates (simpler than WebSocket for config changes)
- Zone controller is singleton — single source of truth for rotation state
- puppeteer-core (not puppeteer) for ARM64 Pi compatibility
- WodScraper init is best-effort — server runs even if WodScreen fails
- Daily 4 AM re-login to ensure fresh WOD
- 10s iframe load timeout before screenshot fallback
- Pause WOD screenshot refreshes when zone not active
- YouTube player uses autoplay:0 with manual loadVideoById for reliable playback control
- play_full mode lets video completion drive zone transitions; fallback_seconds is safety net
- Video manager is defensive against null config (handles pre-loadConfig state)
- signalVideoZoneComplete syncs local rotation state with server to prevent drift
- Token refresh stores new token in memory only (writing to config.yaml would trigger hot-reload loop)
- Reels use object-fit:cover (vertical video fills horizontal display by cropping sides)
- Reels zone advance on video ended event after min_display_seconds, not mid-playback

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 03-02-PLAN.md — Instagram Reels integration with two-phase video zone
Resume file: .planning/phases/03-video-system/03-02-SUMMARY.md

### Roadmap Evolution

- Milestone v1.0 MVP created: Full gym display system, 5 phases (Phase 1-5)
