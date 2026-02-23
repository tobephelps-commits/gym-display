const configLoader = require('./config-loader');

class ZoneController {
  constructor() {
    const config = configLoader.getConfig();
    const zones = config.zones || {};

    this._normalOrder = zones.rotation_order || ['wod', 'video', 'roster', 'leaderboard', 'announcements'];
    this._rotationOrder = this._normalOrder.slice();
    this._currentIndex = 0;
    this._durations = this._extractDurations(zones);

    // Boost state
    this._boostActive = false;
    this._boostConfig = this._extractBoostConfig(zones);

    // Admin advance counter — increments when admin triggers zone change
    this._advanceVersion = 0;
    // Admin refresh counter — increments when admin triggers service refresh
    this._refreshVersion = 0;

    // Listen for config changes to update rotation order and durations
    configLoader.onConfigChange((newConfig) => {
      const z = newConfig.zones || {};
      this._normalOrder = z.rotation_order || ['wod', 'video', 'roster', 'leaderboard', 'announcements'];
      this._durations = this._extractDurations(z);
      this._boostConfig = this._extractBoostConfig(z);

      // Rebuild effective rotation order based on current boost state
      if (this._boostActive) {
        this._rotationOrder = this._buildBoostedOrder(this._normalOrder, this._boostConfig.frequency);
      } else {
        this._rotationOrder = this._normalOrder.slice();
      }

      // If current index is out of bounds after config change, reset
      if (this._currentIndex >= this._rotationOrder.length) {
        this._currentIndex = 0;
      }

      console.log('Zone controller updated from config reload');
    });
  }

  /**
   * Extract boost config from zones.roster section.
   */
  _extractBoostConfig(zones) {
    const roster = zones.roster || {};
    return {
      beforeMinutes: roster.boost_before_class_minutes || 15,
      frequency: roster.boost_frequency || 2
    };
  }

  /**
   * Extract duration in ms for each zone from config.
   * For video zone with play_full, fallback_seconds is a safety net only.
   */
  _extractDurations(zones) {
    return {
      wod: ((zones.wod && zones.wod.duration_seconds) || 120) * 1000,
      video: ((zones.video && zones.video.fallback_seconds) || 180) * 1000,
      roster: ((zones.roster && zones.roster.duration_seconds) || 60) * 1000,
      leaderboard: ((zones.leaderboard && zones.leaderboard.duration_seconds) || 90) * 1000,
      announcements: ((zones.announcements && zones.announcements.duration_seconds) || 60) * 1000
    };
  }

  /**
   * Build a boosted rotation order that inserts extra roster entries.
   * frequency=2: roster after each non-roster zone.
   *   normal=[wod, video, roster] -> boosted=[wod, roster, video, roster]
   * frequency=3: roster twice after each non-roster zone.
   * If frequency <= 1 or roster not in rotation, return normalOrder as-is.
   */
  _buildBoostedOrder(normalOrder, frequency) {
    if (frequency <= 1 || normalOrder.indexOf('roster') === -1) {
      return normalOrder.slice();
    }

    const boosted = [];
    const rosterInserts = frequency - 1; // frequency=2 means 1 insert after each non-roster

    for (let i = 0; i < normalOrder.length; i++) {
      const zone = normalOrder[i];
      boosted.push(zone);
      // Insert roster after non-roster zones, but not if next zone is already roster
      if (zone !== 'roster') {
        const nextZone = normalOrder[(i + 1) % normalOrder.length];
        const insertsNeeded = nextZone === 'roster' ? rosterInserts - 1 : rosterInserts;
        for (let r = 0; r < insertsNeeded; r++) {
          boosted.push('roster');
        }
      }
    }

    return boosted;
  }

  /**
   * Check if boost should be active based on today's class schedule.
   * Activates boost when any class is active or starting within beforeMinutes.
   * Deactivates boost when no class is active or upcoming.
   */
  checkBoost(schedule) {
    if (!schedule || schedule.length === 0) {
      if (this._boostActive) {
        this._deactivateBoost();
      }
      return;
    }

    const now = new Date();
    const beforeMs = this._boostConfig.beforeMinutes * 60 * 1000;
    let shouldBoost = false;

    for (const cls of schedule) {
      const start = new Date(cls.StartDateTime);
      const end = new Date(cls.EndDateTime);
      const boostStart = new Date(start.getTime() - beforeMs);

      if (now >= boostStart && now <= end) {
        shouldBoost = true;
        break;
      }
    }

    if (shouldBoost && !this._boostActive) {
      this._activateBoost();
    } else if (!shouldBoost && this._boostActive) {
      this._deactivateBoost();
    }
  }

  /**
   * Activate boost — switch to boosted rotation order, preserve current zone.
   */
  _activateBoost() {
    const currentZone = this._rotationOrder[this._currentIndex];
    this._rotationOrder = this._buildBoostedOrder(this._normalOrder, this._boostConfig.frequency);
    this._boostActive = true;

    // Preserve current zone position in new order
    const newIndex = this._rotationOrder.indexOf(currentZone);
    this._currentIndex = newIndex !== -1 ? newIndex : 0;

    console.log(`[ZoneController] Boost ACTIVATED — rotation: [${this._rotationOrder.join(', ')}]`);
  }

  /**
   * Deactivate boost — switch back to normal rotation order, preserve current zone.
   */
  _deactivateBoost() {
    const currentZone = this._rotationOrder[this._currentIndex];
    this._rotationOrder = this._normalOrder.slice();
    this._boostActive = false;

    // Preserve current zone position in normal order
    const newIndex = this._rotationOrder.indexOf(currentZone);
    this._currentIndex = newIndex !== -1 ? newIndex : 0;

    console.log(`[ZoneController] Boost DEACTIVATED — rotation: [${this._rotationOrder.join(', ')}]`);
  }

  /**
   * Returns whether boost is currently active.
   */
  isBoostActive() {
    return this._boostActive;
  }

  /**
   * Check if video zone is configured for play_full mode.
   */
  _isVideoPlayFull() {
    const config = configLoader.getConfig() || {};
    const zones = config.zones || {};
    return !!(zones.video && zones.video.play_full);
  }

  /**
   * Returns current zone state.
   */
  getZoneState() {
    const currentZone = this._rotationOrder[this._currentIndex];
    const nextIndex = (this._currentIndex + 1) % this._rotationOrder.length;
    const nextZone = this._rotationOrder[nextIndex];

    const playFull = currentZone === 'video' && this._isVideoPlayFull();

    return {
      currentZone,
      nextZone,
      durationMs: this._durations[currentZone] || 60000,
      rotationOrder: this._rotationOrder,
      playFull,
      advanceVersion: this._advanceVersion,
      refreshVersion: this._refreshVersion
    };
  }

  /**
   * Advance to the next zone in rotation order.
   */
  bumpRefreshVersion() {
    this._refreshVersion++;
  }

  advanceZone(fromAdmin = false) {
    this._currentIndex = (this._currentIndex + 1) % this._rotationOrder.length;
    if (fromAdmin) {
      this._advanceVersion++;
    }
    const state = this.getZoneState();
    console.log(`Zone advanced to: ${state.currentZone}${fromAdmin ? ' (admin)' : ''}`);
    return state;
  }
}

const controller = new ZoneController();

module.exports = controller;
