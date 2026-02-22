---
phase: 05-deployment-reliability
plan: 03
subsystem: infra
tags: [setup-script, provisioning, raspberry-pi, rpi-connect, idempotent]

requires:
  - phase: 05-deployment-reliability/01
    provides: systemd service files (gym-display, gym-kiosk)
  - phase: 05-deployment-reliability/02
    provides: CEC timers, logrotate config, journald docs
provides:
  - Single-command Pi provisioning script
  - RPi Connect remote management
  - Full kiosk autostart chain (autologin -> X11 -> kiosk)
affects: []

tech-stack:
  added: [rpi-connect-lite, nodesource]
  patterns: [idempotent-provisioning, sed-path-replacement]

key-files:
  created:
    - scripts/setup.sh
  modified: []

key-decisions:
  - "SUDO_USER detection for non-pi username support"
  - "sed replaces /home/pi and User=pi in all systemd units at install time"
  - "Script is idempotent: mkdir -p, grep before append, command checks"
  - "App dir missing is a warning not an error (script can run before clone)"

patterns-established:
  - "Single provisioning entry point for entire system"
  - "Graceful handling of missing app directory during setup"

duration: 2min
completed: 2026-02-22
---

# Plan 05-03: Comprehensive Setup Script Summary

**Single-command provisioning script for fresh Raspberry Pi OS Lite installations**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22
- **Completed:** 2026-02-22
- **Tasks:** 1
- **Files created:** 1

## Accomplishments
- Created scripts/setup.sh covering all 15 provisioning steps
- System updates, Node.js 20 LTS, Chromium kiosk, CEC utils
- Console autologin and X11 kiosk autostart chain
- All systemd services and timers installed with username substitution
- Journald log limits (100M/7day) and logrotate config
- RPi Connect (rpi-connect-lite) for remote management
- config.yaml secured with chmod 600
- Script is fully idempotent and supports non-pi usernames

## Task Commits

Each task was committed atomically:

1. **Task 1: Create comprehensive setup.sh provisioning script** - `c7ad3f1` (feat)

## Files Created/Modified
- `scripts/setup.sh` - Full Pi provisioning script (293 lines)

## Decisions Made
- SUDO_USER detection allows any username, not just "pi"
- sed replaces both path (/home/pi) and user (User=pi) in systemd units
- Missing app directory is a warning (setup can run before git clone)
- Node.js version check skips reinstall if v20 already present

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
After running `sudo bash setup.sh`:
1. Edit config.yaml with MindBody/WOD credentials
2. Run `rpi-connect signin` to link RPi Connect
3. Reboot to start the display system

## Verification
- [x] scripts/setup.sh exists with #!/bin/bash and set -e
- [x] Root privilege check present
- [x] SUDO_USER detection for non-pi usernames
- [x] All packages installed: nodejs, chromium-browser, cec-utils, unclutter, rpi-connect-lite
- [x] All systemd units from 05-01 and 05-02 copied and enabled
- [x] RPi Connect installed and enabled
- [x] config.yaml permissions secured (chmod 600)
- [x] Script is idempotent (safe to re-run)
- [x] Post-setup instructions printed

---
*Phase: 05-deployment-reliability*
*Completed: 2026-02-22*
