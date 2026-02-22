#!/bin/bash
# =============================================================================
# Gym Display System — Raspberry Pi Provisioning Script
# =============================================================================
#
# Transforms a fresh Raspberry Pi OS Lite (Bookworm 64-bit) installation
# into a fully configured gym display kiosk system.
#
# Usage: sudo bash setup.sh
#
# This script is idempotent — safe to run multiple times.
# =============================================================================

set -e

# ---------------------------------------------------------------------------
# 1. Root check and user detection
# ---------------------------------------------------------------------------

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root."
    echo "Usage: sudo bash setup.sh"
    exit 1
fi

REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo pi)}"
REAL_HOME="/home/$REAL_USER"
APP_DIR="$REAL_HOME/gym-display"

if [ ! -d "$REAL_HOME" ]; then
    echo "ERROR: Home directory $REAL_HOME does not exist."
    exit 1
fi

echo "============================================================"
echo "  Gym Display System — Provisioning Script"
echo "============================================================"
echo ""
echo "  User:      $REAL_USER"
echo "  Home:      $REAL_HOME"
echo "  App dir:   $APP_DIR"
echo ""
echo "  This script will:"
echo "    - Update system packages"
echo "    - Install Node.js 20 LTS"
echo "    - Install Chromium, X11, and display utilities"
echo "    - Install CEC utilities for HDMI TV control"
echo "    - Install application dependencies (npm)"
echo "    - Configure console autologin"
echo "    - Configure X11 kiosk autostart"
echo "    - Install and enable systemd services and timers"
echo "    - Configure journald log limits"
echo "    - Install logrotate configuration"
echo "    - Secure config.yaml permissions"
echo "    - Install RPi Connect for remote management"
echo ""
echo "============================================================"
echo ""

# ---------------------------------------------------------------------------
# 2. System updates
# ---------------------------------------------------------------------------

echo ">>> Updating system packages..."
apt update && apt upgrade -y
echo ""

# ---------------------------------------------------------------------------
# 3. Install Node.js 20 LTS
# ---------------------------------------------------------------------------

if command -v node &>/dev/null && node --version | grep -q "^v20"; then
    echo ">>> Node.js 20 already installed: $(node --version)"
else
    echo ">>> Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
echo "    Node.js: $(node --version)"
echo "    npm:     $(npm --version)"
echo ""

# ---------------------------------------------------------------------------
# 4. Install display and kiosk dependencies
# ---------------------------------------------------------------------------

echo ">>> Installing display and kiosk dependencies..."
apt install -y chromium-browser xserver-xorg x11-xserver-utils xinit unclutter
echo ""

# ---------------------------------------------------------------------------
# 5. Install CEC utilities
# ---------------------------------------------------------------------------

echo ">>> Installing CEC utilities..."
apt install -y cec-utils
echo ""

# ---------------------------------------------------------------------------
# 5b. Install Python 3 and instaloader (for Instagram Reels fetching)
# ---------------------------------------------------------------------------

echo ">>> Installing Python 3 and instaloader..."
apt install -y python3 python3-pip
pip3 install --break-system-packages instaloader
echo "    instaloader: $(python3 -m instaloader --version 2>/dev/null || echo 'installed')"
echo ""

# ---------------------------------------------------------------------------
# 6. Install application dependencies
# ---------------------------------------------------------------------------

if [ -d "$APP_DIR" ]; then
    echo ">>> Installing application dependencies..."
    sudo -u "$REAL_USER" bash -c "cd '$APP_DIR' && npm install --production"
    echo ""
else
    echo ">>> WARNING: $APP_DIR not found. Skipping npm install."
    echo "    Clone the repository to $APP_DIR and re-run this script,"
    echo "    or run 'npm install --production' manually."
    echo ""
fi

# ---------------------------------------------------------------------------
# 7. Configure autologin to console
# ---------------------------------------------------------------------------

echo ">>> Configuring console autologin for $REAL_USER..."
AUTOLOGIN_DIR="/etc/systemd/system/getty@tty1.service.d"
mkdir -p "$AUTOLOGIN_DIR"
cat > "$AUTOLOGIN_DIR/override.conf" <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $REAL_USER --noclear %I \$TERM
EOF
echo "    Created $AUTOLOGIN_DIR/override.conf"
echo ""

# ---------------------------------------------------------------------------
# 8. Configure X11 autostart on login
# ---------------------------------------------------------------------------

echo ">>> Configuring X11 autostart..."

BASH_PROFILE="$REAL_HOME/.bash_profile"
STARTX_LINE='[ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ] && startx -- -nocursor'

if [ -f "$BASH_PROFILE" ] && grep -qF "$STARTX_LINE" "$BASH_PROFILE"; then
    echo "    .bash_profile already contains startx line."
else
    echo "$STARTX_LINE" >> "$BASH_PROFILE"
    chown "$REAL_USER:$REAL_USER" "$BASH_PROFILE"
    echo "    Added startx to $BASH_PROFILE"
fi

XINITRC="$REAL_HOME/.xinitrc"
cat > "$XINITRC" <<EOF
#!/bin/bash
exec $APP_DIR/scripts/start-kiosk.sh
EOF
chown "$REAL_USER:$REAL_USER" "$XINITRC"
chmod +x "$XINITRC"
echo "    Created $XINITRC"
echo ""

# ---------------------------------------------------------------------------
# 9. Install systemd services and timers
# ---------------------------------------------------------------------------

echo ">>> Installing systemd services and timers..."

SERVICES=(
    "gym-display.service"
    "gym-kiosk.service"
    "gym-cec-off.service"
    "gym-cec-off.timer"
    "gym-cec-on.service"
    "gym-cec-on.timer"
)

for svc in "${SERVICES[@]}"; do
    if [ -f "$APP_DIR/scripts/$svc" ]; then
        # Copy and replace /home/pi with actual user home
        sed "s|/home/pi|$REAL_HOME|g; s|User=pi|User=$REAL_USER|g" \
            "$APP_DIR/scripts/$svc" > "/etc/systemd/system/$svc"
        echo "    Installed $svc"
    else
        echo "    WARNING: $APP_DIR/scripts/$svc not found, skipping."
    fi
done

systemctl daemon-reload

echo ">>> Enabling services and timers..."
systemctl enable gym-display.service
systemctl enable gym-kiosk.service
systemctl enable gym-cec-off.timer
systemctl enable gym-cec-on.timer
echo ""

# ---------------------------------------------------------------------------
# 10. Configure journald log limits
# ---------------------------------------------------------------------------

echo ">>> Configuring journald log limits..."
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/gym-display.conf <<EOF
[Journal]
SystemMaxUse=100M
MaxRetentionSec=7day
EOF
systemctl restart systemd-journald
echo "    Journald limited to 100M / 7 days"
echo ""

# ---------------------------------------------------------------------------
# 11. Install logrotate config
# ---------------------------------------------------------------------------

echo ">>> Installing logrotate configuration..."
if [ -f "$APP_DIR/scripts/gym-display.logrotate" ]; then
    sed "s|/home/pi|$REAL_HOME|g; s|pi pi|$REAL_USER $REAL_USER|g" \
        "$APP_DIR/scripts/gym-display.logrotate" > /etc/logrotate.d/gym-display
    echo "    Installed /etc/logrotate.d/gym-display"
else
    echo "    WARNING: logrotate config not found in scripts/, skipping."
fi
echo ""

# ---------------------------------------------------------------------------
# 12. Set config.yaml permissions
# ---------------------------------------------------------------------------

echo ">>> Securing config.yaml permissions..."
if [ -f "$APP_DIR/config.yaml" ]; then
    chmod 600 "$APP_DIR/config.yaml"
    chown "$REAL_USER:$REAL_USER" "$APP_DIR/config.yaml"
    echo "    config.yaml: mode 600, owner $REAL_USER"
else
    echo "    config.yaml not found yet — permissions will need to be set after creating it."
fi
echo ""

# ---------------------------------------------------------------------------
# 13. Make scripts executable
# ---------------------------------------------------------------------------

echo ">>> Making scripts executable..."
if [ -d "$APP_DIR/scripts" ]; then
    chmod +x "$APP_DIR/scripts/start-kiosk.sh" 2>/dev/null && echo "    start-kiosk.sh" || true
    chmod +x "$APP_DIR/scripts/hdmi-cec.sh" 2>/dev/null && echo "    hdmi-cec.sh" || true
fi
echo ""

# ---------------------------------------------------------------------------
# 14. Install Raspberry Pi Connect
# ---------------------------------------------------------------------------

echo ">>> Installing RPi Connect for remote management..."
apt install -y rpi-connect-lite
systemctl enable --now rpi-connect-lite
echo "    RPi Connect installed and enabled."
echo ""
echo "    IMPORTANT: Run 'rpi-connect signin' to link to your Raspberry Pi account."
echo ""

# ---------------------------------------------------------------------------
# 15. Final summary
# ---------------------------------------------------------------------------

echo "============================================================"
echo "  Setup Complete!"
echo "============================================================"
echo ""
echo "  Installed:"
echo "    - Node.js $(node --version)"
echo "    - Chromium kiosk browser"
echo "    - X11 display server"
echo "    - CEC utilities (HDMI TV control)"
echo "    - RPi Connect (remote management)"
echo "    - Systemd services: gym-display, gym-kiosk"
echo "    - Systemd timers: TV off at 21:00, on at 04:30"
echo "    - Journald limits: 100M / 7 days"
echo "    - Logrotate: daily rotation, 7-day retention"
echo ""
echo "  Next steps:"
echo "    1. Edit config.yaml with your credentials:"
echo "       nano $APP_DIR/config.yaml"
echo ""
echo "    2. Link RPi Connect (for remote access):"
echo "       rpi-connect signin"
echo ""
echo "    3. Reboot to start the display system:"
echo "       sudo reboot"
echo ""
echo "  Management commands:"
echo "    sudo systemctl restart gym-display    # Restart server"
echo "    sudo systemctl restart gym-kiosk      # Restart kiosk"
echo "    sudo systemctl status gym-display     # Check server status"
echo "    sudo journalctl -u gym-display -f     # Follow server logs"
echo "    sudo journalctl -u gym-kiosk -f       # Follow kiosk logs"
echo ""
echo "============================================================"
