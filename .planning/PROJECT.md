# Gym Display System

## What This Is

A Raspberry Pi 5-based gym display system for a CrossFit box. It drives a wall-mounted 1080p TV, rotating through five full-screen content zones: today's WOD, a curated playlist of YouTube videos and Instagram Reels, a live class roster from MindBody, a team vs team leaderboard, and gym announcements. Content is managed via Google Sheets as a central data hub, with a web admin panel for configuration and monitoring. Headless, auto-starting, crash-recovering, and configurable via browser or SSH.

## Core Value

The five-zone rotation (WOD, video, roster, leaderboard, announcements) must cycle reliably and continuously without crashes, stalls, or manual intervention — this is a set-it-and-forget-it gym display.

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
- ✓ Google Sheets API foundation with service account auth and multi-tab polling — v1.1
- ✓ Sheets-driven YouTube playlist sync with config.yaml fallback — v1.1
- ✓ Instagram reels via yt-dlp from Sheets URLs, replacing rate-limited instaloader — v1.1
- ✓ Team vs Team leaderboard zone with color-coded cards and rankings — v1.1
- ✓ Announcements zone with urgent/normal priority and auto-skip — v1.1
- ✓ Web admin panel with live dashboard, settings editor, config backup/restore — v1.1

### Active

- [ ] MindBody API key activation for site 24936 (external dependency — roster zone blocked)

### Out of Scope

- Multi-display support — future enhancement, single TV only
- Weather widget — future enhancement
- Athlete individual PR tracking — future enhancement (leaderboard is team-based)
- Admin panel user management / multi-user auth — single-token is sufficient for local Pi

## Context

Shipped v1.2 with ~6,498 LOC (JS: 4,644 / HTML: 676 / CSS: 1,178).
Tech stack: Node.js + Express backend, vanilla HTML/CSS/JS frontend, Puppeteer for WodScreen, YouTube IFrame API, yt-dlp for Instagram Reels, Google Sheets API v4 for data hub, MindBody Public API v6 for roster.
Five rotation zones: WOD, video, roster, leaderboard, announcements.
Web admin panel at /admin for configuration and monitoring.
Deployed on Raspberry Pi 5 running Raspberry Pi OS (Bookworm) with Wayland/labwc compositor.
Remote access via Tailscale SSH. Deploy workflow: git push from Windows, git pull on Pi via SSH.
Nightly reboot at 3:30 AM, CEC TV off at 9 PM / on at 4:30 AM. Kiosk auto-restarts on Chromium crash.

Known issues:
- MindBody API key not activated for site 24936 — roster zone non-functional until activated in MindBody developer portal

## Constraints

- **Tech stack**: Node.js + Express + vanilla frontend — per design document spec
- **Display**: Single 1080p TV via HDMI — no multi-display
- **Platform**: Must run on Raspberry Pi 5 with ARM64 Chromium and Wayland/labwc
- **Network**: WiFi only — must handle intermittent connectivity gracefully with cached data
- **Config**: YAML file editable via SSH or web admin panel at /admin
- **Security**: Express binds localhost only, config.yaml chmod 600, admin panel token-gated (open by default on local Pi)
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
| instaloader for Instagram Reels | No API key needed, scrapes public profiles; rate-limited from Pi IP though | Replaced v1.1 |
| Tailscale for Pi SSH access | Pi on different network than dev machine; Tailscale provides persistent SSH | Good |
| YouTube API loaded async | Synchronous script tag blocks page init if YouTube unreachable | Good |
| Google Sheets as data hub | Coaches can manage content without SSH; single spreadsheet, multiple tabs | Good |
| credentials_file path for Sheets | Avoids YAML newline escaping issues with inline private key | Good |
| yt-dlp replacing instaloader | Downloads from explicit URLs instead of scraping; eliminates rate-limit issues | Good |
| Sheets-first with config fallback | Playlist and reels try Sheets first, fall back to config.yaml gracefully | Good |
| Hardcoded team colors | Green/Blue/Red matches gym branding; simple, no config needed | Good |
| Admin open access by default | No auth when admin_token not configured; appropriate for local-only Pi | Good |
| Per-section admin saves | Each settings card saves independently; avoids accidental cross-section changes | Good |
| Config backup on save | Automatic one-level backup (config.yaml.bak); simple rollback without complexity | Good |
| Defer MindBody roster | API key lacks site 24936 access; external dependency, not a code issue | Pending |
| Nightly Pi reboot | Chromium network service crashed overnight causing blank screen; 3:30 AM reboot prevents stale state | Good |
| Kiosk restart loop | Replace single `exec` with while loop; auto-recovers from Chromium crashes | Good |

---
*Last updated: 2026-02-24 after v1.2 milestone*
