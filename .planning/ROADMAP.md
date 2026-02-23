# Roadmap: Gym Display System

## Overview

Build a Raspberry Pi 5-based gym display that rotates through three full-screen zones (WOD, video playlist, class roster) on a wall-mounted 1080p TV. Starting from project skeleton and config system, each phase adds one major capability, culminating in a deployment-ready system with auto-start, crash recovery, and off-hours TV control.

## Domain Expertise

None

## Milestones

- ✅ [v1.0 MVP](milestones/v1.0-ROADMAP.md) (Phases 1-5) — SHIPPED 2026-02-23
- 🚧 **v1.1 Command Center** — Phases 6-10 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 MVP (Phases 1-5) — SHIPPED 2026-02-23</summary>

- [x] Phase 1: Foundation (2/2 plans) — completed 2026-02-21
- [x] Phase 2: WOD Display (2/2 plans + 1 fix) — completed 2026-02-22
- [x] Phase 3: Video System (2/2 plans) — completed 2026-02-21
- [x] Phase 4: MindBody Integration (3/3 plans) — completed 2026-02-21
- [x] Phase 5: Deployment & Reliability (3/3 plans) — completed 2026-02-22

See [milestone archive](milestones/v1.0-ROADMAP.md) for full phase details.

</details>

### 🚧 v1.1 Command Center (In Progress)

**Milestone Goal:** Google Sheets as central data hub, two new rotation zones (leaderboard + announcements), web admin panel, and Instagram fix

#### Phase 6: Google Sheets Foundation

**Goal**: Set up Google Sheets API auth (service account), build API client, establish single Sheet with multiple tabs pattern
**Depends on**: Previous milestone complete
**Research**: Likely (Google Sheets API, service account auth setup)
**Research topics**: Google Sheets API v4, service account credentials, Node.js googleapis client library
**Plans**: TBD

Plans:
- [ ] 06-01: TBD (run /gsd:plan-phase 6 to break down)

#### Phase 7: Playlist Sync + Instagram Fix

**Goal**: Replace config.yaml video playlist with Google Sheets tab; fix Instagram rate-limiting so reels refresh automatically on Pi
**Depends on**: Phase 6
**Research**: Likely (Instagram rate-limit workarounds, instaloader alternatives)
**Research topics**: Instagram rate limiting bypass/alternatives, instaloader session handling, proxy options
**Plans**: TBD

Plans:
- [ ] 07-01: TBD (run /gsd:plan-phase 7 to break down)

#### Phase 8: Team vs Team Leaderboard Zone

**Goal**: New rotation screen showing competing teams with individual member points; coaches enter points manually in Google Sheets tab; display reads and renders team competition view
**Depends on**: Phase 6
**Research**: Unlikely (internal patterns, Sheets integration established in Phase 6)
**Plans**: TBD

Plans:
- [ ] 08-01: TBD (run /gsd:plan-phase 8 to break down)

#### Phase 9: Announcements Zone

**Goal**: New rotation screen that appears in rotation when announcements exist in Sheets tab; disappears from rotation when no active announcements
**Depends on**: Phase 6
**Research**: Unlikely (internal patterns, similar to Phase 8)
**Plans**: TBD

Plans:
- [ ] 09-01: TBD (run /gsd:plan-phase 9 to break down)

#### Phase 10: Web Admin Panel

**Goal**: Browser-based UI to manage config, playlists, settings, and view system status without SSH access to the Pi
**Depends on**: Phase 7, Phase 8, Phase 9
**Research**: Likely (web framework choice for admin UI, serving alongside kiosk)
**Research topics**: Lightweight admin UI framework for Node.js, serving admin alongside existing Express server
**Plans**: TBD

Plans:
- [ ] 10-01: TBD (run /gsd:plan-phase 10 to break down)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 2/2 | Complete | 2026-02-21 |
| 2. WOD Display | v1.0 | 2/2 + fix | Complete | 2026-02-22 |
| 3. Video System | v1.0 | 2/2 | Complete | 2026-02-21 |
| 4. MindBody Integration | v1.0 | 3/3 | Complete | 2026-02-21 |
| 5. Deployment & Reliability | v1.0 | 3/3 | Complete | 2026-02-22 |
| 6. Google Sheets Foundation | v1.1 | 0/? | Not started | - |
| 7. Playlist Sync + Instagram Fix | v1.1 | 0/? | Not started | - |
| 8. Team vs Team Leaderboard | v1.1 | 0/? | Not started | - |
| 9. Announcements Zone | v1.1 | 0/? | Not started | - |
| 10. Web Admin Panel | v1.1 | 0/? | Not started | - |
