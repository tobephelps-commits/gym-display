# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** The three-zone rotation (WOD, video, roster) must cycle reliably and continuously without crashes, stalls, or manual intervention
**Current focus:** v1.1 Command Center — Google Sheets hub, new zones, admin panel

## Current Position

Milestone: v1.1 Command Center
Phase: 6 of 10 (Google Sheets Foundation)
Plan: 01 complete
Status: Plan 01 done — SheetsClient service + API endpoints built. User setup needed (Google Cloud service account + credentials).
Last activity: 2026-02-23 — Phase 06 Plan 01 complete

Progress: █░░░░░░░░░ 10%

## Deployment Info

### Raspberry Pi Access

- **Tailscale SSH:** `ssh BigBarn@100.120.21.22`
- **Pi hostname:** bigbarnpi
- **Pi user:** BigBarn
- **Pi home:** /home/BigBarn
- **App dir:** /home/BigBarn/gym-display
- **Display:** Wayland/labwc (NOT X11 — RPi Connect requires Wayland)
- **RPi Connect:** Installed and working for screen sharing

### Tailscale Network

- **Pi:** 100.120.21.22 (bigbarnpi)
- **Windows dev machine:** 100.77.68.99 (desktop-4uqhvr6)
- **Tailscale SSH** is enabled on the Pi (`--ssh` flag)
- `tailscaled` is enabled as a system service (persists across reboots)

### GitHub Repo

- **URL:** https://github.com/tobephelps-commits/gym-display
- **Visibility:** Public (credentials removed from history via filter-branch)
- **config.yaml** is gitignored — credentials stay local on Pi only
- **config.example.yaml** is the template (committed)

### Deploy Workflow

```bash
# From Windows dev machine:
git push origin master

# Then on Pi (via Tailscale SSH):
ssh BigBarn@100.120.21.22
cd ~/gym-display && git pull origin master
sudo systemctl restart gym-display
# Kiosk auto-restarts via labwc autostart, or:
pkill -9 chromium  # labwc autostart will relaunch it
```

### Service Architecture on Pi

- **gym-display.service** — Node.js server (systemd, auto-restart)
- **labwc autostart** — Launches Chromium kiosk (`~/.config/labwc/autostart`)
- **LightDM** — Desktop autologin → labwc Wayland session
- **rpi-connect** — User service (screen sharing + remote shell)
- **tailscaled** — System service (SSH access from dev machine)
- **gym-cec-off.timer / gym-cec-on.timer** — TV power control (21:00 off, 04:30 on)

### Kiosk Launch (manual, from SSH)

```bash
WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 nohup /home/BigBarn/gym-display/scripts/start-kiosk.sh > /tmp/kiosk.log 2>&1 &
```

## Instagram Reels

- **Method:** instaloader (Python CLI tool, no API key needed)
- **Account:** @bigbarncrossfit (public, no login required)
- **Cache:** ~/gym-display/cache/reels/*.mp4 (10 reels cached)
- **Issue on Pi:** Instagram rate-limiting from Pi's IP (instaloader fails)
- **To refresh:** Run instaloader on Windows, then `scp cache/reels/*.mp4 BigBarn@100.120.21.22:~/gym-display/cache/reels/`

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full list with outcomes.

- **Sheets credentials_file path** (Phase 06): Use file path to JSON key instead of inline private key to avoid YAML newline escaping issues
- **Sheets initial poll delay** (Phase 06): 5-second delay on first poll to avoid Google API cold-start quota spike

### Pending Todos

- [ ] Investigate Instagram rate limiting on Pi (workaround: scp from Windows)
- [ ] Replace MindBody sandbox credentials with production API key

### Blockers/Concerns Carried Forward

None (Instagram fix planned for Phase 7)

### Roadmap Evolution

- v1.0 MVP shipped: Three-zone rotation system, 5 phases (Phase 1-5)
- Milestone v1.1 created: Google Sheets hub + new zones + admin panel, 5 phases (Phase 6-10)

## Session Continuity

Last session: 2026-02-23
Stopped at: Phase 06 Plan 01 complete — next is user setup (Google Cloud service account) then Plan 02
Resume file: .planning/phases/06-google-sheets-foundation/06-01-SUMMARY.md
