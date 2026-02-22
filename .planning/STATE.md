# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** The three-zone rotation (WOD, video, roster) must cycle reliably and continuously without crashes, stalls, or manual intervention
**Current focus:** v1.0 MVP — UAT Fix Pass

## Current Position

Milestone: v1.0 MVP
Phase: 02-wod-display (UAT fix)
Plan: 02-FIX (fix UAT-001)
Status: Plan complete — UAT-001 fixed
Last activity: 2026-02-22 — Completed 02-FIX (WOD authorization popup fix)

Progress: ██████████ 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 13
- Average duration: ~3 min
- Total execution time: ~0.6 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 2 | ~10 min | ~5 min |
| 02-wod-display | 3 | ~9 min | ~3 min |
| 03-video-system | 2 | ~6 min | ~3 min |
| 04-mindbody-integration | 3 | ~11 min | ~3.5 min |
| 05-deployment-reliability | 3 | ~8 min | ~2.7 min |

**Recent Trend:**
- Last 5 plans: 05-01, 05-02, 05-03, 02-FIX
- Trend: Steady

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Server binds 127.0.0.1 in production, 0.0.0.0 in dev (implemented in 05-01)
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
- MindBody init is best-effort (same pattern as WodScraper) — server runs without credentials
- MindBody placeholder credential detection skips polling gracefully
- Display names use "First L." format with ClientId deduplication
- MindBody token cached 6 days, cleared on 401 for automatic refresh
- Roster frontend polls every 10s (backend caches at 60s); stale data preferred over error state
- Athlete grid density: >15 compact (2.2rem), >25 dense (1.8rem), default 2.8rem
- Boost order: server drives effective rotation order; frontend reads it passively (no client-side boost logic)
- 30s boost check interval balances responsiveness with minimal overhead
- Boost check only runs when MindBody is configured
- cec-client -s -d 1 for reliable HDMI CEC commands (stdin mode, minimal debug)
- Persistent=true on systemd timers ensures missed triggers fire on boot
- Logrotate for file logs; journald limits (100M/7day) handled by setup.sh
- SUDO_USER detection in setup.sh for non-pi username support
- setup.sh sed-replaces /home/pi and User=pi in systemd units at install time
- Missing app directory is a warning in setup.sh (can run before git clone)
- Iframe is "bonus" display mode; screenshot is the reliable WOD path
- Gym auth detection uses text content matching (defensive, not exact selectors)
- Screenshot refresh runs as backup even when iframe is active

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 02-FIX — Fixed UAT-001 WOD authorization popup (4 root causes)
Resume file: .planning/phases/02-wod-display/02-FIX-SUMMARY.md

### Roadmap Evolution

- Milestone v1.0 MVP created: Full gym display system, 5 phases (Phase 1-5)
