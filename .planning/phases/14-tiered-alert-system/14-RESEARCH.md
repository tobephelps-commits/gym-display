# Phase 14: Tiered Alert System - Research

**Researched:** 2026-02-24
**Domain:** Email/SMS/push notification for Node.js monitoring alerts
**Confidence:** HIGH

<research_summary>
## Summary

Researched notification delivery services and alert management patterns for a Node.js Raspberry Pi gym display that needs to alert the owner when zones fail. The standard approach uses Pushover ($4.99 one-time) for critical wake-up alerts and Resend (free tier) for email warnings, with zero-dependency in-memory alert management patterns adapted from Prometheus AlertManager.

Key finding: Don't hand-roll email or SMS delivery. Use established services with free/cheap tiers. The real engineering work is in the alert management layer — deduplication, cooldowns, batching, and flapping detection — which should be implemented as a simple in-memory service (~100-150 lines) with no external dependencies.

**Primary recommendation:** Pushover for critical alerts (wake-up capable), Resend for email warnings, in-memory alert manager with fingerprinting + cooldowns + batch window.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pushover-notifications | latest | Push notifications with emergency priority | $4.99 one-time, priority 2 retries until acknowledged, DND override on Android |
| resend | latest | Transactional email delivery | 3,000/month free, simplest modern API, built on AWS infrastructure |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nodemailer | latest | Email via Gmail SMTP | Fallback if no custom domain for Resend |
| node-fetch (built-in) | N/A | HTTP for ntfy.sh backup | Zero-cost backup notification channel |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pushover | Twilio SMS | SMS bypasses all DND but costs ~$3/month + 10DLC registration overhead |
| Pushover | ntfy.sh | Free but no emergency retry loop, hosted service reliability risk |
| Resend | Nodemailer+Gmail | No domain needed but account suspension risk, not meant for automation |
| Resend | SendGrid | No free tier anymore (eliminated May 2025), minimum $19.95/month |
| Resend | Mailgun | Same 100/day free limit but worse DX, 24h log retention |
| Resend | Amazon SES | Most reliable but sandbox approval process + IAM complexity overkill |

**Installation:**
```bash
npm install pushover-notifications resend
```

**Pushover setup:**
1. Create account at pushover.net
2. Buy app on phone ($4.99 one-time)
3. Create application in dashboard → get APP_TOKEN
4. Note your USER_KEY from dashboard
5. Add to config.yaml: pushover_user_key, pushover_app_token

**Resend setup:**
1. Sign up at resend.com
2. Verify domain (DNS TXT record, ~5 minutes)
3. Generate API key
4. Add to config.yaml: resend_api_key, resend_from_email, alert_email_to

**Alternative if no custom domain:** Use Nodemailer with Gmail App Password instead of Resend.
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Architecture
```
ZoneHealthMonitor (existing Phase 12)
  └── _updateZone() detects status transition
        └── AlertManager (new Phase 14)
              ├── normalizeError() → error category
              ├── fingerprint(zone, status, category)
              ├── flapping detection (suppress unstable zones)
              ├── pending period (consecutiveFailures threshold)
              ├── cooldown check (don't re-alert too soon)
              ├── severity classification (WARNING vs CRITICAL)
              ├── batch window (aggregate warnings)
              └── NotificationService
                    ├── Pushover (critical alerts)
                    ├── Resend/Email (warnings)
                    └── ntfy.sh (optional backup)
```

### Pattern 1: Alert Tiering (Prometheus-style)
**What:** Classify alerts by severity based on zone status and consecutive failures
**When to use:** Every status transition

| Condition | Severity | Channel |
|-----------|----------|---------|
| UNHEALTHY for 3+ consecutive checks | CRITICAL | Pushover (emergency priority) |
| UNHEALTHY for 1-2 checks | WARNING | Email only |
| DEGRADED for 3+ checks | WARNING | Email only |
| ALL zones unhealthy | CRITICAL | Pushover + Email |
| Recovery after notified alert | INFO | Email (all clear) |

### Pattern 2: Alert Fingerprinting + Deduplication
**What:** Generate stable hash from zone + status + error category, suppress duplicate alerts
**When to use:** Before every notification send

```javascript
const crypto = require('crypto');

function getAlertFingerprint(zoneName, status, errorCategory) {
  const key = JSON.stringify({ zone: zoneName, status, category: errorCategory });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

// In-memory store: Map<fingerprint, { firstSeen, lastSeen, count, notified }>
const activeAlerts = new Map();
```

### Pattern 3: Cooldown Periods
**What:** Prevent re-alerting for same issue while it persists
**When to use:** After sending any notification

| Severity | Cooldown | Rationale |
|----------|----------|-----------|
| CRITICAL | 30 minutes | Staff needs reminders but not every minute |
| WARNING | 2 hours | Low urgency, don't nag |
| RECOVERY | No cooldown | Always send immediately |

```javascript
const cooldowns = new Map(); // Map<fingerprint, lastNotifiedAt>

function isOnCooldown(fingerprint, cooldownMs) {
  const lastNotified = cooldowns.get(fingerprint);
  if (!lastNotified) return false;
  return (Date.now() - lastNotified) < cooldownMs;
}
```

### Pattern 4: Batch Window for Warnings
**What:** Collect warnings for 30 seconds, send as digest if multiple
**When to use:** WARNING-level alerts only (CRITICAL bypasses batch)

```javascript
const BATCH_WINDOW_MS = 30_000;
let pendingAlerts = [];
let batchTimer = null;

function queueAlert(alert) {
  if (alert.severity === 'CRITICAL') {
    sendNotification(alert); // Bypass batch
    return;
  }
  pendingAlerts.push(alert);
  if (!batchTimer) {
    batchTimer = setTimeout(flushAlertBatch, BATCH_WINDOW_MS);
  }
}
```

### Pattern 5: Flapping Detection (Nagios-simplified)
**What:** Detect zones rapidly toggling healthy/unhealthy, suppress normal alerts
**When to use:** Before alert classification

```javascript
function isFlapping(recentChecks) {
  if (recentChecks.length < 5) return false;
  let transitions = 0;
  for (let i = 1; i < recentChecks.length; i++) {
    if (recentChecks[i] !== recentChecks[i - 1]) transitions++;
  }
  return (transitions / (recentChecks.length - 1)) >= 0.4;
}
```

### Pattern 6: Recovery Notifications
**What:** Send "all clear" when previously-alerted zone recovers
**When to use:** When zone transitions to HEALTHY

Require 2+ consecutive healthy checks before sending recovery (prevents premature "all clear" for flapping zones). Mirror of consecutiveFailures threshold.

### Anti-Patterns to Avoid
- **Alerting on every check failure:** Use pending periods (consecutive failure thresholds)
- **No cooldowns:** Leads to alert storms, owner ignores all alerts
- **Same channel for all severities:** Critical and warning should feel different
- **No recovery notifications:** Owner doesn't know when to stop worrying
- **External dedup services (Redis etc.):** Overkill for single-Pi, in-memory Map is correct
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email delivery | Custom SMTP client | Resend SDK or Nodemailer | Delivery, bounce handling, SPF/DKIM are complex |
| Push notifications | Raw APNs/FCM integration | Pushover API | Emergency priority, retry-until-acknowledged, cross-platform |
| SMS delivery | Direct carrier APIs | Twilio (if needed) | Carrier compliance (10DLC), delivery receipts, retry logic |
| Rate limiting sends | Custom timer logic | Simple Map + Date.now() | Actually fine to hand-roll — it's just a timestamp check |
| Alert fingerprinting | Complex hashing schemes | SHA256 of normalized JSON | Keep it simple, crypto.createHash is built-in |

**Key insight:** The notification delivery (email, push, SMS) absolutely should not be hand-rolled — these services handle delivery edge cases, retry logic, and platform integration. The alert management logic (tiering, dedup, cooldowns, batching) IS simple enough to hand-roll and SHOULD be, because no lightweight library exists for this and the enterprise solutions (PagerDuty SDK, OpsGenie) are SaaS dependencies overkill for a Pi.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Alert Storms from Flapping Zones
**What goes wrong:** Zone toggles healthy/unhealthy rapidly, owner gets 50 alerts in an hour
**Why it happens:** No flapping detection, alerts fire on every state transition
**How to avoid:** Track last 10 check results, suppress alerts when transition rate >40%
**Warning signs:** Owner complains about alert volume, starts ignoring all alerts

### Pitfall 2: Gmail Account Suspension
**What goes wrong:** Google flags automated sends, suspends account or blocks App Password
**Why it happens:** Gmail explicitly not designed for automated/transactional email
**How to avoid:** Use Resend (or Mailgun) with a custom domain instead of Gmail
**Warning signs:** Intermittent delivery failures, "suspicious activity" emails from Google

### Pitfall 3: SendGrid Free Tier Surprise
**What goes wrong:** Planning around SendGrid's free tier that no longer exists
**Why it happens:** SendGrid eliminated permanent free tier in May 2025, only 60-day trial remains
**How to avoid:** Use Resend (3,000/month free, permanent) instead
**Warning signs:** Emails stop delivering after 60 days with no code change

### Pitfall 4: Pushover iOS Mute Switch
**What goes wrong:** iPhone owner has mute switch on, misses critical alert
**Why it happens:** Pushover's Critical Alerts entitlement was denied by Apple, cannot bypass hardware mute
**How to avoid:** Priority 2 (emergency) with retry/expire still creates repeating visual alerts; owner should configure iOS Focus mode to allow Pushover. Consider ntfy.sh as backup channel.
**Warning signs:** Owner reports not hearing alerts despite them being sent

### Pitfall 5: Premature Recovery Notifications
**What goes wrong:** "All clear" sent after one good check, then zone fails again immediately
**Why it happens:** No recovery threshold — recovery fires on first healthy check
**How to avoid:** Require 2-3 consecutive healthy checks before sending recovery
**Warning signs:** Alternating alert/recovery messages in rapid succession

### Pitfall 6: No Alert History Persistence
**What goes wrong:** After Pi reboot, alert state (cooldowns, active alerts) is lost, duplicate alerts fire
**Why it happens:** In-memory Maps cleared on restart
**How to avoid:** Accept this as a minor issue (Pi reboots daily at 03:30). On reboot, a fresh alert for any currently-unhealthy zone is actually desirable. No persistence needed.
**Warning signs:** N/A — this is acceptable behavior for this project
</common_pitfalls>

<code_examples>
## Code Examples

### Pushover Emergency Alert
```javascript
// Source: pushover-notifications npm docs
const Push = require('pushover-notifications');

const push = new Push({
  user: config.alerts.pushover.userKey,
  token: config.alerts.pushover.appToken
});

// Priority 2 = Emergency: retries every 60s for 1 hour until acknowledged
push.send({
  title: 'GYM DISPLAY CRITICAL',
  message: 'All zones are unhealthy - display is showing nothing',
  priority: 2,      // Emergency
  retry: 60,        // Retry every 60 seconds
  expire: 3600,     // Stop retrying after 1 hour
  sound: 'siren'
}, (err, result) => {
  if (err) console.error('Pushover send failed:', err);
});
```

### Resend Email Warning
```javascript
// Source: resend.com/docs
const { Resend } = require('resend');
const resend = new Resend(config.alerts.resend.apiKey);

await resend.emails.send({
  from: config.alerts.resend.fromEmail,  // e.g. 'alerts@yourdomain.com'
  to: config.alerts.email.recipients,     // e.g. ['owner@gmail.com']
  subject: `[WARNING] Zone "${zoneName}" is degraded`,
  text: [
    `Zone: ${zoneName}`,
    `Status: ${status}`,
    `Error: ${errorMessage}`,
    `Since: ${firstSeen}`,
    ``,
    `This is a warning — the zone is being skipped in rotation.`,
    `You will receive an "all clear" when it recovers.`
  ].join('\n')
});
```

### Nodemailer Gmail Fallback
```javascript
// Source: nodemailer.com docs — use if no custom domain for Resend
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.alerts.gmail.user,
    pass: config.alerts.gmail.appPassword  // 16-char App Password
  }
});

await transporter.sendMail({
  from: config.alerts.gmail.user,
  to: config.alerts.email.recipients.join(','),
  subject: `[WARNING] Zone "${zoneName}" is degraded`,
  text: messageBody
});
```

### ntfy.sh Backup (Zero Dependencies)
```javascript
// Source: docs.ntfy.sh — free backup notification channel
async function sendNtfy(title, message, priority = 'default') {
  await fetch(`https://ntfy.sh/${config.alerts.ntfy.topic}`, {
    method: 'POST',
    body: message,
    headers: {
      'Title': title,
      'Priority': priority,  // 'urgent' for critical
      'Tags': 'warning,rotating_light'
    }
  });
}
```

### Alert Manager Integration Point
```javascript
// How AlertManager hooks into existing ZoneHealthMonitor._updateZone()
// Called on every status transition

handleStatusChange(zoneName, oldStatus, newStatus, errorMsg) {
  if (newStatus === 'HEALTHY') {
    this.handleRecovery(zoneName);
    return;
  }

  const category = this.categorizeError(errorMsg);
  const fingerprint = this.getFingerprint(zoneName, newStatus, category);
  const zone = this.zones.get(zoneName);

  // Flapping? Suppress.
  if (this.isFlapping(zone.recentChecks)) return;

  // Pending period not met? Wait.
  if (zone.consecutiveFailures < this.thresholds.minFailures) return;

  // On cooldown? Skip.
  if (this.isOnCooldown(fingerprint)) return;

  // Classify severity
  const severity = this.classifySeverity(newStatus, zone.consecutiveFailures);

  // Route to appropriate channel
  if (severity === 'CRITICAL') {
    this.sendPushover(zoneName, newStatus, errorMsg);
    this.sendEmail(zoneName, newStatus, errorMsg, severity);
  } else {
    this.queueWarningEmail(zoneName, newStatus, errorMsg);
  }

  this.markNotified(fingerprint);
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SendGrid free tier | Resend free tier | May 2025 | SendGrid eliminated free tier; Resend is the new standard for free transactional email |
| Twilio as default SMS | Pushover for small projects | Ongoing | 10DLC registration requirements make Twilio friction-heavy for personal projects |
| Custom email SMTP | Managed email APIs (Resend, Postmark) | 2023+ | SPF/DKIM/DMARC requirements make self-managed SMTP unreliable |
| PagerDuty/OpsGenie | Simple in-memory patterns | N/A | Enterprise tools are overkill for single-device monitoring |

**New tools/patterns to consider:**
- **ntfy.sh:** Free, open-source push notification service, zero-auth for basic use
- **Resend:** Modern email API with best free tier (3,000/month), excellent DX
- **Pushover priority 2:** Emergency notifications that retry until acknowledged

**Deprecated/outdated:**
- **SendGrid free tier:** Eliminated May 2025, minimum $19.95/month now
- **Gmail for automated sending:** Increasingly risky as Google tightens automated access
- **cannon.js-style "just use SMTP":** Modern email requires SPF/DKIM domain verification
</sota_updates>

<open_questions>
## Open Questions

1. **Does the gym owner have a custom domain?**
   - What we know: Resend requires domain verification for production sending
   - What's unclear: Whether the owner has a domain available
   - Recommendation: If no domain, use Nodemailer+Gmail as fallback. Works fine at this volume but less reliable long-term.

2. **Pushover vs Twilio for critical alerts?**
   - What we know: Pushover is $4.99 one-time, Twilio is ~$3/month. Both wake people up.
   - What's unclear: Owner's preference for push notification vs SMS
   - Recommendation: Start with Pushover (cheaper, simpler). Add Twilio later only if Pushover alerts are being missed.

3. **Should alerts persist across Pi reboots?**
   - What we know: Pi reboots nightly at 03:30. In-memory alert state clears.
   - What's unclear: Whether duplicate alerts after reboot are acceptable
   - Recommendation: Accept it. A fresh alert for a still-unhealthy zone after reboot is actually useful. No file persistence needed.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- Pushover API docs (pushover.net/api) — emergency priority, retry/expire parameters
- Resend docs (resend.com/docs) — free tier limits, Node.js SDK
- Nodemailer docs (nodemailer.com) — Gmail transport setup
- ntfy.sh docs (docs.ntfy.sh) — priority levels, HTTP API
- Prometheus Alerting Best Practices (prometheus.io/docs/practices/alerting/) — tiering, pending periods
- Prometheus AlertManager docs (prometheus.io/docs/alerting/latest/alertmanager/) — group_wait, repeat_interval

### Secondary (MEDIUM confidence)
- SendGrid pricing page + Lemma Legal blog — confirmed free tier elimination May 2025
- Twilio pricing page — SMS costs ~$0.0083/message + $1.15/month number
- Nagios flapping detection docs — algorithm for state transition detection
- Pushover iOS Critical Alerts blog post — confirmed Apple denied the entitlement
- OneUptime blog — alert deduplication fingerprinting patterns

### Tertiary (LOW confidence - needs validation)
- Mailgun free tier specifics (100/day) — from community forum, matches help docs
- Gotify iOS limitations — from community reports, may have improved
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Email delivery (Resend, Nodemailer), push notifications (Pushover)
- Ecosystem: ntfy.sh, Twilio, Telegram, Discord as alternatives
- Patterns: Alert tiering, deduplication, cooldowns, batching, flapping detection
- Pitfalls: Service free tier changes, Gmail reliability, alert storms, iOS limitations

**Confidence breakdown:**
- Standard stack: HIGH — verified pricing/limits from official sources, cross-referenced
- Architecture: HIGH — patterns from Prometheus/AlertManager (industry standard), adapted for simplicity
- Pitfalls: HIGH — documented issues verified across multiple sources
- Code examples: HIGH — from official SDK docs and npm package documentation

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (30 days — notification service ecosystem relatively stable)
</metadata>

---

*Phase: 14-tiered-alert-system*
*Research completed: 2026-02-24*
*Ready for planning: yes*
