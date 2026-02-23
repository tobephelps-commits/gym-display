# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** The five-zone rotation (WOD, video, roster, leaderboard, announcements) must cycle reliably and continuously without crashes, stalls, or manual intervention
**Current focus:** Planning next milestone

## Current Position

Milestone: v1.1 Command Center — SHIPPED 2026-02-23
Phase: Not started (next milestone not yet planned)
Plan: Not started
Status: Ready to plan next milestone
Last activity: 2026-02-23 — v1.1 milestone complete

Progress: ██████████ 100% (v1.0 + v1.1 shipped)

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

- **Primary method:** yt-dlp downloads from Sheets "Playlist" tab URLs (Phase 07)
- **Fallback:** instaloader profile scraping when Sheets not configured
- **Account:** @bigbarncrossfit (public, no login required for instaloader fallback)
- **Cache:** ~/gym-display/cache/reels/*.mp4 (10 reels cached)
- **Filename:** MD5 hash of URL (stable, prevents re-downloads)
- **yt-dlp install:** `pip3 install yt-dlp` on Pi (graceful degradation if missing)

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full list with outcomes.

### Pending Todos

- [ ] Install yt-dlp on Pi: `pip3 install yt-dlp`
- [ ] Replace MindBody sandbox credentials with production API key
- [ ] Set up Google Sheets service account and credentials file on Pi

### Blockers/Concerns Carried Forward

- yt-dlp needs to be installed on Pi before Sheets-based reel downloading works
- Google Sheets setup (service account, credentials file) still pending — needed for Sheets-based features

### Roadmap Evolution

- v1.0 MVP shipped: Three-zone rotation system, 5 phases (Phase 1-5)
- v1.1 Command Center shipped: Google Sheets hub + new zones + admin panel, 5 phases (Phase 6-10)

## Session Continuity

Last session: 2026-02-23
Stopped at: v1.1 milestone archived. All 10 phases (1-10) complete across two milestones.
Resume file: N/A — ready to plan next milestone
