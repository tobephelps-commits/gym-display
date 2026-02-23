# Gym Display System

## What This Is

A Raspberry Pi 5-based gym display system for a CrossFit box. It drives a wall-mounted 1080p TV, rotating through three full-screen content zones on a timed schedule: today's WOD from WodScreen/Beyond The Whiteboard, a curated playlist of YouTube training videos with Instagram Reels fallback, and a live class roster from the MindBody gym management platform. Headless, auto-starting, crash-recovering, and SSH-configurable via YAML.

## Core Value

The three-zone rotation (WOD, video, roster) must cycle reliably and continuously without crashes, stalls, or manual intervention — this is a set-it-and-forget-it gym display.

## Requirements

### Validated

- Express server with YAML config loading and hot-reload (chokidar) — v1.0
- Frontend zone rotation engine with CSS crossfade transitions — v1.0
- WodScreen Puppeteer automation: login, navigate, live iframe with reverse proxy — v1.0
- WOD zone displaying live iframe full-screen with loading/error states — v1.0
- Video manager with YouTube URL parsing, playlist state, hot-reload — v1.0
- Video zone with YouTube IFrame API, destroy/recreate per rotation, one video per zone visit — v1.0
- Instagram Reels integration via instaloader with media queue cycling — v1.0
- MindBody API client: auth token management, class schedule fetching, roster fetching — v1.0
- Roster zone UI: class name, time, coach, athlete list, count, responsive density — v1.0
- Class-aware rotation boosting (increased roster frequency near class times) — v1.0
- Roster zone auto-skip when MindBody not configured or no class in session — v1.0
- HDMI CEC off-hours TV standby/wake control (9pm off, 4:30am on) — v1.0
- systemd service for auto-start and crash recovery — v1.0
- Chromium kiosk mode launcher with GPU compositing fix for Pi/Wayland — v1.0
- Automated setup script (setup.sh) for Raspberry Pi OS provisioning — v1.0
- Log rotation and SD card write minimization — v1.0

### Active

(None — v1.0 shipped, next milestone not yet planned)

### Out of Scope

- Web-based admin panel — future enhancement, SSH config is sufficient for v1
- Google Sheets playlist sync — future enhancement, YAML playlist works for v1
- Athlete leaderboard / PR display — future enhancement
- Announcements overlay / ticker — future enhancement
- Multi-display support — future enhancement, single TV only for v1
- Weather widget — future enhancement

## Context

Shipped v1.0 with 2,907 LOC (JS/HTML/CSS) across 62 files.
Tech stack: Node.js + Express backend, vanilla HTML/CSS/JS frontend, Puppeteer for WodScreen scraping, YouTube IFrame API for video, instaloader for Instagram Reels, MindBody Public API v6 for roster.
Deployed on Raspberry Pi 5 running Raspberry Pi OS (Bookworm) with Wayland/labwc compositor.
Remote access via Tailscale SSH. Deploy workflow: git push from Windows, git pull on Pi via SSH.

Known issues:
- Instagram instaloader blocked from Pi's IP (must refresh reels manually from Windows)
- MindBody using sandbox credentials (needs production API key for real roster data)

## Constraints

- **Tech stack**: Node.js + Express + vanilla frontend — per design document spec
- **Display**: Single 1080p TV via HDMI — no multi-display
- **Platform**: Must run on Raspberry Pi 5 with ARM64 Chromium and Wayland/labwc
- **Network**: WiFi only — must handle intermittent connectivity gracefully with cached data
- **Config**: Single YAML file, SSH-editable — no web UI for configuration
- **Security**: Express binds localhost only, config.yaml chmod 600, tokens in memory only
- **Chromium**: Requires `--disable-gpu-compositing` for YouTube iframe rendering on Pi

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Puppeteer live iframe for WodScreen | WodScreen requires JS rendering and auth; reverse proxy strips iframe-blocking headers | Good |
| YAML config over database | Single-file simplicity, SSH-editable, hot-reloadable for a single-Pi deployment | Good |
| Vanilla JS frontend over framework | Minimal dependencies, fast load, runs well on Pi hardware | Good |
| Build on PC, deploy to Pi | Faster development cycle, validate on real hardware at deployment | Good |
| Destroy/recreate YouTube player per zone visit | Persistent iframe causes stale postMessage events and autoplay; fresh player eliminates all issues | Good |
| --disable-gpu-compositing for kiosk | YouTube iframes render white on Pi GPU; software compositing fixes it | Good |
| Wayland/labwc over X11 | RPi Connect screen sharing requires Wayland compositor | Good |
| instaloader for Instagram Reels | No API key needed, scrapes public profiles; rate-limited from Pi IP though | Revisit |
| Tailscale for Pi SSH access | Pi on different network than dev machine; Tailscale provides persistent SSH | Good |
| YouTube API loaded async | Synchronous script tag blocks page init if YouTube unreachable | Good |

---
*Last updated: 2026-02-23 after v1.0 milestone*
