#!/bin/bash

# Gym Display Kiosk Launcher
# Waits for the Node.js server, configures display, and launches Chromium in kiosk mode.

SERVER_URL="http://localhost:3000/api/health"
MAX_RETRIES=30
RETRY_INTERVAL=2

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

# Disable screensaver and power management
xset s off
xset -dpms
xset s noblank

# Hide mouse cursor
unclutter -idle 0.5 -root &

# Launch Chromium in kiosk mode
exec chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --incognito \
  --autoplay-policy=no-user-gesture-required \
  --disable-features=TranslateUI \
  --check-for-update-interval=31536000 \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --disable-gpu-compositing \
  http://localhost:3000
