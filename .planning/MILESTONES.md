# Project Milestones: Gym Display System

## v1.0 MVP (Shipped: 2026-02-23)

**Delivered:** A fully functional Raspberry Pi 5 gym display system rotating through three zones (WOD, YouTube/Reels video, class roster) on a wall-mounted 1080p TV with auto-start, crash recovery, and off-hours TV control.

**Phases completed:** 1-5 (12 plans + 1 fix)

**Key accomplishments:**

- Three-zone rotation engine with CSS crossfade transitions and YAML config hot-reload
- WodScreen/BTWB live iframe integration with Puppeteer auth automation and reverse proxy
- YouTube video playback with destroy/recreate player pattern (one per rotation) and Instagram Reels fallback
- MindBody API integration with roster display, class detection, and rotation boost logic
- Full Raspberry Pi deployment: systemd services, Chromium kiosk, HDMI CEC TV control, setup script
- Chromium GPU compositing fix (`--disable-gpu-compositing`) for YouTube iframe rendering on Pi/Wayland

**Stats:**

- 62 files created/modified
- 2,907 lines of code (JS/HTML/CSS)
- 5 phases, 12 plans, 1 fix
- 3 days from start to ship (Feb 21 - Feb 23, 2026)

**Git range:** `b0877ec` → `d031557`

**What's next:** Monitor stability, consider web admin panel, Google Sheets playlist sync, or announcements overlay for v1.1.

---
