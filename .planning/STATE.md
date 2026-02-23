# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** The three-zone rotation (WOD, video, roster) must cycle reliably and continuously without crashes, stalls, or manual intervention
**Current focus:** Monitoring & polish

## Current Position

Milestone: v1.0 MVP
Phase: Complete — all zones working
Status: Deployed and running on Pi. WOD, video (1-per-rotation), reels, and roster skip all working.
Last activity: 2026-02-23 — Fixed video rendering, rotation, reels, and WOD

Progress: ██████████ 100%

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

## Resolved: Video Rotation & Rendering

**Problems fixed (2026-02-23):**

1. **Back-to-back videos** — YouTube iframe stayed active at opacity:0 between zone visits, autoplaying related videos and firing stale PLAYING/ENDED postMessage events.
   - **Fix:** Destroy YouTube player (`ytPlayer.destroy()`) on zone deactivation, create fresh `YT.Player` on each zone activation. No persistent iframe = no stale events.

2. **White/grey video box** — YouTube iframe rendered as white rectangle with audio working. Caused by Chromium GPU compositing bug on Raspberry Pi with Wayland.
   - **Fix:** Added `--disable-gpu-compositing` flag to kiosk Chromium launch script.

3. **Roster zone not skipping** — Roster displayed even when MindBody API not configured.
   - **Fix:** `onRosterZoneActive()` checks `mindbodyConfigured` flag and calls `setTimeout(advanceZone, 0)` to skip.

4. **Changes not reaching Pi** — Code was edited locally on Windows but not deployed via git push/pull workflow.
   - **Lesson:** Always use deploy workflow: `git push` → `ssh` → `git pull` → restart service.

## Instagram Reels

- **Method:** instaloader (Python CLI tool, no API key needed)
- **Account:** @bigbarncrossfit (public, no login required)
- **Cache:** ~/gym-display/cache/reels/*.mp4 (10 reels cached)
- **Issue on Pi:** Instagram rate-limiting from Pi's IP (instaloader fails)
- **Workaround:** Reels pre-cached from Windows via `scp` to Pi; Pi retries hourly but will likely fail
- **To refresh:** Run instaloader on Windows, then `scp cache/reels/*.mp4 BigBarn@100.120.21.22:~/gym-display/cache/reels/`

## Performance Metrics

**Velocity:**
- Total plans completed: 13
- Average duration: ~3 min
- Total execution time: ~0.6 hours

## Accumulated Context

### Decisions

Recent decisions (2026-02-23):

- Wayland/labwc REQUIRED (not X11) — RPi Connect screen sharing needs Wayland
- Tailscale for SSH access to Pi from dev machine (Pi on different network)
- instaloader for Instagram Reels (no API key, scrapes public profiles)
- config.yaml gitignored, config.example.yaml committed (credential protection)
- Static files served with Cache-Control: no-store (prevents stale JS)
- Puppeteer headless needs --ozone-platform=headless on Wayland systems
- Chromium kiosk needs --password-store=basic to skip GNOME Keyring prompt
- Chromium kiosk needs --disable-gpu-compositing for YouTube iframe rendering on Pi
- LightDM autologin via /etc/lightdm/lightdm.conf.d/50-autologin.conf
- labwc autostart at ~/.config/labwc/autostart (NOT systemd gym-kiosk.service)
- Destroy/recreate YouTube player each zone visit (not persistent iframe)
- YouTube API script loaded async to avoid blocking page init

Prior decisions: see .planning/PROJECT.md Key Decisions table

### Pending Todos

- [x] Fix video single-item-per-rotation — resolved via destroy/recreate player
- [x] Fix white/grey video rendering — resolved via --disable-gpu-compositing
- [ ] Investigate Instagram rate limiting on Pi (workaround: scp from Windows)

### Blockers/Concerns

- Instagram instaloader blocked from Pi's IP — must refresh reels from Windows manually

## Session Continuity

Last session: 2026-02-23
Stopped at: All zones working — WOD, video (1-per-rotation), reels, roster skip
Resume with: System is running. Monitor for stability. Refresh reels from Windows periodically.
