#!/bin/bash
# =============================================================================
# Gym Display System — Raspberry Pi Provisioning Script
# =============================================================================
#
# Transforms a fresh Raspberry Pi OS Lite (Bookworm 64-bit) installation
# into a fully configured gym display kiosk system using Wayland/labwc.
#
# Prerequisites:
#   - Raspberry Pi OS Lite 64-bit (Bookworm or newer)
#   - SSH and WiFi configured via Raspberry Pi Imager
#   - Raspberry Pi Connect already signed in (if using remote access)
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
echo "    - Update package lists"
echo "    - Install Node.js 20 LTS"
echo "    - Install labwc (Wayland compositor) and Chromium"
echo "    - Install CEC utilities for HDMI TV control"
echo "    - Install Python 3 and instaloader (Instagram Reels)"
echo "    - Install application dependencies (npm)"
echo "    - Configure console autologin"
echo "    - Configure labwc kiosk autostart"
echo "    - Install and enable systemd services and timers"
echo "    - Configure journald log limits"
echo "    - Install logrotate configuration"
echo "    - Secure config.yaml permissions"
echo ""
echo "============================================================"
echo ""

# ---------------------------------------------------------------------------
# 2. Update package lists (no upgrade — avoids breaking existing packages)
# ---------------------------------------------------------------------------

echo ">>> Updating package lists..."
apt update
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
# 4. Install Wayland compositor, Chromium, and display utilities
# ---------------------------------------------------------------------------

echo ">>> Installing labwc (Wayland compositor) and Chromium..."
apt install -y labwc chromium-browser wlr-randr
echo ""

# ---------------------------------------------------------------------------
# 5. Install CEC utilities
# ---------------------------------------------------------------------------

echo ">>> Installing CEC utilities..."
apt install -y cec-utils
echo ""

# ---------------------------------------------------------------------------
# 6. Install Python 3 and instaloader (for Instagram Reels fetching)
# ---------------------------------------------------------------------------

echo ">>> Installing Python 3 and instaloader..."
apt install -y python3 python3-pip
pip3 install --break-system-packages instaloader
echo "    instaloader installed"
echo ""

# ---------------------------------------------------------------------------
# 7. Install application dependencies
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
# 8. Configure autologin to console
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
# 9. Configure labwc autostart (launches kiosk script)
# ---------------------------------------------------------------------------

echo ">>> Configuring labwc Wayland kiosk autostart..."

LABWC_DIR="$REAL_HOME/.config/labwc"
mkdir -p "$LABWC_DIR"

cat > "$LABWC_DIR/autostart" <<EOF
# Gym Display Kiosk — labwc autostart
# This runs when labwc (Wayland compositor) starts

# Launch the gym display kiosk
$APP_DIR/scripts/start-kiosk.sh &
EOF

chown -R "$REAL_USER:$REAL_USER" "$REAL_HOME/.config"
chmod +x "$LABWC_DIR/autostart"
echo "    Created $LABWC_DIR/autostart"

# Configure .bash_profile to auto-launch labwc on tty1
BASH_PROFILE="$REAL_HOME/.bash_profile"
LABWC_LINE='[ -z "$WAYLAND_DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ] && exec labwc'

if [ -f "$BASH_PROFILE" ] && grep -qF "labwc" "$BASH_PROFILE"; then
    echo "    .bash_profile already contains labwc launch line."
else
    # Remove old X11 startx line if present
    if [ -f "$BASH_PROFILE" ]; then
        sed -i '/startx/d' "$BASH_PROFILE"
    fi
    echo "$LABWC_LINE" >> "$BASH_PROFILE"
    chown "$REAL_USER:$REAL_USER" "$BASH_PROFILE"
    echo "    Added labwc auto-launch to $BASH_PROFILE"
fi

# Remove old .xinitrc if present (X11 leftover)
if [ -f "$REAL_HOME/.xinitrc" ]; then
    rm -f "$REAL_HOME/.xinitrc"
    echo "    Removed old .xinitrc (X11 leftover)"
fi

echo ""

# ---------------------------------------------------------------------------
# 10. Install systemd services and timers
# ---------------------------------------------------------------------------

echo ">>> Installing systemd services and timers..."

SERVICES=(
    "gym-display.service"
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
systemctl enable gym-cec-off.timer
systemctl enable gym-cec-on.timer

# Remove old gym-kiosk.service if it exists (kiosk now runs via labwc autostart)
if systemctl is-enabled gym-kiosk.service &>/dev/null; then
    systemctl disable gym-kiosk.service
    echo "    Disabled old gym-kiosk.service (kiosk now runs via labwc autostart)"
fi
rm -f /etc/systemd/system/gym-kiosk.service

echo ""

# ---------------------------------------------------------------------------
# 11. Configure journald log limits
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
# 12. Install logrotate config
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
# 13. Set config.yaml permissions
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
# 14. Make scripts executable
# ---------------------------------------------------------------------------

echo ">>> Making scripts executable..."
if [ -d "$APP_DIR/scripts" ]; then
    chmod +x "$APP_DIR/scripts/start-kiosk.sh" 2>/dev/null && echo "    start-kiosk.sh" || true
    chmod +x "$APP_DIR/scripts/hdmi-cec.sh" 2>/dev/null && echo "    hdmi-cec.sh" || true
fi
echo ""

# ---------------------------------------------------------------------------
# 15. Ensure Raspberry Pi Connect is intact
# ---------------------------------------------------------------------------

echo ">>> Verifying Raspberry Pi Connect..."
if dpkg -l | grep -q rpi-connect; then
    echo "    Raspberry Pi Connect is installed."
    systemctl enable rpi-connect 2>/dev/null || systemctl enable rpi-connect-lite 2>/dev/null || true
    echo "    Service enabled."
else
    echo "    WARNING: Raspberry Pi Connect not found."
    echo "    Install it with: sudo apt install rpi-connect"
    echo "    Then sign in with: rpi-connect signin"
fi
echo ""

# ---------------------------------------------------------------------------
# 16. Clean up X11 leftovers (if migrating from old setup)
# ---------------------------------------------------------------------------

echo ">>> Cleaning up X11 leftovers (if any)..."
# Remove X11 packages if they were installed by a previous setup
if dpkg -l | grep -q "xserver-xorg-core"; then
    echo "    Found X11 packages from old setup. Removing..."
    apt remove -y xserver-xorg xserver-xorg-core xinit x11-xserver-utils unclutter 2>/dev/null || true
    apt autoremove -y
    echo "    X11 packages removed."
else
    echo "    No X11 leftovers found."
fi
echo ""

# ---------------------------------------------------------------------------
# 17. Final summary
# ---------------------------------------------------------------------------

echo "============================================================"
echo "  Setup Complete!"
echo "============================================================"
echo ""
echo "  Installed:"
echo "    - Node.js $(node --version)"
echo "    - labwc Wayland compositor (kiosk)"
echo "    - Chromium browser"
echo "    - Python 3 + instaloader (Instagram Reels)"
echo "    - CEC utilities (HDMI TV control)"
echo "    - Systemd service: gym-display (Node.js server)"
echo "    - Systemd timers: TV off at 21:00, on at 04:30"
echo "    - Journald limits: 100M / 7 days"
echo ""
echo "  Kiosk mode:"
echo "    - Console autologin → labwc (Wayland) → Chromium kiosk"
echo "    - Compatible with Raspberry Pi Connect"
echo ""
echo "  Next steps:"
echo "    1. Edit config.yaml with your credentials:"
echo "       nano $APP_DIR/config.yaml"
echo ""
echo "    2. Reboot to start the display system:"
echo "       sudo reboot"
echo ""
echo "  Management commands:"
echo "    sudo systemctl restart gym-display    # Restart server"
echo "    sudo systemctl status gym-display     # Check server status"
echo "    sudo journalctl -u gym-display -f     # Follow server logs"
echo ""
echo "============================================================"
