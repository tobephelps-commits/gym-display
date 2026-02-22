# Roadmap: Gym Display System

## Overview

Build a Raspberry Pi 5-based gym display that rotates through three full-screen zones (WOD, video playlist, class roster) on a wall-mounted 1080p TV. Starting from project skeleton and config system, each phase adds one major capability, culminating in a deployment-ready system with auto-start, crash recovery, and off-hours TV control.

## Domain Expertise

None

## Milestones

- ✅ **v1.0 MVP** - Phases 1-5 (complete)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Express server, config loading, zone rotation engine with crossfade transitions
- [x] **Phase 2: WOD Display** - Puppeteer WodScreen automation, screenshot caching, WOD zone rendering
- [x] **Phase 3: Video System** - Video manager, URL parsing, iframe embedding, playlist advancement
- [x] **Phase 4: MindBody Integration** - API client, auth token management, roster UI, class-aware boost
- [x] **Phase 5: Deployment & Reliability** - systemd services, kiosk launcher, HDMI CEC (9pm–4:30am), RPi Connect, setup script

## Phase Details

### ✅ v1.0 MVP (Complete)

**Milestone Goal:** Deliver a fully functional gym display system with all three zones (WOD, video, roster) rotating reliably on a Raspberry Pi 5 with auto-start and crash recovery.

#### Phase 1: Foundation
**Goal**: Express server serving a frontend that rotates through three zone containers with CSS crossfade transitions, driven by a YAML config with hot-reload
**Depends on**: Nothing (first phase)
**Research**: Unlikely (standard Node.js/Express patterns, chokidar file watching)
**Plans**: TBD

Plans:
- [x] 01-01: Project scaffold, Express server, YAML config loading with chokidar hot-reload
- [x] 01-02: Frontend zone containers with crossfade, backend zone controller, rotation engine integration

#### Phase 2: WOD Display
**Goal**: Puppeteer-based WodScreen scraper that captures WOD screenshots on interval, served full-screen in the WOD zone with stale-data indicator
**Depends on**: Phase 1
**Research**: Likely (WodScreen login automation, page structure and selectors)
**Research topics**: WodScreen.com login flow, post-login navigation to workout display, correct CSS selectors for screenshot capture, Puppeteer on ARM64 considerations
**Plans**: TBD

Plans:
- [x] 02-01: Puppeteer WodScreen automation — login, navigate, screenshot capture
- [x] 02-02: WOD API endpoint, frontend zone integration, stale-data indicator

#### Phase 3: Video System
**Goal**: Video manager with YouTube/Vimeo URL parsing, playlist rotation, iframe embedding with autoplay, completion detection, and config hot-reload
**Depends on**: Phase 1
**Research**: Unlikely (YouTube/Vimeo iframe embed APIs are well-documented)
**Plans**: TBD

Plans:
- [x] 03-01: Video manager service — URL parsing, playlist state, hot-reload
- [x] 03-02: Video zone frontend — iframe embedding, autoplay, completion detection, playlist advancement

#### Phase 4: MindBody Integration
**Goal**: MindBody API client with auth token management, class schedule and roster fetching, roster zone UI, and class-aware rotation boosting
**Depends on**: Phase 1
**Research**: Likely (MindBody Public API v6, authentication flow, endpoint contracts)
**Research topics**: MindBody API v6 authentication (usertoken/issue), GET /class/classes response format, GET /class/classvisits response format, rate limits, sandbox environment setup
**Plans**: TBD

Plans:
- [x] 04-01: MindBody API client — authentication, token refresh, class and roster fetching
- [x] 04-02: Roster zone UI — class info display, athlete list, next-class preview
- [x] 04-03: Class-aware rotation boosting in zone controller

#### Phase 5: Deployment & Reliability
**Goal**: Production-ready deployment with systemd auto-start, Chromium kiosk launcher, HDMI CEC off-hours screen control (9pm–4:30am), Raspberry Pi Connect for remote management, setup script, and log rotation
**Depends on**: Phases 1-4
**Research**: Unlikely (systemd, HDMI CEC, Chromium kiosk — established Linux patterns; Raspberry Pi Connect docs are straightforward)
**Plans**: TBD

Plans:
- [x] 05-01: systemd service files, Chromium kiosk launcher script, production server binding
- [x] 05-02: HDMI CEC off-hours TV control (9pm off / 4:30am on) and log rotation
- [x] 05-03: Automated setup script (setup.sh) with RPi Connect for Raspberry Pi OS provisioning

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 2/2 | Complete | 2026-02-21 |
| 2. WOD Display | v1.0 | 2/2 | Complete | 2026-02-22 |
| 3. Video System | v1.0 | 2/2 | Complete | 2026-02-21 |
| 4. MindBody Integration | v1.0 | 3/3 | Complete | 2026-02-21 |
| 5. Deployment & Reliability | v1.0 | 3/3 | Complete | 2026-02-22 |
