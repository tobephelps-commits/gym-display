# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** The five-zone rotation (WOD, video, roster, leaderboard, announcements) must cycle reliably and continuously without crashes, stalls, or manual intervention
**Current focus:** v1.5 Live Events — YouTube Live takeover for competition events

## Current Position

Milestone: v1.5 Live Events
Phase: 17 of 17 (Live Event Override)
Plan: Not started
Status: Ready to plan
Last activity: 2026-02-26 — Milestone v1.5 created

Progress: ░░░░░░░░░░ 0%

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
# Kiosk auto-restarts via restart loop, or:
pkill -9 chromium  # restart loop will relaunch it
```

### Service Architecture on Pi

- **gym-display.service** — Node.js server (systemd, auto-restart)
- **labwc autostart** — Launches Chromium kiosk with restart loop (`~/.config/labwc/autostart`)
- **LightDM** — Desktop autologin → labwc Wayland session
- **rpi-connect** — User service (screen sharing + remote shell)
- **tailscaled** — System service (SSH access from dev machine)
- **gym-cec-off.timer** — TV standby at 21:00 (with retry logic)
- **gym-cec-on.timer** — TV power on at 04:30 (with retry logic)
- **gym-nightly-reboot.timer** — Pi reboot at 03:30 daily

### Kiosk Launch (manual, from SSH)

```bash
WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 nohup /home/BigBarn/gym-display/scripts/start-kiosk.sh > /tmp/kiosk.log 2>&1 &
```

## Instagram Reels

- **Primary method:** yt-dlp downloads from Sheets "Playlist" tab URLs (Phase 07)
- **Fallback:** instaloader profile scraping when Sheets not configured
- **Account:** @bigbarncrossfit (public, no login required for instaloader fallback)
- **Cache:** ~/gym-display/cache/reels/*.mp4 (10 reels cached)
- **Filename:** MD5 hash of URL (stable, prevents re-downloads)
- **yt-dlp:** Installed on Pi (v2026.02.21)

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full list with outcomes.

### Pending Todos

- [ ] Activate MindBody API key for site ID 24936 in MindBody developer portal
- [ ] Configure Pushover and Gmail credentials in config.yaml on Pi

### Blockers/Concerns Carried Forward

None

### Roadmap Evolution

- v1.0 MVP shipped: Three-zone rotation system, 5 phases (Phase 1-5)
- v1.1 Command Center shipped: Google Sheets hub + new zones + admin panel, 5 phases (Phase 6-10)
- v1.2 Go Live shipped: Production deployment, reliability improvements, 1 phase (Phase 11)
- v1.3 Resilience shipped: Zone health monitoring, graceful degradation, alerting, admin dashboard, 4 phases (Phase 12-15)
- v1.4 Video Scheduling shipped: Day-of-week scheduling, video focus mode, frontend watchdog, operational polish, 1 phase (Phase 16)
- Milestone v1.5 created: Live event override, 1 phase (Phase 17)

## Session Continuity

Last session: 2026-02-26
Stopped at: Milestone v1.5 initialization
Resume file: None
