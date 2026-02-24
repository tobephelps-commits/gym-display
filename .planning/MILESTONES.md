# Project Milestones: Gym Display System

## v1.2 Go Live (Shipped: 2026-02-24)

**Delivered:** Production deployment with verified video/reels, leaderboard, announcements, and WOD zones on the gym TV, plus reliability improvements (kiosk auto-restart, nightly reboot, CEC retries).

**Phases completed:** 11 (1 plan total)

**Key accomplishments:**

- yt-dlp confirmed working on Pi for Instagram reel downloads from Sheets playlist
- MindBody production credentials configured (pending external API key activation)
- Two-column leaderboard layout for teams with many members
- Kiosk auto-restart loop prevents blank screen on Chromium crash
- Nightly Pi reboot at 3:30 AM clears stale state
- CEC TV on/off commands retry up to 3 times on failure

**Stats:**

- 9 files modified (+142 lines)
- 6,498 lines of code total (JS: 4,644 / HTML: 676 / CSS: 1,178)
- 1 phase, 1 plan, 4 tasks
- 2 days (Feb 23-24, 2026)

**Git range:** `96e990a` → `509f54b`

**What's next:** Activate MindBody API key for roster zone, then project is fully production-complete.

---

## v1.1 Command Center (Shipped: 2026-02-23)

**Delivered:** Google Sheets as central data hub powering two new rotation zones (team leaderboard and announcements), Sheets-driven playlist sync, Instagram reels fix via yt-dlp, and a web admin panel with live dashboard and settings editor.

**Phases completed:** 6-10 (10 plans total)

**Key accomplishments:**

- Google Sheets API foundation with service account auth, polling, and multi-tab data caching
- Sheets-driven YouTube playlist sync with automatic change detection, config.yaml fallback
- Instagram reels fix — yt-dlp downloads from Sheets URLs, eliminating rate-limit issues
- Team vs Team leaderboard zone with color-coded team cards, rankings, and member breakdowns
- Announcements zone with urgent/normal card styling, auto-skip when empty, priority sorting
- Web admin panel with live service health dashboard, settings editor, config backup/restore

**Stats:**

- 41 files created/modified (+7,010 lines)
- 6,398 lines of code total (JS: 4,559 / HTML: 671 / CSS: 1,168)
- 5 phases, 10 plans, ~20 tasks
- 1 day (Feb 23, 2026)

**Git range:** `a0159c9` → `be9165f`

**What's next:** Deploy to Pi, set up Google Sheets with service account, install yt-dlp, replace MindBody sandbox credentials with production API key.

---

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
