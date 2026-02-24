# Roadmap: Gym Display System

## Overview

Build a Raspberry Pi 5-based gym display that rotates through three full-screen zones (WOD, video playlist, class roster) on a wall-mounted 1080p TV. Starting from project skeleton and config system, each phase adds one major capability, culminating in a deployment-ready system with auto-start, crash recovery, and off-hours TV control.

## Domain Expertise

None

## Milestones

- ✅ [v1.0 MVP](milestones/v1.0-ROADMAP.md) (Phases 1-5) — SHIPPED 2026-02-23
- ✅ [v1.1 Command Center](milestones/v1.1-ROADMAP.md) (Phases 6-10) — SHIPPED 2026-02-23
- ✅ [v1.2 Go Live](milestones/v1.2-ROADMAP.md) (Phase 11) — SHIPPED 2026-02-24
- 🚧 **v1.3 Resilience** — Phases 12-15 (in progress)

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

<details>
<summary>v1.1 Command Center (Phases 6-10) — SHIPPED 2026-02-23</summary>

- [x] Phase 6: Google Sheets Foundation (1/1 plans) — completed 2026-02-23
- [x] Phase 7: Playlist Sync + Instagram Fix (2/2 plans) — completed 2026-02-23
- [x] Phase 8: Team vs Team Leaderboard (2/2 plans) — completed 2026-02-23
- [x] Phase 9: Announcements Zone (2/2 plans) — completed 2026-02-23
- [x] Phase 10: Web Admin Panel (3/3 plans) — completed 2026-02-23

See [milestone archive](milestones/v1.1-ROADMAP.md) for full phase details.

</details>

<details>
<summary>v1.2 Go Live (Phase 11) — SHIPPED 2026-02-24</summary>

- [x] Phase 11: Production Credentials & Deployment (1/1 plans, MindBody deferred) — completed 2026-02-23

See [milestone archive](milestones/v1.2-ROADMAP.md) for full phase details.

</details>

### 🚧 v1.3 Resilience (In Progress)

**Milestone Goal:** Comprehensive error handling, auto-recovery, and admin notification across all zones for unattended operation

#### Phase 12: Zone Health Monitor

**Goal**: Track health of each zone (WOD, video, leaderboard, announcements, roster), detect failures (stalls, API errors, load failures, playback errors), implement retry logic before marking a zone unhealthy
**Depends on**: Previous milestone complete
**Research**: Unlikely (internal patterns — monitoring existing zone code)
**Plans**: 1

Plans:
- [x] 12-01: Zone Health Monitor service + server integration — completed 2026-02-24

#### Phase 13: Graceful Degradation

**Goal**: Unhealthy zones get automatically skipped in rotation, re-added when they recover — rotation never stalls or shows broken content
**Depends on**: Phase 12
**Research**: Unlikely (internal patterns — modifying existing rotation logic)
**Plans**: 1

Plans:
- [x] 13-01: Health-aware zone rotation with skip logic — completed 2026-02-24

#### Phase 14: Tiered Alert System

**Goal**: SMS for critical failures (display completely down, all zones failed), email for warnings (single zone down, API errors, download failures). Configurable thresholds.
**Depends on**: Phase 13
**Research**: Likely (external services — email/SMS APIs, evaluate free/low-cost options)
**Research topics**: Free/low-cost email services (nodemailer with Gmail, SendGrid free tier), SMS options (Twilio free tier, Pushover as alternative), Node.js integration patterns
**Plans**: TBD

Plans:
- [ ] 14-01: TBD

#### Phase 15: Admin Error Dashboard

**Goal**: Error history log, current zone health status with uptime, alert delivery log — all visible on the existing web admin panel
**Depends on**: Phase 14
**Research**: Unlikely (internal patterns — extending existing Express.js admin panel)
**Plans**: TBD

Plans:
- [ ] 15-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 2/2 | Complete | 2026-02-21 |
| 2. WOD Display | v1.0 | 2/2 + fix | Complete | 2026-02-22 |
| 3. Video System | v1.0 | 2/2 | Complete | 2026-02-21 |
| 4. MindBody Integration | v1.0 | 3/3 | Complete | 2026-02-21 |
| 5. Deployment & Reliability | v1.0 | 3/3 | Complete | 2026-02-22 |
| 6. Google Sheets Foundation | v1.1 | 1/1 | Complete | 2026-02-23 |
| 7. Playlist Sync + Instagram Fix | v1.1 | 2/2 | Complete | 2026-02-23 |
| 8. Team vs Team Leaderboard | v1.1 | 2/2 | Complete | 2026-02-23 |
| 9. Announcements Zone | v1.1 | 2/2 | Complete | 2026-02-23 |
| 10. Web Admin Panel | v1.1 | 3/3 | Complete | 2026-02-23 |
| 11. Production Credentials & Deployment | v1.2 | 1/1 | Complete (MindBody deferred) | 2026-02-24 |
| 12. Zone Health Monitor | v1.3 | 1/1 | Complete | 2026-02-24 |
| 13. Graceful Degradation | v1.3 | 1/1 | Complete | 2026-02-24 |
| 14. Tiered Alert System | v1.3 | 0/? | Not started | - |
| 15. Admin Error Dashboard | v1.3 | 0/? | Not started | - |
