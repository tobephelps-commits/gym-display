# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** The three-zone rotation (WOD, video, roster) must cycle reliably and continuously without crashes, stalls, or manual intervention
**Current focus:** v1.1 Command Center — Google Sheets hub, new zones, admin panel

## Current Position

Milestone: v1.1 Command Center
Phase: 9 of 10 (Announcements Zone)
Plan: 1 of 2 in current phase
Status: Plan 01 complete — backend service, API, zone-controller integration done; frontend next
Last activity: 2026-02-23 — Completed 09-01-PLAN.md

Progress: █████░░░░░ 50%

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

- **Sheets credentials_file path** (Phase 06): Use file path to JSON key instead of inline private key to avoid YAML newline escaping issues
- **Sheets initial poll delay** (Phase 06): 5-second delay on first poll to avoid Google API cold-start quota spike
- **Reels source priority** (Phase 07): Sheets Playlist tab via yt-dlp first, instaloader fallback when Sheets not configured
- **Reel filename hashing** (Phase 07): MD5(url).slice(0,12) for stable filenames across fetch cycles
- **Leaderboard refresh interval** (Phase 08): 60-second refresh from Sheets, consistent with other Sheets services
- **Hardcoded team colors** (Phase 08): Green #38a169, Blue #3182ce, Red #e53e3e — matches CONTEXT.md
- **Announcements refresh interval** (Phase 09): 60-second refresh from Sheets, consistent with other Sheets services
- **Announcements priority sort** (Phase 09): Two-tier sort — urgent first, then normal

### Pending Todos

- [x] ~~Investigate Instagram rate limiting on Pi~~ — Fixed in Phase 07: Sheets URLs + yt-dlp replaces instaloader scraping
- [ ] Install yt-dlp on Pi: `pip3 install yt-dlp`
- [ ] Replace MindBody sandbox credentials with production API key

### Blockers/Concerns Carried Forward

- yt-dlp needs to be installed on Pi before Sheets-based reel downloading works
- Google Sheets setup (Phase 06 user task) still pending — needed for Sheets-based features

### Roadmap Evolution

- v1.0 MVP shipped: Three-zone rotation system, 5 phases (Phase 1-5)
- Milestone v1.1 created: Google Sheets hub + new zones + admin panel, 5 phases (Phase 6-10)

## Session Continuity

Last session: 2026-02-23
Stopped at: Completed 09-01-PLAN.md — Announcements backend done, ready for 09-02 frontend
Resume file: .planning/phases/09-announcements-zone/09-01-SUMMARY.md
