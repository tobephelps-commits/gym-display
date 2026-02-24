/**
 * Alert Manager
 *
 * Receives zone status changes from ZoneHealthMonitor and routes them through
 * intelligent alert logic before dispatching via NotificationService.
 *
 * Features:
 * - Severity tiering (CRITICAL → Pushover + Email, WARNING → batched email)
 * - Alert fingerprinting and deduplication
 * - Cooldown periods (30min critical, 2hr warning)
 * - Warning batching (30s window, single digest email)
 * - Flapping detection (suppress unstable zones)
 * - Recovery notifications (email "all clear" after 2+ healthy checks)
 *
 * Part of v1.3 Resilience — Phase 14 (Tiered Alert System).
 */

const crypto = require('crypto');

const SEVERITY = {
  CRITICAL: 'CRITICAL',
  WARNING: 'WARNING',
  INFO: 'INFO'
};

/**
 * Default configuration values.
 */
const DEFAULTS = {
  min_failures_warning: 1,
  min_failures_critical: 3,
  cooldown_critical_minutes: 30,
  cooldown_warning_minutes: 120,
  batch_window_seconds: 30,
  flapping_threshold: 0.4,
  flapping_window: 10,
  recovery_threshold: 2
};

class AlertManager {
  /**
   * @param {Object} notificationService - NotificationService instance
   * @param {Object} [config] - Alert configuration overrides
   */
  constructor(notificationService, config) {
    this._notifications = notificationService;
    this._config = Object.assign({}, DEFAULTS, config || {});

    // State
    this._activeAlerts = new Map();       // Map<fingerprint, { firstSeen, lastSeen, count, notified }>
    this._cooldowns = new Map();          // Map<fingerprint, lastNotifiedTimestamp>
    this._recentChecks = new Map();       // Map<zoneName, Array<status>> (last N per zone)
    this._pendingWarnings = [];           // Array of warning alerts for batching
    this._batchTimer = null;              // setTimeout reference
    this._notifiedZones = new Set();      // Zones that have been notified (need recovery)
    this._consecutiveHealthy = new Map(); // Map<zoneName, count> for recovery threshold

    // Alert history for dashboard (Phase 15)
    this._alertHistory = [];              // Last 50 alerts
    this._maxHistory = 50;
  }

  /**
   * Handle a zone status change. Called by ZoneHealthMonitor on every status transition.
   * @param {string} zoneName - Zone identifier
   * @param {string} oldStatus - Previous status
   * @param {string} newStatus - New status
   * @param {string} [errorMsg] - Error description if unhealthy/degraded
   */
  handleStatusChange(zoneName, oldStatus, newStatus, errorMsg) {
    // Track recent checks for flapping detection
    this._trackCheck(zoneName, newStatus);

    // Recovery check
    if (newStatus === 'healthy') {
      this._trackConsecutiveHealthy(zoneName);
      this.handleRecovery(zoneName);
      return;
    }

    // Reset consecutive healthy counter on any non-healthy status
    this._consecutiveHealthy.set(zoneName, 0);

    // Flapping detection — suppress alerts for unstable zones
    const checks = this._recentChecks.get(zoneName) || [];
    if (this._isFlapping(checks)) {
      console.log(`[AlertManager] zone=${zoneName} flapping detected, suppressing`);
      this._recordHistory(zoneName, 'SUPPRESSED', `Flapping detected — ${errorMsg || newStatus}`, false);
      return;
    }

    // Get consecutive failure count from recent checks
    const consecutiveFailures = this._getConsecutiveFailures(zoneName);

    // Skip if not enough failures yet for even a WARNING
    if (consecutiveFailures < this._config.min_failures_warning) {
      return;
    }

    // Fingerprinting and dedup
    const category = this._categorizeError(errorMsg);
    const fingerprint = this._getFingerprint(zoneName, newStatus, category);
    this._updateActiveAlert(fingerprint, zoneName, newStatus, errorMsg);

    // Cooldown check
    if (this._isOnCooldown(fingerprint)) {
      return;
    }

    // Classify severity
    const severity = this._classifySeverity(zoneName, newStatus, consecutiveFailures);

    // Route to appropriate channel
    if (severity === SEVERITY.CRITICAL) {
      this._sendCritical(zoneName, newStatus, errorMsg, fingerprint);
    } else if (severity === SEVERITY.WARNING) {
      this._queueWarning(zoneName, newStatus, errorMsg, fingerprint);
    }
  }

  /**
   * Track a check result for flapping detection.
   */
  _trackCheck(zoneName, status) {
    if (!this._recentChecks.has(zoneName)) {
      this._recentChecks.set(zoneName, []);
    }
    const checks = this._recentChecks.get(zoneName);
    checks.push(status);
    if (checks.length > this._config.flapping_window) {
      checks.shift();
    }
  }

  /**
   * Track consecutive healthy checks for recovery threshold.
   */
  _trackConsecutiveHealthy(zoneName) {
    const count = (this._consecutiveHealthy.get(zoneName) || 0) + 1;
    this._consecutiveHealthy.set(zoneName, count);
  }

  /**
   * Get consecutive non-healthy checks from recent history.
   */
  _getConsecutiveFailures(zoneName) {
    const checks = this._recentChecks.get(zoneName) || [];
    let count = 0;
    for (let i = checks.length - 1; i >= 0; i--) {
      if (checks[i] !== 'healthy') {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Detect flapping: too many state transitions in recent check window.
   * @param {string[]} recentChecks - Array of recent status values
   * @returns {boolean}
   */
  _isFlapping(recentChecks) {
    if (recentChecks.length < 5) return false;
    let transitions = 0;
    for (let i = 1; i < recentChecks.length; i++) {
      if (recentChecks[i] !== recentChecks[i - 1]) {
        transitions++;
      }
    }
    return (transitions / (recentChecks.length - 1)) >= this._config.flapping_threshold;
  }

  /**
   * Categorize an error message into a normalized category.
   * @param {string} [errorMsg]
   * @returns {string}
   */
  _categorizeError(errorMsg) {
    if (!errorMsg) return 'unknown';
    const msg = errorMsg.toLowerCase();
    if (msg.includes('api') || msg.includes('401') || msg.includes('403') || msg.includes('500')) return 'api_error';
    if (msg.includes('stale') || msg.includes('old')) return 'stale_data';
    if (msg.includes('not configured') || msg.includes('not enabled')) return 'not_configured';
    if (msg.includes('no content') || msg.includes('no video') || msg.includes('no data') || msg.includes('empty')) return 'no_content';
    if (msg.includes('error') || msg.includes('failed') || msg.includes('crash')) return 'check_error';
    return 'unknown';
  }

  /**
   * Generate a stable fingerprint for an alert.
   * @param {string} zoneName
   * @param {string} status
   * @param {string} category
   * @returns {string} 16-char hex hash
   */
  _getFingerprint(zoneName, status, category) {
    const key = JSON.stringify({ zone: zoneName, status, category });
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  /**
   * Update active alert tracking for a fingerprint.
   */
  _updateActiveAlert(fingerprint, zoneName, status, errorMsg) {
    const now = Date.now();
    if (this._activeAlerts.has(fingerprint)) {
      const alert = this._activeAlerts.get(fingerprint);
      alert.lastSeen = now;
      alert.count++;
    } else {
      this._activeAlerts.set(fingerprint, {
        zone: zoneName,
        status,
        errorMsg,
        firstSeen: now,
        lastSeen: now,
        count: 1,
        notified: false
      });
    }
  }

  /**
   * Check if an alert fingerprint is on cooldown.
   * @param {string} fingerprint
   * @returns {boolean}
   */
  _isOnCooldown(fingerprint) {
    const lastNotified = this._cooldowns.get(fingerprint);
    if (!lastNotified) return false;

    // Determine cooldown based on alert severity (use active alert info)
    const alert = this._activeAlerts.get(fingerprint);
    const isCritical = alert && alert.status === 'unhealthy';
    const cooldownMs = isCritical
      ? this._config.cooldown_critical_minutes * 60 * 1000
      : this._config.cooldown_warning_minutes * 60 * 1000;

    return (Date.now() - lastNotified) < cooldownMs;
  }

  /**
   * Classify severity based on zone status and consecutive failures.
   * @param {string} zoneName
   * @param {string} newStatus
   * @param {number} consecutiveFailures
   * @returns {string} CRITICAL, WARNING, or INFO
   */
  _classifySeverity(zoneName, newStatus, consecutiveFailures) {
    // All zones unhealthy? CRITICAL
    if (this._areAllZonesUnhealthy()) {
      return SEVERITY.CRITICAL;
    }

    // Single zone UNHEALTHY for 3+ checks → CRITICAL
    if (newStatus === 'unhealthy' && consecutiveFailures >= this._config.min_failures_critical) {
      return SEVERITY.CRITICAL;
    }

    // Single zone UNHEALTHY for 1-2 checks → WARNING
    if (newStatus === 'unhealthy') {
      return SEVERITY.WARNING;
    }

    // Zone DEGRADED for 3+ checks → WARNING
    if (newStatus === 'degraded' && consecutiveFailures >= this._config.min_failures_critical) {
      return SEVERITY.WARNING;
    }

    return SEVERITY.WARNING;
  }

  /**
   * Check if all zones have recent unhealthy status.
   * @returns {boolean}
   */
  _areAllZonesUnhealthy() {
    if (this._recentChecks.size === 0) return false;
    for (const [, checks] of this._recentChecks) {
      if (checks.length === 0) return false;
      const lastCheck = checks[checks.length - 1];
      if (lastCheck === 'healthy') return false;
    }
    // Need at least the 5 known zones reporting
    return this._recentChecks.size >= 5;
  }

  /**
   * Send a critical alert (Pushover + email immediately).
   */
  async _sendCritical(zoneName, status, errorMsg, fingerprint) {
    const title = 'GYM DISPLAY CRITICAL';
    const message = `Zone "${zoneName}" is ${status}\n${errorMsg || 'No details'}`;

    console.log(`[AlertManager] CRITICAL alert: zone=${zoneName} status=${status}`);

    // Mark notified
    this._markNotified(fingerprint, zoneName);

    // Send Pushover (priority 2 = emergency)
    await this._notifications.sendPushover(title, message, 2);

    // Send email immediately
    const emailBody = [
      `CRITICAL ALERT`,
      ``,
      `Zone: ${zoneName}`,
      `Status: ${status}`,
      `Error: ${errorMsg || 'N/A'}`,
      `Time: ${new Date().toISOString()}`,
      ``,
      `This zone has been failing consistently. Pushover emergency alert also sent.`,
      `You will receive an "all clear" when it recovers.`
    ].join('\n');
    await this._notifications.sendEmail(`[CRITICAL] Zone "${zoneName}" is ${status}`, emailBody);

    // Record in history
    this._recordHistory(zoneName, SEVERITY.CRITICAL, errorMsg, true);
  }

  /**
   * Queue a warning alert for batch digest.
   */
  _queueWarning(zoneName, status, errorMsg, fingerprint) {
    console.log(`[AlertManager] WARNING queued: zone=${zoneName} status=${status}`);

    // Mark notified
    this._markNotified(fingerprint, zoneName);

    this._pendingWarnings.push({
      zone: zoneName,
      status,
      errorMsg: errorMsg || 'N/A',
      timestamp: new Date().toISOString()
    });

    // Record in history
    this._recordHistory(zoneName, SEVERITY.WARNING, errorMsg, true);

    // Start batch timer if not running
    if (!this._batchTimer) {
      this._batchTimer = setTimeout(() => {
        this._flushWarningBatch();
      }, this._config.batch_window_seconds * 1000);
    }
  }

  /**
   * Flush pending warnings as a single email digest.
   */
  async _flushWarningBatch() {
    this._batchTimer = null;

    if (this._pendingWarnings.length === 0) return;

    const warnings = this._pendingWarnings.splice(0);
    const count = warnings.length;
    const subject = count === 1
      ? `[WARNING] Zone "${warnings[0].zone}" is ${warnings[0].status}`
      : `[WARNING] ${count} zone warnings`;

    const lines = [
      `WARNING DIGEST — ${count} alert(s)`,
      ``
    ];

    for (const w of warnings) {
      lines.push(`Zone: ${w.zone}`);
      lines.push(`Status: ${w.status}`);
      lines.push(`Error: ${w.errorMsg}`);
      lines.push(`Time: ${w.timestamp}`);
      lines.push(``);
    }

    lines.push(`These zones are being skipped in rotation.`);
    lines.push(`You will receive an "all clear" when they recover.`);

    console.log(`[AlertManager] Flushing warning batch (${count} alerts)`);
    await this._notifications.sendEmail(subject, lines.join('\n'));
  }

  /**
   * Handle recovery for a zone that was previously notified.
   * Requires 2+ consecutive healthy checks before sending recovery email.
   * @param {string} zoneName
   */
  async handleRecovery(zoneName) {
    if (!this._notifiedZones.has(zoneName)) return;

    const healthyCount = this._consecutiveHealthy.get(zoneName) || 0;
    if (healthyCount < this._config.recovery_threshold) return;

    // Zone has recovered — send "all clear"
    console.log(`[AlertManager] Recovery: zone=${zoneName} (${healthyCount} consecutive healthy checks)`);

    this._notifiedZones.delete(zoneName);
    this._consecutiveHealthy.set(zoneName, 0);

    // Clear active alerts for this zone
    for (const [fp, alert] of this._activeAlerts) {
      if (alert.zone === zoneName) {
        this._activeAlerts.delete(fp);
        this._cooldowns.delete(fp);
      }
    }

    const emailBody = [
      `ALL CLEAR`,
      ``,
      `Zone: ${zoneName}`,
      `Status: healthy`,
      `Recovered at: ${new Date().toISOString()}`,
      ``,
      `This zone has been restored and is back in rotation.`
    ].join('\n');

    await this._notifications.sendEmail(`[RECOVERED] Zone "${zoneName}" is healthy`, emailBody);
    this._recordHistory(zoneName, SEVERITY.INFO, 'Zone recovered', true);
  }

  /**
   * Mark an alert as notified and set cooldown.
   */
  _markNotified(fingerprint, zoneName) {
    const alert = this._activeAlerts.get(fingerprint);
    if (alert) {
      alert.notified = true;
    }
    this._cooldowns.set(fingerprint, Date.now());
    this._notifiedZones.add(zoneName);
  }

  /**
   * Record an alert in history for Phase 15 dashboard.
   */
  _recordHistory(zoneName, severity, message, notified) {
    this._alertHistory.push({
      zone: zoneName,
      severity,
      message: message || '',
      timestamp: new Date().toISOString(),
      notified
    });
    // Keep only last N entries
    if (this._alertHistory.length > this._maxHistory) {
      this._alertHistory.shift();
    }
  }

  /**
   * Get alert history for dashboard display.
   * @returns {Array<{ zone, severity, message, timestamp, notified }>}
   */
  getAlertHistory() {
    return [...this._alertHistory];
  }

  /**
   * Get alert manager status.
   * @returns {{ activeAlerts: number, cooldowns: number, flapping: string[] }}
   */
  getStatus() {
    const flapping = [];
    for (const [zoneName, checks] of this._recentChecks) {
      if (this._isFlapping(checks)) {
        flapping.push(zoneName);
      }
    }

    return {
      activeAlerts: this._activeAlerts.size,
      cooldowns: this._cooldowns.size,
      flapping
    };
  }

  /**
   * Clean up timers on shutdown.
   */
  destroy() {
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
  }
}

/**
 * Factory function to create an AlertManager instance.
 * @param {Object} notificationService - NotificationService instance
 * @param {Object} [config] - Alert configuration overrides
 * @returns {AlertManager}
 */
function create(notificationService, config) {
  return new AlertManager(notificationService, config);
}

module.exports = { create, AlertManager };
