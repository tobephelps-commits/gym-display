const configLoader = require('./config-loader');

class ZoneController {
  constructor() {
    const config = configLoader.getConfig();
    const zones = config.zones || {};

    this._rotationOrder = zones.rotation_order || ['wod', 'video', 'roster'];
    this._currentIndex = 0;
    this._durations = this._extractDurations(zones);

    // Listen for config changes to update rotation order and durations
    configLoader.onConfigChange((newConfig) => {
      const z = newConfig.zones || {};
      this._rotationOrder = z.rotation_order || ['wod', 'video', 'roster'];
      this._durations = this._extractDurations(z);

      // If current index is out of bounds after config change, reset
      if (this._currentIndex >= this._rotationOrder.length) {
        this._currentIndex = 0;
      }

      console.log('Zone controller updated from config reload');
    });
  }

  /**
   * Extract duration in ms for each zone from config.
   */
  _extractDurations(zones) {
    return {
      wod: ((zones.wod && zones.wod.duration_seconds) || 120) * 1000,
      video: ((zones.video && zones.video.fallback_seconds) || 180) * 1000,
      roster: ((zones.roster && zones.roster.duration_seconds) || 60) * 1000
    };
  }

  /**
   * Returns current zone state.
   */
  getZoneState() {
    const currentZone = this._rotationOrder[this._currentIndex];
    const nextIndex = (this._currentIndex + 1) % this._rotationOrder.length;
    const nextZone = this._rotationOrder[nextIndex];

    return {
      currentZone,
      nextZone,
      durationMs: this._durations[currentZone] || 60000,
      rotationOrder: this._rotationOrder
    };
  }

  /**
   * Advance to the next zone in rotation order.
   */
  advanceZone() {
    this._currentIndex = (this._currentIndex + 1) % this._rotationOrder.length;
    const state = this.getZoneState();
    console.log(`Zone advanced to: ${state.currentZone}`);
    return state;
  }
}

const controller = new ZoneController();

module.exports = controller;
