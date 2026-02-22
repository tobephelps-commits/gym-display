# Plan 05-01 Summary: Systemd Services & Kiosk Launcher

## Result: COMPLETE

**Duration:** ~2 min
**Commits:** 2

## What Was Done

### Task 1: Systemd service files and production server binding
- Created `scripts/gym-display.service` — Node.js server service with `Restart=always`, `RestartSec=5`, journal logging, `NODE_ENV=production`
- Created `scripts/gym-kiosk.service` — Chromium kiosk service with dependency on gym-display, `DISPLAY=:0`, `RestartSec=10`
- Modified `server.js` to bind `127.0.0.1` in production (security) and `0.0.0.0` in development (network access)

### Task 2: Chromium kiosk launcher script
- Created `scripts/start-kiosk.sh` with:
  - Health check loop (30 retries, 2s interval) waiting for server at `/api/health`
  - X11 configuration: screensaver off, DPMS off, no blanking
  - Mouse cursor hidden via `unclutter`
  - `chromium-browser` launched with all required flags: `--kiosk`, `--autoplay-policy=no-user-gesture-required`, `--disable-gpu-compositing`, `--incognito`, etc.

## Files Modified
- `scripts/gym-display.service` (new)
- `scripts/gym-kiosk.service` (new)
- `scripts/start-kiosk.sh` (new)
- `server.js` (modified — production bind address)

## Decisions Made
- Server binds 127.0.0.1 in production to prevent network exposure on the Pi
- Kiosk script uses `exec` to replace the shell process with Chromium (clean process tree)
- Health check exits with error after max retries (systemd will restart the service)

## Verification
- [x] gym-display.service has [Unit], [Service] with Restart=always, [Install]
- [x] gym-kiosk.service has dependency on gym-display, DISPLAY=:0
- [x] start-kiosk.sh has health check loop, xset, unclutter, chromium-browser with --kiosk and --autoplay-policy
- [x] server.js binds 127.0.0.1 when NODE_ENV=production, 0.0.0.0 otherwise
