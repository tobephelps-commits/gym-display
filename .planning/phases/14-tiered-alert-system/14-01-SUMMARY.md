---
phase: 14-tiered-alert-system
plan: 01
subsystem: alerting
tags: [pushover, nodemailer, gmail, alerts, deduplication, cooldowns, flapping]

# Dependency graph
requires:
  - phase: 12-zone-health-monitor
    provides: Zone health state tracking and status transitions
  - phase: 13-graceful-degradation
    provides: Health-aware zone rotation with skip logic
provides:
  - NotificationService for Pushover push and Gmail email delivery
  - AlertManager with tiering, dedup, cooldowns, batching, flapping detection
affects: [15-admin-error-dashboard, 14-02]

# Tech tracking
tech-stack:
  added: [pushover-notifications, nodemailer]
  patterns: [alert-fingerprinting, cooldown-periods, warning-batching, flapping-detection]

key-files:
  created: [services/notification-service.js, services/alert-manager.js]
  modified: [package.json, package-lock.json]

key-decisions:
  - "Gmail SMTP via nodemailer instead of Resend — no custom domain needed for personal gym project"
  - "In-memory alert state with no persistence — Pi reboots nightly, fresh alert on reboot is acceptable"
  - "30s batch window for warnings to prevent email storms"

patterns-established:
  - "Alert fingerprinting: SHA256 hash of zone+status+error category for dedup"
  - "Cooldown pattern: Map<fingerprint, timestamp> with severity-based cooldown durations"
  - "Recovery threshold: 2+ consecutive healthy checks before sending all-clear"

# Metrics
duration: 2min
completed: 2026-02-24
---

# Phase 14 Plan 01: Core Alert Services Summary

**NotificationService (Pushover + Gmail email) and AlertManager (tiering, dedup, cooldowns, batching, flapping detection) ready for integration**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-24T18:50:11Z
- **Completed:** 2026-02-24T18:52:34Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- NotificationService with Pushover (priority 0-2 including emergency retry/expire) and Gmail SMTP channels
- Both channels gracefully handle unconfigured state — log warning once and skip silently
- AlertManager with full alert intelligence: severity tiering, fingerprint dedup, cooldown periods, warning batching, flapping detection, recovery notifications
- Alert history (last 50) exposed for Phase 15 dashboard integration
- Factory functions following project convention (create pattern with dependency injection)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create NotificationService for Pushover and email delivery** - `570493c` (feat)
2. **Task 2: Create AlertManager with tiering, dedup, cooldowns, and batching** - `f418e5a` (feat)

## Files Created/Modified
- `services/notification-service.js` - Pushover push and Gmail email delivery with graceful unconfigured handling
- `services/alert-manager.js` - Alert intelligence layer: tiering, dedup, cooldowns, batching, flapping, recovery
- `package.json` - Added pushover-notifications and nodemailer dependencies
- `package-lock.json` - Dependency lock file updated

## Decisions Made
- Used Gmail SMTP via nodemailer instead of Resend — no custom domain needed for this personal gym project
- In-memory alert state without persistence — Pi reboots nightly at 03:30, a fresh alert for still-unhealthy zones on reboot is actually useful
- 30-second batch window for warning digests to prevent email storms
- Recovery threshold of 2 consecutive healthy checks before sending "all clear" to prevent premature recovery for flapping zones

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required. Pushover and email credentials will be added to config.yaml during integration (Plan 14-02).

## Next Phase Readiness
- Both services are standalone modules ready for integration into server.js and ZoneHealthMonitor
- Ready for 14-02-PLAN.md (integration plan)

---
*Phase: 14-tiered-alert-system*
*Completed: 2026-02-24*
