# Phase 14: User Setup Required

**Generated:** 2026-02-24
**Phase:** 14-tiered-alert-system
**Status:** Incomplete

Complete these items for the alert system to deliver notifications. Claude automated everything possible; these items require human access to external dashboards/accounts.

Leave sections unconfigured to disable that channel -- the alert system gracefully handles unconfigured services.

## Pushover (Critical Alerts)

Critical alerts (all zones down, persistent failures) are delivered via Pushover push notifications that can wake you up.

### Account Setup

- [ ] **Create Pushover account**
  - URL: https://pushover.net/signup
  - Skip if: Already have Pushover account

- [ ] **Buy Pushover app on your phone** ($4.99 one-time)
  - iOS: App Store
  - Android: Google Play
  - Skip if: Already purchased

### Dashboard Configuration

- [ ] **Create application in Pushover dashboard**
  - Location: https://pushover.net/apps/build
  - Name: "Gym Display"
  - Type: Script/Application
  - Note the **APP_TOKEN** displayed after creation

- [ ] **Note your USER_KEY**
  - Location: https://pushover.net/dashboard
  - Displayed at top of dashboard page

### Add to config.yaml

```yaml
alerts:
  pushover:
    user_key: "your-user-key-here"
    app_token: "your-app-token-here"
```

## Gmail (Warning Alerts)

Warning alerts (single zone down, degraded zones) are delivered via email using Gmail with an App Password.

### Dashboard Configuration

- [ ] **Generate Gmail App Password**
  - Location: Google Account > Security > 2-Step Verification > App Passwords
  - Prerequisites: 2-Step Verification must be enabled on your Google account
  - Create app password for "Gym Display"
  - Note the 16-character password (shown only once)

### Add to config.yaml

```yaml
alerts:
  email:
    gmail_user: "yourname@gmail.com"
    gmail_app_password: "xxxx xxxx xxxx xxxx"  # 16-character App Password
    recipients:
      - "owner@gmail.com"
```

## Verification

After completing setup, verify on the Pi:

```bash
# SSH to Pi
ssh BigBarn@100.120.21.22

# Check config has alert credentials
grep -A 5 'pushover:' ~/gym-display/config.yaml
grep -A 5 'email:' ~/gym-display/config.yaml

# Restart service to pick up new config
sudo systemctl restart gym-display

# Check logs for alert initialization
journalctl -u gym-display --since "1 min ago" | grep -i alert

# Check admin API (replace TOKEN if admin_token is set)
curl http://localhost:3000/api/admin/alerts
```

Expected results:
- Logs show "[Server] Alert system initialized"
- Logs show "[Notifications] Pushover configured" (if Pushover credentials added)
- Logs show "[Notifications] Email configured (Gmail SMTP)" (if email credentials added)
- `/api/admin/alerts` returns JSON with notification status

---

**Once all items complete:** Mark status as "Complete" at top of file.
