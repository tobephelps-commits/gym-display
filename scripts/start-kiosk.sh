#!/bin/bash

# Gym Display Kiosk Launcher (Wayland/labwc)
# Called from labwc autostart. Waits for the Node.js server, then launches Chromium.
# Chromium is wrapped in a restart loop — if it crashes, it relaunches automatically.

SERVER_URL="http://localhost:3000/api/health"
MAX_RETRIES=30
RETRY_INTERVAL=2
RESTART_DELAY=5

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

# Restart loop — if Chromium exits (crash, OOM, etc.), relaunch it
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
    --disable-features=TranslateUI \
    --check-for-update-interval=31536000 \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --password-store=basic \
    --disable-gpu-compositing \
    http://localhost:3000

  EXIT_CODE=$?
  echo "[Kiosk] Chromium exited with code ${EXIT_CODE} at $(date '+%Y-%m-%d %H:%M:%S')"

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
