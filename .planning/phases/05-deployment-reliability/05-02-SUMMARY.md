---
phase: 05-deployment-reliability
plan: 02
subsystem: infra
tags: [hdmi-cec, systemd, logrotate, raspberry-pi, timers]

requires:
  - phase: 05-deployment-reliability/01
    provides: systemd service files for gym-display
provides:
  - HDMI CEC TV on/off control script
  - Systemd timers for overnight TV standby (21:00 off, 04:30 on)
  - Logrotate configuration for file-based logs
  - Journald size limit documentation for setup.sh
affects: [05-deployment-reliability/03]

tech-stack:
  added: [cec-utils, cec-client]
  patterns: [systemd-timers, logrotate]

key-files:
  created:
    - scripts/hdmi-cec.sh
    - scripts/gym-cec-off.service
    - scripts/gym-cec-off.timer
    - scripts/gym-cec-on.service
    - scripts/gym-cec-on.timer
    - scripts/gym-display.logrotate
  modified: []

key-decisions:
  - "cec-client -s -d 1 flags for stdin mode with minimal debug output"
  - "Persistent=true on timers ensures missed triggers fire on next boot"
  - "Logrotate for file-based logs; journald limits documented for setup.sh"

patterns-established:
  - "Systemd timer pairs: .service + .timer for scheduled tasks"
  - "Journald size limits (100M/7day) documented as setup.sh responsibility"

duration: 3min
completed: 2026-02-22
---

# Plan 05-02: HDMI CEC Off-Hours Control & Log Rotation Summary

**HDMI CEC TV standby/wake timers (21:00 off, 04:30 on) and logrotate config for SD card longevity**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22
- **Completed:** 2026-02-22
- **Tasks:** 2
- **Files created:** 6

## Accomplishments
- CEC control script sends standby/wake commands to TV via cec-client
- Systemd timers schedule TV off at 21:00 and on at 04:30 daily
- Logrotate config with daily rotation, 7-day retention, and compression
- Journald size limits documented for setup.sh integration

## Task Commits

Each task was committed atomically:

1. **Task 1: Create HDMI CEC control script and systemd timers** - `370a489` (feat)
2. **Task 2: Create logrotate configuration** - `2e36ccf` (feat)

## Files Created/Modified
- `scripts/hdmi-cec.sh` - CEC control script (on/off commands via cec-client)
- `scripts/gym-cec-off.service` - Systemd service to turn TV off
- `scripts/gym-cec-off.timer` - Timer triggering TV off at 21:00
- `scripts/gym-cec-on.service` - Systemd service to turn TV on
- `scripts/gym-cec-on.timer` - Timer triggering TV on at 04:30
- `scripts/gym-display.logrotate` - Logrotate config for file-based logs

## Decisions Made
- Used `cec-client -s -d 1` flags (stdin mode, minimal debug) for reliable CEC commands
- Set `Persistent=true` on timers so missed triggers execute on next boot
- Logrotate handles file-based logs; journald limits documented for setup.sh to configure

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CEC timers and logrotate ready for installation by setup.sh (Plan 05-03)
- setup.sh will need to: enable timers, install logrotate config, configure journald limits

---
*Phase: 05-deployment-reliability*
*Completed: 2026-02-22*
