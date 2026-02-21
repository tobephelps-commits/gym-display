(function () {
  'use strict';

  // State
  let rotationOrder = ['wod', 'video', 'roster'];
  let durations = { wod: 120000, video: 180000, roster: 60000 };
  let currentIndex = 0;
  let rotationTimer = null;

  /**
   * Show a zone by name, triggering CSS crossfade transition.
   */
  function showZone(zoneName) {
    const zones = document.querySelectorAll('.zone');
    zones.forEach((z) => z.classList.remove('active'));

    const target = document.getElementById('zone-' + zoneName);
    if (target) {
      target.classList.add('active');
    }
  }

  /**
   * Advance to the next zone and schedule the following transition.
   */
  function advanceZone() {
    const fromZone = rotationOrder[currentIndex];
    currentIndex = (currentIndex + 1) % rotationOrder.length;
    const toZone = rotationOrder[currentIndex];

    console.log('Zone transition: ' + fromZone + ' \u2192 ' + toZone);
    showZone(toZone);
    scheduleNext();
  }

  /**
   * Schedule the next zone transition based on current zone's duration.
   */
  function scheduleNext() {
    if (rotationTimer) {
      clearTimeout(rotationTimer);
    }
    const currentZone = rotationOrder[currentIndex];
    const duration = durations[currentZone] || 60000;
    rotationTimer = setTimeout(advanceZone, duration);
  }

  /**
   * Fetch config from server and update local state.
   * Does not interrupt current zone mid-display.
   */
  function fetchConfig() {
    fetch('/api/config')
      .then(function (res) { return res.json(); })
      .then(function (config) {
        var zones = config.zones || {};

        // Update rotation order
        if (zones.rotation_order) {
          rotationOrder = zones.rotation_order;
        }

        // Update durations
        durations.wod = ((zones.wod && zones.wod.duration_seconds) || 120) * 1000;
        durations.video = ((zones.video && zones.video.fallback_seconds) || 180) * 1000;
        durations.roster = ((zones.roster && zones.roster.duration_seconds) || 60) * 1000;
      })
      .catch(function (err) {
        console.error('Config fetch failed:', err);
      });
  }

  /**
   * Initialize: fetch config, show first zone, start rotation.
   */
  function init() {
    fetch('/api/config')
      .then(function (res) { return res.json(); })
      .then(function (config) {
        var zones = config.zones || {};

        if (zones.rotation_order) {
          rotationOrder = zones.rotation_order;
        }

        durations.wod = ((zones.wod && zones.wod.duration_seconds) || 120) * 1000;
        durations.video = ((zones.video && zones.video.fallback_seconds) || 180) * 1000;
        durations.roster = ((zones.roster && zones.roster.duration_seconds) || 60) * 1000;

        // Start with first zone
        currentIndex = 0;
        var firstZone = rotationOrder[0];
        console.log('Zone rotation started: ' + firstZone);
        showZone(firstZone);
        scheduleNext();

        // Poll for config changes every 30 seconds
        setInterval(fetchConfig, 30000);
      })
      .catch(function (err) {
        console.error('Initial config fetch failed:', err);
        // Fallback: start with defaults
        showZone(rotationOrder[0]);
        scheduleNext();
        setInterval(fetchConfig, 30000);
      });
  }

  // Start on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
