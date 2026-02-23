#!/bin/bash
# HDMI CEC control script for gym display TV
# Sends power on/off commands via cec-client (from cec-utils package)

set -euo pipefail

ACTION="${1:-}"

case "$ACTION" in
  on)
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Sending CEC power ON to TV"
    echo 'on 0' | cec-client -s -d 1
    ;;
  off)
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Sending CEC standby to TV"
    echo 'standby 0' | cec-client -s -d 1
    ;;
  *)
    echo "Usage: $0 {on|off}"
    echo "  on  - Wake TV via HDMI CEC"
    echo "  off - Standby TV via HDMI CEC"
    exit 1
    ;;
esac

exit 0
