#!/bin/bash
# HDMI CEC control script for gym display TV
# Sends power on/off commands via cec-client (from cec-utils package)
# Retries up to 3 times on failure

set -uo pipefail

ACTION="${1:-}"
MAX_RETRIES=3
RETRY_DELAY=5

send_cec_command() {
  local cmd="$1"
  local label="$2"
  local attempt=1

  while [ $attempt -le $MAX_RETRIES ]; do
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Sending CEC ${label} to TV (attempt ${attempt}/${MAX_RETRIES})"
    if echo "$cmd" | cec-client -s -d 1 2>/dev/null; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - CEC ${label} command sent successfully"
      return 0
    fi
    echo "$(date '+%Y-%m-%d %H:%M:%S') - CEC ${label} failed, retrying in ${RETRY_DELAY}s..."
    attempt=$((attempt + 1))
    sleep $RETRY_DELAY
  done

  echo "$(date '+%Y-%m-%d %H:%M:%S') - ERROR: CEC ${label} failed after ${MAX_RETRIES} attempts"
  return 1
}

case "$ACTION" in
  on)
    send_cec_command 'on 0' 'power ON'
    ;;
  off)
    send_cec_command 'standby 0' 'standby'
    ;;
  *)
    echo "Usage: $0 {on|off}"
    echo "  on  - Wake TV via HDMI CEC"
    echo "  off - Standby TV via HDMI CEC"
    exit 1
    ;;
esac

exit 0
