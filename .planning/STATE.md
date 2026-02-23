# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** The three-zone rotation (WOD, video, roster) must cycle reliably and continuously without crashes, stalls, or manual intervention
**Current focus:** Deployment + Video rotation fix

## Current Position

Milestone: v1.0 MVP
Phase: Post-deployment troubleshooting
Status: Deployed to Pi, WOD working, video single-item rotation NOT YET WORKING
Last activity: 2026-02-23 — Deployed to Pi, fixing video rotation

Progress: ██████████ 90%

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

## Active Bug: Video Single-Item Rotation

**Problem:** Videos play back-to-back instead of one-per-rotation.

**What was done:**
- Rewrote `public/app.js` to use a `mediaQueue` that plays one item per video zone visit
- Queue cycles: YouTube 1 → YouTube 2 → Reel 1 → Reel 2 → ... → wraps
- `mediaQueuePos` persists across rotation visits
- Added `stopVideo()` call and `videoZoneActive = false` before async zone advance
- Added `Cache-Control: no-store` to Express static serving
- Verified the correct app.js IS being served (confirmed via curl + md5sum)

**What hasn't worked:**
- Despite the server serving the correct JS with no-cache headers, videos still play back-to-back
- YouTube `onStateChange(ENDED)` fires and calls `playNextYouTube()` → `signalVideoZoneComplete()`
- But somehow a second video still plays before zone advances

**Next steps to investigate:**
- Use browser DevTools (via Puppeteer or remote debugging) to see actual console output
- Check if YouTube iframe API `loadVideoById` triggers ENDED for the previous video
- Check if the zone advance POST actually returns and the zone switch happens
- Consider using `--remote-debugging-port=9222` on kiosk Chromium for remote DevTools
- May need to destroy/recreate YouTube player each visit instead of reusing it

## Instagram Reels

- **Method:** instaloader (Python CLI tool, no API key needed)
- **Account:** @bigbarncrossfit (public, no login required)
- **Cache:** ~/gym-display/cache/reels/*.mp4
- **Issue on Pi:** Instagram rate-limiting from Pi's IP (JSON parse errors)
- **Workaround:** Reels were pre-cached from Windows dev machine; Pi will retry hourly

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
- LightDM autologin via /etc/lightdm/lightdm.conf.d/50-autologin.conf
- labwc autostart at ~/.config/labwc/autostart (NOT systemd gym-kiosk.service)

Prior decisions: see .planning/PROJECT.md Key Decisions table

### Pending Todos

- [ ] Fix video single-item-per-rotation (videos still play back-to-back)
- [ ] Investigate Instagram rate limiting on Pi (instaloader fails from Pi IP)

### Blockers/Concerns

- YouTube iframe API may be auto-advancing despite stopVideo() calls
- May need remote Chrome DevTools debugging to see what's happening in browser

## Session Continuity

Last session: 2026-02-23
Stopped at: Video rotation bug — app.js changes deployed but videos still play back-to-back
Resume with: `ssh BigBarn@100.120.21.22` to access Pi, troubleshoot video rotation in browser
