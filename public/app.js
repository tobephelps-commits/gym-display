// YouTube IFrame API requires this callback on window (outside IIFE)
function onYouTubeIframeAPIReady() {
  window._youtubeAPIReady = true;
  console.log('YouTube IFrame API ready');
  if (window._initYouTubePlayer) {
    window._initYouTubePlayer();
  }
}

(function () {
  'use strict';

  // State
  let rotationOrder = ['wod', 'video', 'roster'];
  let durations = { wod: 120000, video: 180000, roster: 60000 };
  let currentIndex = 0;
  let rotationTimer = null;
  let videoPlayFull = false;

  // WOD state
  var wodMode = 'loading'; // 'loading' | 'iframe' | 'screenshot' | 'error'
  var wodStatusPollTimer = null;
  var wodIframeLoaded = false;
  var wodLastStatus = null;
  var wodScreenshotRefreshTimer = null;

  // Video state
  var videoPlaylist = [];
  var videoIndex = 0;
  var ytPlayer = null;
  var youtubeReady = false;
  var videoZoneActive = false;

  /**
   * Initialize YouTube player instance.
   */
  function createYouTubePlayer() {
    if (ytPlayer) return; // already created

    ytPlayer = new YT.Player('yt-player', {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        fs: 0,
        iv_load_policy: 3,
        disablekb: 1,
        playsinline: 1,
        enablejsapi: 1
      },
      events: {
        onReady: function (event) {
          youtubeReady = true;
          event.target.setVolume(80);
          console.log('YouTube player ready');
        },
        onStateChange: function (event) {
          if (event.data === YT.PlayerState.ENDED) {
            console.log('YouTube video ended');
            playNextYouTube();
          }
        },
        onError: function (event) {
          console.error('YouTube player error:', event.data);
          // Error 101/150 = embedding disabled, skip to next
          playNextYouTube();
        }
      }
    });
  }

  // Wire up the YouTube API ready callback
  window._initYouTubePlayer = createYouTubePlayer;
  if (window._youtubeAPIReady) {
    createYouTubePlayer();
  }

  /**
   * Called when video zone becomes active — fetch playlist and start playing.
   */
  function onVideoZoneActive() {
    videoZoneActive = true;

    fetch('/api/videos')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        videoPlaylist = data.videos || [];
        videoIndex = 0;

        // Reset server-side playlist index
        fetch('/api/videos/reset', { method: 'POST' });

        if (videoPlaylist.length === 0) {
          // No videos configured — show fallback
          showVideoElement('video-no-content');
          hideVideoElement('yt-player');
          console.log('No videos configured, showing fallback');
          // With no videos, let the fallback timer handle zone advancement
          return;
        }

        // Show player, hide fallback
        showVideoElement('yt-player');
        hideVideoElement('video-no-content');

        // Start first video
        var firstVideo = videoPlaylist[0];
        console.log('Starting YouTube playlist: ' + videoPlaylist.length + ' videos');
        if (youtubeReady && ytPlayer) {
          ytPlayer.loadVideoById(firstVideo.videoId);
        } else {
          console.warn('YouTube player not ready yet, waiting...');
        }
      })
      .catch(function (err) {
        console.error('Failed to fetch video playlist:', err);
        showVideoElement('video-no-content');
        hideVideoElement('yt-player');
      });
  }

  /**
   * Called when video zone becomes inactive — pause player.
   */
  function onVideoZoneInactive() {
    videoZoneActive = false;
    if (ytPlayer && youtubeReady) {
      try {
        ytPlayer.pauseVideo();
      } catch (e) {
        // Player may not be in a state to pause
      }
    }
  }

  /**
   * Advance to next YouTube video in playlist.
   */
  function playNextYouTube() {
    if (!videoZoneActive) return;

    videoIndex++;
    if (videoIndex < videoPlaylist.length) {
      var nextVideo = videoPlaylist[videoIndex];
      console.log('Playing next video: ' + nextVideo.title + ' (' + (videoIndex + 1) + '/' + videoPlaylist.length + ')');
      if (ytPlayer && youtubeReady) {
        ytPlayer.loadVideoById(nextVideo.videoId);
      }
    } else {
      // Playlist exhausted — signal zone complete
      console.log('YouTube playlist complete');
      signalVideoZoneComplete();
    }
  }

  /**
   * Signal that the video zone has finished its playlist.
   * Tells the zone controller to advance to the next zone.
   */
  function signalVideoZoneComplete() {
    console.log('Signaling video zone complete');
    fetch('/api/zones/advance', { method: 'POST' })
      .then(function (res) { return res.json(); })
      .then(function (state) {
        // The server has advanced; sync local state
        var newZone = state.currentZone;
        // Find the index of the new zone in our rotation order
        var newIndex = rotationOrder.indexOf(newZone);
        if (newIndex !== -1) {
          currentIndex = newIndex;
        }
        showZone(newZone);
        scheduleNext();
      })
      .catch(function (err) {
        console.error('Failed to signal video zone complete:', err);
        // Fallback: advance locally
        advanceZone();
      });
  }

  /**
   * Show a video display element.
   */
  function showVideoElement(elementId) {
    var el = document.getElementById(elementId);
    if (el) {
      el.classList.remove('hidden');
    }
  }

  /**
   * Hide a video display element.
   */
  function hideVideoElement(elementId) {
    var el = document.getElementById(elementId);
    if (el) {
      el.classList.add('hidden');
    }
  }

  /**
   * Show a zone by name, triggering CSS crossfade transition.
   */
  function showZone(zoneName) {
    // Track previous active zone for zone visibility optimization
    var previousZone = rotationOrder[currentIndex !== undefined ? currentIndex : 0];

    var zones = document.querySelectorAll('.zone');
    zones.forEach(function (z) { z.classList.remove('active'); });

    var target = document.getElementById('zone-' + zoneName);
    if (target) {
      target.classList.add('active');
    }

    // WOD zone visibility optimization
    if (zoneName === 'wod') {
      onWodZoneActive();
    } else if (previousZone === 'wod') {
      onWodZoneInactive();
    }

    // Video zone activation/deactivation
    if (zoneName === 'video') {
      onVideoZoneActive();
    } else if (previousZone === 'video') {
      onVideoZoneInactive();
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
   * For video zone with play_full, the timer acts as a safety net only —
   * actual advancement comes from video completion signaling.
   */
  function scheduleNext() {
    if (rotationTimer) {
      clearTimeout(rotationTimer);
    }
    const currentZone = rotationOrder[currentIndex];
    const duration = durations[currentZone] || 60000;

    if (currentZone === 'video' && videoPlayFull && videoPlaylist.length > 0) {
      // play_full mode: use fallback_seconds as safety net only
      console.log('Video zone: play_full mode, safety timeout ' + (duration / 1000) + 's');
      rotationTimer = setTimeout(function () {
        console.log('Video zone safety timeout reached, advancing');
        // Also signal server-side advance
        fetch('/api/zones/advance', { method: 'POST' }).catch(function () {});
        advanceZone();
      }, duration);
    } else {
      // Standard fixed timer
      rotationTimer = setTimeout(advanceZone, duration);
    }
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

        // Update play_full setting
        videoPlayFull = !!(zones.video && zones.video.play_full);
      })
      .catch(function (err) {
        console.error('Config fetch failed:', err);
      });
  }

  /**
   * Show a specific WOD display element, hiding all others.
   */
  function showWodElement(elementId) {
    var displays = document.querySelectorAll('.wod-display');
    displays.forEach(function (el) {
      el.classList.add('hidden');
    });
    var target = document.getElementById(elementId);
    if (target) {
      target.classList.remove('hidden');
    }
  }

  /**
   * Attempt to load WOD via iframe. Falls back to screenshot on timeout/error.
   */
  function tryWodIframe(wodPageUrl) {
    if (wodMode === 'iframe' && wodIframeLoaded) {
      return; // already showing iframe successfully
    }

    var iframe = document.getElementById('wod-iframe');
    if (!iframe) return;

    wodIframeLoaded = false;

    var iframeTimeout = setTimeout(function () {
      if (!wodIframeLoaded) {
        console.log('WOD iframe load timeout, falling back to screenshot');
        tryWodScreenshot();
      }
    }, 10000);

    iframe.onload = function () {
      wodIframeLoaded = true;
      clearTimeout(iframeTimeout);
      wodMode = 'iframe';
      showWodElement('wod-iframe');
      console.log('WOD iframe loaded successfully');
    };

    iframe.onerror = function () {
      clearTimeout(iframeTimeout);
      console.log('WOD iframe error, falling back to screenshot');
      tryWodScreenshot();
    };

    // Set iframe src to the proxied WodScreen page
    var proxyPath = '/wod-proxy' + (wodPageUrl || '/launch/index.html');
    if (iframe.src !== window.location.origin + proxyPath) {
      iframe.src = proxyPath;
    }
  }

  /**
   * Attempt to load WOD screenshot as fallback.
   */
  function tryWodScreenshot() {
    var img = document.getElementById('wod-screenshot');
    if (!img) return;

    var screenshotUrl = '/api/wod/screenshot?t=' + Date.now();

    img.onload = function () {
      wodMode = 'screenshot';
      showWodElement('wod-screenshot');
      console.log('WOD screenshot loaded');
    };

    img.onerror = function () {
      // No screenshot available either
      wodMode = 'error';
      showWodElement('wod-error');
      console.log('WOD screenshot unavailable, showing error state');
    };

    img.src = screenshotUrl;
  }

  /**
   * Poll WOD status and update display mode accordingly.
   */
  function pollWodStatus() {
    fetch('/api/wod/status')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        console.log('WOD status:', data.status);

        if (data.status === 'ready' && data.wodPageUrl) {
          if (wodLastStatus !== 'ready') {
            // Status changed to ready, try iframe
            tryWodIframe(data.wodPageUrl);
          }
        } else if (data.status === 'ready') {
          // Ready but no page URL, use screenshot
          if (wodMode !== 'screenshot') {
            tryWodScreenshot();
          }
        } else if (data.status === 'error' || data.status === 'idle') {
          // Try screenshot fallback (may have cached screenshot)
          if (wodMode !== 'screenshot' && wodMode !== 'error') {
            tryWodScreenshot();
          }
        }

        wodLastStatus = data.status;
      })
      .catch(function (err) {
        console.error('WOD status poll failed:', err);
        // On network error, try screenshot if not already showing something
        if (wodMode === 'loading') {
          tryWodScreenshot();
        }
      });
  }

  /**
   * Start periodic screenshot refresh when in screenshot mode.
   */
  function startScreenshotRefresh() {
    stopScreenshotRefresh();
    wodScreenshotRefreshTimer = setInterval(function () {
      if (wodMode === 'screenshot') {
        var img = document.getElementById('wod-screenshot');
        if (img) {
          img.src = '/api/wod/screenshot?t=' + Date.now();
        }
      }
    }, 60000);
  }

  /**
   * Stop screenshot refresh timer.
   */
  function stopScreenshotRefresh() {
    if (wodScreenshotRefreshTimer) {
      clearInterval(wodScreenshotRefreshTimer);
      wodScreenshotRefreshTimer = null;
    }
  }

  /**
   * Initialize WOD display management.
   */
  function initWod() {
    // Show loading state initially
    showWodElement('wod-loading');
    wodMode = 'loading';

    // Start polling WOD status every 10 seconds
    pollWodStatus();
    wodStatusPollTimer = setInterval(pollWodStatus, 10000);
  }

  /**
   * Called when WOD zone becomes active — ensure display is current.
   */
  function onWodZoneActive() {
    // Trigger an immediate status check when WOD zone comes into view
    pollWodStatus();
    // Start screenshot refresh if in screenshot mode
    if (wodMode === 'screenshot') {
      startScreenshotRefresh();
    }
  }

  /**
   * Called when WOD zone becomes inactive — pause refreshes.
   */
  function onWodZoneInactive() {
    stopScreenshotRefresh();
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

        // Read play_full setting
        videoPlayFull = !!(zones.video && zones.video.play_full);

        // Initialize WOD display management
        initWod();

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
