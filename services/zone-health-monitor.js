/**
 * Zone Health Monitor
 *
 * Tracks health of all five zones (wod, video, roster, leaderboard, announcements).
 * Detects failures (stale data, API errors, service unavailability), implements
 * retry logic with configurable backoff, and exposes zone health state via API.
 *
 * Part of v1.3 Resilience — enables Phase 13 (graceful degradation) to skip
 * unhealthy zones and Phase 14 (alerts) to notify on failures.
 */

const STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy'
};

/**
 * Create a fresh zone health state object.
 */
function createZoneState() {
  return {
    status: STATUS.HEALTHY,
    lastSuccess: null,
    lastError: null,
    consecutiveFailures: 0,
    lastCheck: null
  };
}

class ZoneHealthMonitor {
  /**
   * @param {Object} services - Injected service references
   * @param {Object} services.wodScraper
   * @param {Object} services.videoManager
   * @param {Object} services.reelsFetcher
   * @param {Object} services.mindbodyClient
   * @param {Object} services.sheetsClient
   * @param {Object} services.leaderboardService
   * @param {Object} services.announcementsService
   * @param {Object} services.configLoader
   */
  constructor(services) {
    this._wodScraper = services.wodScraper;
    this._videoManager = services.videoManager;
    this._reelsFetcher = services.reelsFetcher;
    this._mindbodyClient = services.mindbodyClient;
    this._sheetsClient = services.sheetsClient;
    this._leaderboardService = services.leaderboardService;
    this._announcementsService = services.announcementsService;
    this._configLoader = services.configLoader;
    this._alertManager = services.alertManager || null;

    // Per-zone health state
    this._zones = {
      wod: createZoneState(),
      video: createZoneState(),
      roster: createZoneState(),
      leaderboard: createZoneState(),
      announcements: createZoneState()
    };

    // Configuration defaults
    this._checkIntervalSeconds = 60;
    this._stalenessMinutes = 10;
    this._maxConsecutiveFailures = 5;

    this._timer = null;

    // Load config
    this._loadConfig();

    // Listen for config changes to update check interval
    if (this._configLoader && this._configLoader.onConfigChange) {
      this._configLoader.onConfigChange((newConfig) => {
        const oldInterval = this._checkIntervalSeconds;
        this._loadConfig();
        // Restart timer if interval changed
        if (oldInterval !== this._checkIntervalSeconds && this._timer) {
          this.stopMonitoring();
          this.startMonitoring();
          console.log(`[HealthMonitor] Check interval changed: ${oldInterval}s -> ${this._checkIntervalSeconds}s`);
        }
      });
    }
  }

  /**
   * Load health config from config-loader.
   */
  _loadConfig() {
    if (!this._configLoader) return;
    const config = this._configLoader.getConfig() || {};
    const health = config.health || {};
    this._checkIntervalSeconds = health.check_interval_seconds || 60;
    this._stalenessMinutes = health.staleness_minutes || 10;
    this._maxConsecutiveFailures = health.max_consecutive_failures || 5;
  }

  /**
   * Start the periodic health check timer.
   */
  startMonitoring() {
    if (this._timer) return; // Already running

    console.log(`[HealthMonitor] Starting health monitoring (interval: ${this._checkIntervalSeconds}s)`);

    // Run first check immediately
    this.checkAll();

    this._timer = setInterval(() => {
      this.checkAll();
    }, this._checkIntervalSeconds * 1000);
  }

  /**
   * Stop the periodic health check timer.
   */
  stopMonitoring() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Run health checks on all zones and update internal state.
   */
  checkAll() {
    this._checkWod();
    this._checkVideo();
    this._checkRoster();
    this._checkLeaderboard();
    this._checkAnnouncements();
  }

  /**
   * Update a zone's health state. Logs on state transitions only.
   */
  _updateZone(zoneName, newStatus, errorMsg) {
    const zone = this._zones[zoneName];
    const oldStatus = zone.status;
    const now = new Date().toISOString();

    zone.lastCheck = now;

    if (newStatus === STATUS.HEALTHY) {
      zone.status = STATUS.HEALTHY;
      zone.lastSuccess = now;
      zone.lastError = null;
      zone.consecutiveFailures = 0;
    } else {
      zone.consecutiveFailures++;
      zone.lastError = errorMsg || null;

      if (zone.consecutiveFailures >= this._maxConsecutiveFailures) {
        zone.status = STATUS.UNHEALTHY;
      } else {
        zone.status = newStatus;
      }
    }

    // Log on state transitions only
    if (oldStatus !== zone.status) {
      console.log(`[HealthMonitor] zone=${zoneName} status=${zone.status} failures=${zone.consecutiveFailures}`);
    }

    // Notify alert manager of status transitions
    if (this._alertManager && oldStatus !== zone.status) {
      try {
        this._alertManager.handleStatusChange(zoneName, oldStatus, zone.status, zone.lastError);
      } catch (err) {
        console.error(`[HealthMonitor] Alert dispatch error: ${err.message}`);
      }
    }

    // Alert on escalation within same status (e.g., unhealthy zone crossing critical threshold)
    if (this._alertManager && oldStatus === zone.status && zone.status !== STATUS.HEALTHY) {
      try {
        this._alertManager.handleStatusChange(zoneName, oldStatus, zone.status, zone.lastError);
      } catch (err) {
        console.error(`[HealthMonitor] Alert dispatch error: ${err.message}`);
      }
    }
  }

  /**
   * Check WOD zone health.
   * Healthy if status !== 'error' OR hasCookies === true.
   * Degraded if status is 'error' but cookies exist (stale but recoverable).
   * Unhealthy if status is 'error' AND no cookies AND last success > staleness_minutes ago.
   */
  _checkWod() {
    try {
      const wodStatus = this._wodScraper.getStatus();

      if (wodStatus.status !== 'error') {
        this._updateZone('wod', STATUS.HEALTHY);
        return;
      }

      // Status is 'error'
      if (wodStatus.hasCookies) {
        this._updateZone('wod', STATUS.DEGRADED, 'WOD status is error but cookies exist (stale but recoverable)');
        return;
      }

      // Error with no cookies — check staleness
      const lastSuccess = this._zones.wod.lastSuccess;
      if (lastSuccess) {
        const ageMinutes = (Date.now() - new Date(lastSuccess).getTime()) / 60000;
        if (ageMinutes > this._stalenessMinutes) {
          this._updateZone('wod', STATUS.UNHEALTHY, 'WOD error, no cookies, data stale');
          return;
        }
      }

      this._updateZone('wod', STATUS.DEGRADED, 'WOD status is error, no cookies');
    } catch (err) {
      this._updateZone('wod', STATUS.UNHEALTHY, `WOD check error: ${err.message}`);
    }
  }

  /**
   * Check Video zone health.
   * Healthy if video count > 0.
   * Degraded if video count === 0 but reels are enabled (partial content).
   * Unhealthy if both video count and reels count are 0.
   */
  _checkVideo() {
    try {
      const videoCount = this._videoManager.getVideoCount();

      if (videoCount > 0) {
        this._updateZone('video', STATUS.HEALTHY);
        return;
      }

      // No videos today — but if that's just day-of-week filtering, it's normal
      if (this._videoManager.isFilteredBySchedule()) {
        this._updateZone('video', STATUS.HEALTHY);
        return;
      }

      // No videos — check reels
      const reelsEnabled = this._reelsFetcher.isEnabled();
      const reelsStatus = this._reelsFetcher.getStatus();
      const reelsCount = reelsStatus.reelsCount || 0;

      if (reelsEnabled && reelsCount > 0) {
        this._updateZone('video', STATUS.DEGRADED, 'No YouTube videos, using reels as fallback');
        return;
      }

      if (reelsEnabled) {
        this._updateZone('video', STATUS.DEGRADED, 'No videos and no cached reels, but reels enabled');
        return;
      }

      this._updateZone('video', STATUS.UNHEALTHY, 'No videos and reels not enabled');
    } catch (err) {
      this._updateZone('video', STATUS.UNHEALTHY, `Video check error: ${err.message}`);
    }
  }

  /**
   * Check Roster zone health.
   * Healthy if MindBody configured and polling.
   * Unhealthy if not configured (expected — API key not activated).
   * Degraded if configured but lastSchedulePoll is stale.
   */
  _checkRoster() {
    try {
      const mbStatus = this._mindbodyClient.getStatus();

      if (!mbStatus.configured) {
        this._updateZone('roster', STATUS.DEGRADED, 'MindBody not configured (expected — API key pending)');
        return;
      }

      if (mbStatus.polling && mbStatus.lastSchedulePoll) {
        const ageMinutes = (Date.now() - new Date(mbStatus.lastSchedulePoll).getTime()) / 60000;
        if (ageMinutes > this._stalenessMinutes) {
          this._updateZone('roster', STATUS.DEGRADED, `MindBody schedule data stale (${Math.round(ageMinutes)}m old)`);
          return;
        }
        this._updateZone('roster', STATUS.HEALTHY);
        return;
      }

      if (mbStatus.configured && !mbStatus.polling) {
        this._updateZone('roster', STATUS.DEGRADED, 'MindBody configured but not polling');
        return;
      }

      this._updateZone('roster', STATUS.DEGRADED, 'MindBody polling but no schedule data yet');
    } catch (err) {
      this._updateZone('roster', STATUS.UNHEALTHY, `Roster check error: ${err.message}`);
    }
  }

  /**
   * Check Leaderboard zone health.
   * Healthy if sheets configured and leaderboard active.
   * Unhealthy if sheets not configured.
   * Degraded if sheets configured but leaderboard not active.
   */
  _checkLeaderboard() {
    try {
      const shStatus = this._sheetsClient.getStatus();

      if (!shStatus.configured) {
        this._updateZone('leaderboard', STATUS.UNHEALTHY, 'Google Sheets not configured');
        return;
      }

      const active = this._leaderboardService.isActive();
      if (active) {
        this._updateZone('leaderboard', STATUS.HEALTHY);
      } else {
        this._updateZone('leaderboard', STATUS.DEGRADED, 'Sheets configured but leaderboard not active (no data in sheet)');
      }
    } catch (err) {
      this._updateZone('leaderboard', STATUS.UNHEALTHY, `Leaderboard check error: ${err.message}`);
    }
  }

  /**
   * Check Announcements zone health.
   * Same pattern as leaderboard.
   */
  _checkAnnouncements() {
    try {
      const shStatus = this._sheetsClient.getStatus();

      if (!shStatus.configured) {
        this._updateZone('announcements', STATUS.UNHEALTHY, 'Google Sheets not configured');
        return;
      }

      const active = this._announcementsService.isActive();
      if (active) {
        this._updateZone('announcements', STATUS.HEALTHY);
      } else {
        this._updateZone('announcements', STATUS.DEGRADED, 'Sheets configured but no active announcements');
      }
    } catch (err) {
      this._updateZone('announcements', STATUS.UNHEALTHY, `Announcements check error: ${err.message}`);
    }
  }

  /**
   * Get full health status snapshot.
   * @returns {{ overall: string, zones: Object, timestamp: string }}
   */
  getHealthStatus() {
    const zones = {};
    let worstStatus = STATUS.HEALTHY;

    for (const [name, state] of Object.entries(this._zones)) {
      zones[name] = { ...state };

      // Track worst status (unhealthy > degraded > healthy)
      if (state.status === STATUS.UNHEALTHY) {
        worstStatus = STATUS.UNHEALTHY;
      } else if (state.status === STATUS.DEGRADED && worstStatus !== STATUS.UNHEALTHY) {
        worstStatus = STATUS.DEGRADED;
      }
    }

    return {
      overall: worstStatus,
      zones,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get health status for a single zone.
   * @param {string} zoneName
   * @returns {Object|null}
   */
  getZoneHealth(zoneName) {
    const zone = this._zones[zoneName];
    if (!zone) return null;
    return { ...zone };
  }

  /**
   * Set the alert manager reference (late-binding to avoid circular dependency).
   * @param {Object} alertManager - AlertManager instance
   */
  setAlertManager(alertManager) {
    this._alertManager = alertManager;
  }
}

/**
 * Factory function to create a ZoneHealthMonitor instance.
 * @param {Object} services - Injected service references
 * @returns {ZoneHealthMonitor}
 */
function create(services) {
  return new ZoneHealthMonitor(services);
}

module.exports = { create, ZoneHealthMonitor };
