# Gym Display System

## What This Is

A Raspberry Pi 5-based gym display system for a CrossFit box. It drives a wall-mounted 1080p TV, rotating through three full-screen content zones on a timed schedule: today's WOD from WodScreen/Beyond The Whiteboard, a curated playlist of YouTube/Vimeo training videos, and a live class roster from the MindBody gym management platform. Headless, auto-starting, crash-recovering, and SSH-configurable via YAML.

## Core Value

The three-zone rotation (WOD, video, roster) must cycle reliably and continuously without crashes, stalls, or manual intervention — this is a set-it-and-forget-it gym display.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Express server with YAML config loading and hot-reload (chokidar)
- [ ] Frontend zone rotation engine with CSS crossfade transitions
- [ ] WodScreen Puppeteer automation: login, navigate, screenshot capture on interval
- [ ] WOD zone displaying cached screenshot full-screen with stale-data indicator
- [ ] Video manager with URL parsing (YouTube/Vimeo), playlist state, hot-reload
- [ ] Video zone with iframe embedding, autoplay, completion detection, playlist advancement
- [ ] MindBody API client: auth token management, class schedule fetching, roster fetching
- [ ] Roster zone UI: class name, time, coach, athlete list, count, next-class preview
- [ ] Class-aware rotation boosting (increased roster frequency near class times)
- [ ] HDMI CEC off-hours TV standby/wake control
- [ ] systemd service files for auto-start and crash recovery (gym-display + gym-kiosk)
- [ ] Chromium kiosk mode launcher script with all required flags
- [ ] Automated setup script (setup.sh) for Raspberry Pi OS Lite provisioning
- [ ] Log rotation and SD card write minimization

### Out of Scope

- Web-based admin panel — future enhancement, SSH config is sufficient for v1
- Google Sheets playlist sync — future enhancement, YAML playlist works for v1
- Athlete leaderboard / PR display — future enhancement
- Announcements overlay / ticker — future enhancement
- Multi-display support — future enhancement, single TV only for v1
- Weather widget — future enhancement

## Context

- **Design document:** `Design Document.md` in project root — comprehensive spec covering all architecture, components, config schema, and deployment details
- **Hardware target:** Raspberry Pi 5 (4GB+ RAM), HDMI to 1080p TV, WiFi connected
- **OS target:** Raspberry Pi OS Lite 64-bit (Bookworm)
- **Development approach:** Build and test on PC (Windows), deploy to Pi hardware
- **Credentials status:** WodScreen credentials available, MindBody sandbox API credentials available, video URLs to be configured at deployment
- **Tech stack (from design doc):** Node.js + Express backend, vanilla HTML/CSS/JS frontend, Puppeteer for WodScreen scraping, axios for MindBody API, Chromium kiosk mode for display

## Constraints

- **Tech stack**: Node.js + Express + vanilla frontend — per design document spec
- **Display**: Single 1080p TV via HDMI — no multi-display
- **Platform**: Must run on Raspberry Pi 5 with ARM64 Chromium (not bundled Puppeteer Chromium)
- **Network**: WiFi only — must handle intermittent connectivity gracefully with cached data
- **Config**: Single YAML file, SSH-editable — no web UI for configuration
- **Security**: Express binds localhost only, config.yaml chmod 600, tokens in memory only

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Puppeteer screenshot approach for WodScreen | WodScreen requires JS rendering and auth; no public API available | — Pending |
| YAML config over database | Single-file simplicity, SSH-editable, hot-reloadable for a single-Pi deployment | — Pending |
| Vanilla JS frontend over framework | Minimal dependencies, fast load, runs well on Pi hardware | — Pending |
| Build on PC, deploy to Pi | Faster development cycle, validate on real hardware at deployment | — Pending |

---
*Last updated: 2026-02-21 after initialization*
