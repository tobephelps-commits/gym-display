#!/bin/bash

# Gym Display Kiosk Launcher (Wayland/labwc)
# Called from labwc autostart. Waits for the Node.js server, then launches Chromium.
# Chromium is wrapped in a restart loop — if it crashes, it relaunches automatically.
# A background watchdog kills Chromium if the display appears stuck (grey screen).

SERVER_URL="http://localhost:3000/api/health"
ZONE_URL="http://localhost:3000/api/zones"
MAX_RETRIES=30
RETRY_INTERVAL=2
RESTART_DELAY=5
# Watchdog: kill Chromium if server is reachable but no zone advances for this long
# Interval must exceed the longest video play time (~5min with play_full: true).
# Total dead-time before kill = WATCHDOG_INTERVAL * 2 (check + double-check).
WATCHDOG_INTERVAL=300
WATCHDOG_GRACE_PERIOD=120  # seconds after launch before watchdog starts checking

# Wait for the Node.js server to be ready
echo "[Kiosk] Waiting for server at ${SERVER_URL}..."
retries=0
while [ $retries -lt $MAX_RETRIES ]; do
  if curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL" | grep -q "200"; then
    echo "[Kiosk] Server is ready."
    break
  fi
  retries=$((retries + 1))
  echo "[Kiosk] Server not ready (attempt ${retries}/${MAX_RETRIES}), retrying in ${RETRY_INTERVAL}s..."
  sleep $RETRY_INTERVAL
done

if [ $retries -eq $MAX_RETRIES ]; then
  echo "[Kiosk] ERROR: Server did not become ready after ${MAX_RETRIES} attempts. Exiting."
  exit 1
fi

# Fix Chromium crash recovery nag and clear stale caches
fix_crash_prefs() {
  PREFS="$HOME/.config/chromium/Default/Preferences"
  if [ -f "$PREFS" ]; then
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$PREFS"
    sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PREFS"
  fi
  # Clear caches that can cause grey screen after network service crash
  rm -rf "$HOME/.config/chromium/Default/Service Worker" 2>/dev/null
  rm -rf "$HOME/.config/chromium/Default/Cache" 2>/dev/null
  rm -rf "$HOME/.config/chromium/Default/Code Cache" 2>/dev/null
  rm -rf "$HOME/.config/chromium/Default/GPUCache" 2>/dev/null
}

# Background watchdog: detects grey screen by checking if kiosk is actually
# fetching zone data from the server. If the server is healthy but the kiosk
# hasn't advanced zones, Chromium's network service likely crashed internally.
run_watchdog() {
  local chromium_pid=$1
  local launch_time=$(date +%s)

  while kill -0 "$chromium_pid" 2>/dev/null; do
    sleep "$WATCHDOG_INTERVAL"

    # Don't check during grace period (let Chromium finish loading)
    local elapsed=$(( $(date +%s) - launch_time ))
    if [ "$elapsed" -lt "$WATCHDOG_GRACE_PERIOD" ]; then
      continue
    fi

    # Check if server is healthy (if server is down, not a Chromium issue)
    if ! curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL" 2>/dev/null | grep -q "200"; then
      continue
    fi

    # Query zone state — if the server reports an advanceVersion of 0 and
    # uptime > grace period, the kiosk frontend isn't calling advance.
    # Simpler check: try to fetch the page from Chromium's perspective.
    # Actually, we can't easily check what Chromium sees. Instead, check
    # if the Node.js server has seen any zone advance requests recently
    # by looking at the advance endpoint from our side.
    #
    # Best proxy: if we can curl the server fine but Chromium has been
    # running for over WATCHDOG_GRACE_PERIOD without any zone advances
    # in the server logs, the display is stuck.
    local recent_advances
    recent_advances=$(journalctl -u gym-display --since "${WATCHDOG_INTERVAL} seconds ago" --no-pager 2>/dev/null | grep -c "Zone advanced" 2>/dev/null) || true
    recent_advances="${recent_advances%%[^0-9]*}"
    recent_advances="${recent_advances:-0}"

    if [ "$recent_advances" -eq 0 ]; then
      echo "[Kiosk] Watchdog: no zone advances in last ${WATCHDOG_INTERVAL}s — Chromium may be stuck"
      # Double-check with another interval before killing
      sleep "$WATCHDOG_INTERVAL"
      if ! kill -0 "$chromium_pid" 2>/dev/null; then
        break
      fi
      recent_advances=$(journalctl -u gym-display --since "${WATCHDOG_INTERVAL} seconds ago" --no-pager 2>/dev/null | grep -c "Zone advanced" 2>/dev/null) || true
      recent_advances="${recent_advances%%[^0-9]*}"
      recent_advances="${recent_advances:-0}"
      if [ "$recent_advances" -eq 0 ]; then
        echo "[Kiosk] Watchdog: still no zone advances — killing Chromium (pid $chromium_pid)"
        kill "$chromium_pid" 2>/dev/null
        sleep 2
        kill -9 "$chromium_pid" 2>/dev/null
        break
      else
        echo "[Kiosk] Watchdog: zone advances resumed, false alarm"
      fi
    fi
  done
}

# Restart loop — if Chromium exits (crash, OOM, watchdog kill, etc.), relaunch it
# Note: first launch after reboot often gets a network service crash on Chromium 144/Pi 5.
# The watchdog detects this (~3min) and kills Chromium; the restart loop then relaunches
# successfully. Pre-flight approach was removed — it conflicted with WodScraper's Puppeteer.
while true; do
  fix_crash_prefs

  echo "[Kiosk] Launching Chromium kiosk at $(date '+%Y-%m-%d %H:%M:%S')"

  chromium-browser \
    --kiosk \
    --ozone-platform=wayland \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --incognito \
    --autoplay-policy=no-user-gesture-required \
    --disable-features=TranslateUI,NetworkServiceInProcess2 \
    --enable-features=NetworkServiceInProcess \
    --check-for-update-interval=31536000 \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --password-store=basic \
    --disable-gpu-compositing \
    http://localhost:3000 &

  CHROMIUM_PID=$!
  echo "[Kiosk] Chromium PID: $CHROMIUM_PID"

  # Start background watchdog
  run_watchdog "$CHROMIUM_PID" &
  WATCHDOG_PID=$!

  # Wait for Chromium to exit (crash, OOM, or watchdog kill)
  wait "$CHROMIUM_PID"
  EXIT_CODE=$?
  echo "[Kiosk] Chromium exited with code ${EXIT_CODE} at $(date '+%Y-%m-%d %H:%M:%S')"

  # Stop watchdog
  kill "$WATCHDOG_PID" 2>/dev/null
  wait "$WATCHDOG_PID" 2>/dev/null

  # Clean up any orphaned Chromium processes
  pkill -9 -f "chromium.*--kiosk" 2>/dev/null

  # Check if server is still running before restarting
  if ! curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL" | grep -q "200"; then
    echo "[Kiosk] Server not responding. Waiting for it to come back..."
    retries=0
    while [ $retries -lt $MAX_RETRIES ]; do
      if curl -s -o /dev/null -w "%{http_code}" "$SERVER_URL" | grep -q "200"; then
        echo "[Kiosk] Server is back."
        break
      fi
      retries=$((retries + 1))
      sleep $RETRY_INTERVAL
    done

    if [ $retries -eq $MAX_RETRIES ]; then
      echo "[Kiosk] ERROR: Server did not recover. Exiting."
      exit 1
    fi
  fi

  echo "[Kiosk] Restarting Chromium in ${RESTART_DELAY}s..."
  sleep $RESTART_DELAY
done
