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
  let lastBoostActive = false;

  // WOD state
  var wodMode = 'loading'; // 'loading' | 'iframe' | 'screenshot' | 'error'
  var wodStatusPollTimer = null;
  var wodIframeLoaded = false;
  var wodLastStatus = null;
  var wodScreenshotRefreshTimer = null;

  // Roster state
  var rosterPollTimer = null;
  var rosterLastData = null;
  var mindbodyConfigured = false;

  // Video state
  var videoPlaylist = [];
  var videoIndex = 0;
  var ytPlayer = null;
  var youtubeReady = false;
  var videoZoneActive = false;

  // Reels state
  var reelsList = [];
  var currentReelIndex = 0;
  var reelsEnabled = false;
  var youtubeComplete = false;
  var reelsMinDisplaySeconds = 30;
  var reelsStartTime = null;
  var reelsMinReached = false;

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
   * Called when video zone becomes active — fetch playlist and reels, start playing.
   * Two-phase logic: YouTube first (with audio), then Reels (muted) as fallback.
   */
  function onVideoZoneActive() {
    videoZoneActive = true;
    youtubeComplete = false;

    // Fetch both videos and reels in parallel
    Promise.all([
      fetch('/api/videos').then(function (res) { return res.json(); }),
      fetch('/api/reels').then(function (res) { return res.json(); })
    ])
      .then(function (results) {
        var videoData = results[0];
        var reelsData = results[1];

        videoPlaylist = videoData.videos || [];
        videoIndex = 0;
        reelsList = reelsData.reels || [];
        reelsEnabled = reelsData.enabled || false;

        // Reset server-side playlist index
        fetch('/api/videos/reset', { method: 'POST' });

        var hasYouTube = videoPlaylist.length > 0;
        var hasReels = reelsEnabled && reelsList.length > 0;

        if (hasYouTube) {
          // Phase 1: Show YouTube player, start playlist
          showVideoElement('yt-player');
          hideVideoElement('video-no-content');
          hideReelsPlayer();

          var firstVideo = videoPlaylist[0];
          console.log('YouTube started: ' + videoPlaylist.length + ' videos');
          if (youtubeReady && ytPlayer) {
            ytPlayer.loadVideoById(firstVideo.videoId);
          } else {
            console.warn('YouTube player not ready yet, waiting...');
          }
        } else if (hasReels) {
          // No YouTube, go straight to Reels
          console.log('No YouTube videos, starting Reels directly: ' + reelsList.length + ' reels');
          showReelsPlayer();
          startReelsPlayback();
        } else {
          // No content at all
          showVideoElement('video-no-content');
          hideVideoElement('yt-player');
          hideReelsPlayer();
          console.log('No videos configured, showing fallback');
        }
      })
      .catch(function (err) {
        console.error('Failed to fetch video/reels data:', err);
        showVideoElement('video-no-content');
        hideVideoElement('yt-player');
        hideReelsPlayer();
      });
  }

  /**
   * Called when video zone becomes inactive — pause players.
   */
  function onVideoZoneInactive() {
    videoZoneActive = false;
    youtubeComplete = false;

    // Pause YouTube
    if (ytPlayer && youtubeReady) {
      try {
        ytPlayer.pauseVideo();
      } catch (e) {
        // Player may not be in a state to pause
      }
    }

    // Pause Reels
    hideReelsPlayer();
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
      // Playlist exhausted — check if Reels are available
      console.log('YouTube playlist complete');
      var hasReels = reelsEnabled && reelsList.length > 0;
      if (hasReels) {
        console.log('YouTube complete, switching to Reels');
        youtubeComplete = true;
        showReelsPlayer();
        startReelsPlayback();
      } else {
        signalVideoZoneComplete();
      }
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
   * Initialize the Reels player and attach event listeners.
   */
  function initReelsPlayer() {
    var video = document.getElementById('reels-player');
    if (!video) return;

    video.addEventListener('ended', function () {
      if (!videoZoneActive) return;

      // Check if minimum display time has been reached
      if (reelsMinReached) {
        console.log('Reels min display reached, advancing zone');
        signalVideoZoneComplete();
      } else {
        playNextReel();
      }
    });
  }

  /**
   * Play the next reel in the list (wraps around).
   */
  function playNextReel() {
    if (reelsList.length === 0) return;

    currentReelIndex = (currentReelIndex + 1) % reelsList.length;
    var reel = reelsList[currentReelIndex];
    var video = document.getElementById('reels-player');
    if (!video) return;

    video.src = '/api/reels/files/' + reel.filename;
    var playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(function (err) {
        console.error('Reel play failed:', err.message);
        // Try next reel after a short delay
        if (reelsList.length > 1) {
          setTimeout(playNextReel, 500);
        }
      });
    }
  }

  /**
   * Start playing reels from the beginning of the list.
   */
  function startReelsPlayback() {
    if (reelsList.length === 0) return;

    currentReelIndex = 0;
    reelsStartTime = Date.now();
    reelsMinReached = false;

    var reel = reelsList[0];
    var video = document.getElementById('reels-player');
    if (!video) return;

    video.src = '/api/reels/files/' + reel.filename;
    var playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(function (err) {
        console.error('Reel play failed:', err.message);
      });
    }

    // Set timer for minimum display duration
    var minMs = (reelsMinDisplaySeconds || 30) * 1000;
    setTimeout(function () {
      reelsMinReached = true;
      console.log('Reels minimum display time reached (' + reelsMinDisplaySeconds + 's)');
    }, minMs);
  }

  /**
   * Show the Reels player, hide YouTube player.
   */
  function showReelsPlayer() {
    hideVideoElement('yt-player');
    hideVideoElement('video-no-content');
    showVideoElement('reels-player');
  }

  /**
   * Hide and pause the Reels player.
   */
  function hideReelsPlayer() {
    hideVideoElement('reels-player');
    var video = document.getElementById('reels-player');
    if (video) {
      video.pause();
      video.removeAttribute('src');
    }
  }

  /**
   * Show one roster-state element, hide all others.
   */
  function showRosterState(stateId) {
    var states = document.querySelectorAll('.roster-state');
    states.forEach(function(el) { el.classList.add('hidden'); });
    var target = document.getElementById(stateId);
    if (target) { target.classList.remove('hidden'); }
  }

  /**
   * Update the roster display with fetched data.
   */
  function updateRosterDisplay(data) {
    if (!data || !data.classInfo) {
      showRosterState('roster-empty');
      return;
    }

    showRosterState('roster-display');

    // Class name
    var classNameEl = document.getElementById('roster-class-name');
    if (classNameEl) {
      classNameEl.textContent = data.classInfo.name || 'Class';
    }

    // Class meta (coach or time)
    var classMetaEl = document.getElementById('roster-class-meta');
    if (classMetaEl) {
      if (data.classInfo.staffName) {
        classMetaEl.textContent = 'Coach: ' + data.classInfo.staffName;
      } else if (data.classInfo.startTime && data.classInfo.endTime) {
        classMetaEl.textContent = data.classInfo.startTime + ' – ' + data.classInfo.endTime;
      } else {
        classMetaEl.textContent = '';
      }
    }

    // Athlete grid
    var grid = document.getElementById('roster-grid');
    if (grid) {
      grid.innerHTML = '';
      var athletes = data.athletes || [];
      athletes.forEach(function(athlete) {
        var div = document.createElement('div');
        div.className = 'roster-athlete';
        div.textContent = athlete;
        grid.appendChild(div);
      });

      // Apply compact/dense class based on count
      grid.classList.remove('roster-grid-compact', 'roster-grid-dense');
      if (athletes.length > 25) {
        grid.classList.add('roster-grid-dense');
      } else if (athletes.length > 15) {
        grid.classList.add('roster-grid-compact');
      }
    }

    // Athlete count
    var countEl = document.getElementById('roster-count');
    if (countEl) {
      var count = data.count || 0;
      countEl.textContent = count + ' athlete' + (count !== 1 ? 's' : '') + ' checked in';
    }
  }

  /**
   * Poll /api/roster for current class and athlete data.
   */
  function pollRoster() {
    fetch('/api/roster')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        updateRosterDisplay(data);
        rosterLastData = data;
      })
      .catch(function(err) {
        console.error('Roster poll failed:', err);
        if (!rosterLastData) {
          showRosterState('roster-error');
        }
        // If we have previous data, keep showing it (stale > error)
      });
  }

  /**
   * Called when roster zone becomes active — start polling.
   */
  function onRosterZoneActive() {
    pollRoster();
    rosterPollTimer = setInterval(pollRoster, 10000);
  }

  /**
   * Called when roster zone becomes inactive — stop polling.
   */
  function onRosterZoneInactive() {
    if (rosterPollTimer) {
      clearInterval(rosterPollTimer);
      rosterPollTimer = null;
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

    // Roster zone activation/deactivation
    if (zoneName === 'roster') {
      onRosterZoneActive();
    } else if (previousZone === 'roster') {
      onRosterZoneInactive();
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

        // Update rotation order (server provides effective order, including boost)
        if (zones.rotation_order) {
          rotationOrder = zones.rotation_order;
        }

        // Safety check: ensure currentIndex stays within bounds after order change
        if (currentIndex >= rotationOrder.length) {
          currentIndex = 0;
        }

        // Update durations
        durations.wod = ((zones.wod && zones.wod.duration_seconds) || 120) * 1000;
        durations.video = ((zones.video && zones.video.fallback_seconds) || 180) * 1000;
        durations.roster = ((zones.roster && zones.roster.duration_seconds) || 60) * 1000;

        // Update play_full setting
        videoPlayFull = !!(zones.video && zones.video.play_full);

        // Update Instagram settings
        var ig = config.instagram || {};
        reelsMinDisplaySeconds = ig.min_display_seconds || 30;

        // Update MindBody configuration status
        var mb = config.mindbody || {};
        mindbodyConfigured = !!mb.configured;

        // Log boost state changes
        var boostActive = !!zones.boostActive;
        if (boostActive !== lastBoostActive) {
          console.log('Roster boost ' + (boostActive ? 'ACTIVATED' : 'DEACTIVATED') + ' — rotation: [' + rotationOrder.join(', ') + ']');
          lastBoostActive = boostActive;
        }
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

        // Read Instagram settings
        var ig = config.instagram || {};
        reelsMinDisplaySeconds = ig.min_display_seconds || 30;

        // Read MindBody configuration status
        var mb = config.mindbody || {};
        mindbodyConfigured = !!mb.configured;

        // Initialize Reels player
        initReelsPlayer();

        // Initialize WOD display management
        initWod();

        // Initialize roster state
        if (!mindbodyConfigured) {
          showRosterState('roster-error');
        } else {
          showRosterState('roster-loading');
        }

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
