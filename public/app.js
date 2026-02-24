// YouTube IFrame API requires this callback on window (outside IIFE)
function onYouTubeIframeAPIReady() {
  window._youtubeAPIReady = true;
  console.log('YouTube IFrame API ready');
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
  let zoneHealth = {}; // { wod: 'healthy', video: 'degraded', ... } — updated from /api/config poll

  // WOD state
  var wodMode = 'loading'; // 'loading' | 'iframe' | 'error'
  var wodStatusPollTimer = null;
  var wodIframeLoaded = false;
  var wodLastStatus = null;

  // Roster state
  var rosterPollTimer = null;
  var rosterLastData = null;
  var mindbodyConfigured = false;

  // Leaderboard state
  var leaderboardPollTimer = null;
  var leaderboardLastData = null;
  var leaderboardConfigured = false;

  // Announcements state
  var announcementsPollTimer = null;
  var announcementsLastData = null;
  var announcementsConfigured = false;

  // Admin advance/refresh tracking
  var lastAdvanceVersion = 0;
  var lastRefreshVersion = 0;

  // Video state
  var videoPlaylist = [];
  var videoIndex = 0;
  var ytPlayer = null;
  var videoZoneActive = false;

  // Reels state
  var reelsList = [];
  var currentReelIndex = 0;
  var reelsEnabled = false;
  var reelsMinDisplaySeconds = 30;

  // Single-item-per-rotation queue: cycles through all YouTube videos,
  // then all reels, one item per video zone visit.
  var mediaQueue = [];       // Array of { type: 'youtube'|'reel', index: N }
  var mediaQueuePos = 0;     // Persists across rotations

  /**
   * Create a fresh YouTube player for a single video.
   * Destroys any existing player first, creates a new iframe in the container.
   * This approach eliminates all stale event issues since no player exists between zone visits.
   */
  function createFreshYouTubePlayer(videoId) {
    destroyYouTubePlayer();

    var container = document.getElementById('yt-container');
    if (!container) return;

    // Create a fresh div that YT.Player will replace with an iframe
    var playerDiv = document.createElement('div');
    playerDiv.id = 'yt-player-inner';
    container.appendChild(playerDiv);

    ytPlayer = new YT.Player('yt-player-inner', {
      width: '100%',
      height: '100%',
      videoId: videoId,
      playerVars: {
        autoplay: 1,
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
          event.target.setVolume(80);
          console.log('YouTube player created and playing');
        },
        onStateChange: function (event) {
          if (event.data === YT.PlayerState.ENDED) {
            if (videoZoneActive) {
              console.log('YouTube video ended, advancing zone');
              videoZoneActive = false;
              signalVideoZoneComplete();
            }
          }
        },
        onError: function (event) {
          console.error('YouTube player error:', event.data);
          if (videoZoneActive) {
            videoZoneActive = false;
            signalVideoZoneComplete();
          }
        }
      }
    });
  }

  /**
   * Destroy the YouTube player completely and clean up the container.
   * After this, no YouTube iframe exists — no stale events possible.
   */
  function destroyYouTubePlayer() {
    if (ytPlayer) {
      try { ytPlayer.destroy(); } catch (e) {}
      ytPlayer = null;
    }
    // Remove any leftover elements in the container
    var container = document.getElementById('yt-container');
    if (container) {
      container.innerHTML = '';
    }
  }

  /**
   * Build or refresh the media queue from current playlists/reels.
   * Queue order: all YouTube videos first, then all reels.
   * Only rebuilds if content has changed (avoids resetting position).
   */
  function refreshMediaQueue() {
    var newQueue = [];

    // Separate focus videos from normal videos
    var focusItems = [];
    var normalItems = [];

    for (var i = 0; i < videoPlaylist.length; i++) {
      if (videoPlaylist[i].focus) {
        focusItems.push({ type: 'youtube', index: i });
      } else {
        normalItems.push({ type: 'youtube', index: i });
      }
    }
    if (reelsEnabled) {
      for (var j = 0; j < reelsList.length; j++) {
        normalItems.push({ type: 'reel', index: j });
      }
    }

    if (focusItems.length === 0) {
      // No focus videos — build queue as before (all YouTube then all reels)
      for (var k = 0; k < videoPlaylist.length; k++) {
        newQueue.push({ type: 'youtube', index: k });
      }
      if (reelsEnabled) {
        for (var l = 0; l < reelsList.length; l++) {
          newQueue.push({ type: 'reel', index: l });
        }
      }
    } else {
      // Interleave: focus[0], normal[0], focus[1], normal[1], ...
      var queueLen = 2 * Math.max(focusItems.length, normalItems.length);
      if (normalItems.length === 0) queueLen = focusItems.length;
      var fi = 0;
      var ni = 0;
      for (var m = 0; m < queueLen; m++) {
        if (normalItems.length === 0) {
          // Only focus videos exist
          newQueue.push(focusItems[fi % focusItems.length]);
          fi++;
        } else if (m % 2 === 0) {
          // Focus slot
          newQueue.push(focusItems[fi % focusItems.length]);
          fi++;
        } else {
          // Normal slot
          newQueue.push(normalItems[ni % normalItems.length]);
          ni++;
        }
      }
    }

    // Only reset position if queue content changed
    if (JSON.stringify(newQueue) !== JSON.stringify(mediaQueue)) {
      mediaQueue = newQueue;
      if (mediaQueuePos >= mediaQueue.length) {
        mediaQueuePos = 0;
      }
    }
  }

  /**
   * Called when video zone becomes active — plays ONE item per rotation visit.
   * Cycles through: YouTube video 1, YouTube video 2, ..., Reel 1, Reel 2, ..., repeat.
   */
  function onVideoZoneActive() {
    videoZoneActive = true;

    // Fetch both videos and reels in parallel
    Promise.all([
      fetch('/api/videos').then(function (res) { return res.json(); }),
      fetch('/api/reels').then(function (res) { return res.json(); })
    ])
      .then(function (results) {
        // Bail out if zone was deactivated while fetching
        if (!videoZoneActive) return;

        var videoData = results[0];
        var reelsData = results[1];

        videoPlaylist = videoData.videos || [];
        reelsList = reelsData.reels || [];
        reelsEnabled = reelsData.enabled || false;

        refreshMediaQueue();

        if (mediaQueue.length === 0) {
          // No content at all — show fallback message
          showVideoOverlay('video-no-content');
          console.log('No videos configured, showing fallback');
          return;
        }

        // Play the current item in the queue
        var item = mediaQueue[mediaQueuePos];
        console.log('Video zone: playing item ' + (mediaQueuePos + 1) + '/' + mediaQueue.length + ' (' + item.type + ')');

        if (item.type === 'youtube') {
          // Hide any overlay so YouTube player is visible underneath
          hideAllVideoOverlays();

          var video = videoPlaylist[item.index];
          console.log('Playing YouTube: ' + video.title);

          if (window._youtubeAPIReady) {
            createFreshYouTubePlayer(video.videoId);
          } else {
            console.warn('YouTube API not ready yet');
            showVideoOverlay('video-no-content');
          }
        } else if (item.type === 'reel') {
          // Show reels player overlay (covers YouTube container)
          destroyYouTubePlayer();
          showVideoOverlay('reels-player');

          var reel = reelsList[item.index];
          console.log('Playing Reel: ' + reel.filename);
          playSingleReel(reel);
        }

        // Advance queue position for next rotation visit
        mediaQueuePos = (mediaQueuePos + 1) % mediaQueue.length;
      })
      .catch(function (err) {
        console.error('Failed to fetch video/reels data:', err);
        showVideoOverlay('video-no-content');
      });
  }

  /**
   * Called when video zone becomes inactive — destroy all players.
   */
  function onVideoZoneInactive() {
    videoZoneActive = false;

    // Destroy YouTube player completely (removes iframe from DOM)
    destroyYouTubePlayer();

    // Pause and clear Reels
    var reelsVideo = document.getElementById('reels-player');
    if (reelsVideo) {
      reelsVideo.pause();
      reelsVideo.removeAttribute('src');
    }
  }

  /**
   * Signal that the video zone has finished its content.
   * Advances locally (same as timer-based zones) and syncs with server.
   */
  function signalVideoZoneComplete() {
    console.log('Signaling video zone complete');
    advanceZone();
  }

  /**
   * Show an overlay element inside the video zone (reels-player or video-no-content).
   */
  function showVideoOverlay(elementId) {
    hideAllVideoOverlays();
    var el = document.getElementById(elementId);
    if (el) {
      el.classList.remove('hidden');
    }
  }

  /**
   * Hide all overlay elements in the video zone.
   */
  function hideAllVideoOverlays() {
    var el;
    el = document.getElementById('reels-player');
    if (el) el.classList.add('hidden');
    el = document.getElementById('video-no-content');
    if (el) el.classList.add('hidden');
  }

  /**
   * Initialize the Reels player and attach event listeners.
   */
  function initReelsPlayer() {
    var video = document.getElementById('reels-player');
    if (!video) return;

    video.addEventListener('ended', function () {
      if (!videoZoneActive) return;
      console.log('Reel ended, advancing zone');
      videoZoneActive = false;
      signalVideoZoneComplete();
    });
  }

  /**
   * Play a single reel and advance zone when it ends.
   */
  function playSingleReel(reel) {
    var video = document.getElementById('reels-player');
    if (!video) return;

    video.src = '/api/reels/files/' + reel.filename;
    var playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(function (err) {
        console.error('Reel play failed:', err.message);
        // If play fails, advance zone after a short delay
        setTimeout(function () {
          if (videoZoneActive) {
            videoZoneActive = false;
            signalVideoZoneComplete();
          }
        }, 2000);
      });
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
        classMetaEl.textContent = data.classInfo.startTime + ' \u2013 ' + data.classInfo.endTime;
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
   * Called when roster zone becomes active.
   * Skips this zone if MindBody isn't configured or no class is in session.
   * Uses setTimeout to avoid re-entrant advanceZone calls inside showZone.
   */
  function onRosterZoneActive() {
    if (!mindbodyConfigured) {
      console.log('Roster zone: MindBody not configured, skipping');
      setTimeout(advanceZone, 0);
      return;
    }

    // Fetch roster data; skip zone if no class in session
    fetch('/api/roster')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.classInfo) {
          console.log('Roster zone: no class in session, skipping');
          advanceZone();
          return;
        }
        // Class is active — show roster and start polling
        updateRosterDisplay(data);
        rosterLastData = data;
        rosterPollTimer = setInterval(pollRoster, 10000);
      })
      .catch(function(err) {
        console.error('Roster zone: API error, skipping \u2014', err.message);
        advanceZone();
      });
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

  // ─── Leaderboard zone ───────────────────────────────────────

  /**
   * Show one leaderboard-state element, hide all others.
   */
  function showLeaderboardState(stateId) {
    var states = document.querySelectorAll('.leaderboard-state');
    states.forEach(function(el) { el.classList.add('hidden'); });
    var target = document.getElementById(stateId);
    if (target) { target.classList.remove('hidden'); }
  }

  /**
   * Get rank suffix for display (1st, 2nd, 3rd, etc.)
   */
  function getRankLabel(rank) {
    if (rank === 1) return '1st';
    if (rank === 2) return '2nd';
    if (rank === 3) return '3rd';
    return rank + 'th';
  }

  /**
   * Update the leaderboard display with fetched data.
   */
  function updateLeaderboardDisplay(data) {
    if (!data || !data.active || !data.teams || !data.teams.length) {
      showLeaderboardState('leaderboard-empty');
      return;
    }

    showLeaderboardState('leaderboard-display');

    // Update title from API if provided
    if (data.title) {
      var titleEl = document.getElementById('leaderboard-title');
      if (titleEl) titleEl.textContent = data.title;
    }

    var container = document.getElementById('leaderboard-teams');
    if (!container) return;
    container.innerHTML = '';

    data.teams.forEach(function(team) {
      var card = document.createElement('div');
      card.className = 'leaderboard-team-card';
      card.style.setProperty('--team-color', team.color || '#888');
      if (team.rank === 1) {
        card.classList.add('first-place');
      }

      // Rank badge
      var rankEl = document.createElement('div');
      rankEl.className = 'leaderboard-rank';
      rankEl.textContent = getRankLabel(team.rank);
      card.appendChild(rankEl);

      // Team name
      var nameEl = document.createElement('div');
      nameEl.className = 'leaderboard-team-name';
      nameEl.textContent = team.name;
      card.appendChild(nameEl);

      // Team total
      var totalEl = document.createElement('div');
      totalEl.className = 'leaderboard-team-total';
      totalEl.textContent = team.total;
      var ptsLabel = document.createElement('span');
      ptsLabel.className = 'pts-label';
      ptsLabel.textContent = 'pts';
      totalEl.appendChild(ptsLabel);
      card.appendChild(totalEl);

      // Divider
      var divider = document.createElement('div');
      divider.className = 'leaderboard-divider';
      card.appendChild(divider);

      // Members list
      var membersEl = document.createElement('div');
      membersEl.className = 'leaderboard-members';

      // Apply density class based on member count
      var memberCount = team.members ? team.members.length : 0;
      if (memberCount >= 16) {
        membersEl.classList.add('leaderboard-members-dense');
      } else if (memberCount >= 9) {
        membersEl.classList.add('leaderboard-members-compact');
      }

      if (team.members) {
        team.members.forEach(function(member) {
          var row = document.createElement('div');
          row.className = 'leaderboard-member-row';

          var memberName = document.createElement('span');
          memberName.className = 'leaderboard-member-name';
          memberName.textContent = member.name;
          row.appendChild(memberName);

          var memberPts = document.createElement('span');
          memberPts.className = 'leaderboard-member-points';
          memberPts.textContent = member.points;
          row.appendChild(memberPts);

          membersEl.appendChild(row);
        });
      }

      card.appendChild(membersEl);
      container.appendChild(card);
    });

    // After rendering, check each members list for overflow and switch to two columns
    requestAnimationFrame(function() {
      var memberLists = container.querySelectorAll('.leaderboard-members');
      memberLists.forEach(function(el) {
        if (el.scrollHeight > el.clientHeight) {
          el.classList.add('leaderboard-members-twocol');
        }
      });
    });
  }

  /**
   * Poll /api/leaderboard for updated team standings.
   */
  function pollLeaderboard() {
    fetch('/api/leaderboard')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        updateLeaderboardDisplay(data);
        leaderboardLastData = data;
      })
      .catch(function(err) {
        console.error('Leaderboard poll failed:', err);
        // Keep showing stale data if we have it
      });
  }

  /**
   * Called when leaderboard zone becomes active.
   * Skips zone if leaderboard isn't configured.
   */
  function onLeaderboardZoneActive() {
    if (!leaderboardConfigured) {
      console.log('Leaderboard zone: not configured, skipping');
      setTimeout(advanceZone, 0);
      return;
    }

    fetch('/api/leaderboard')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.active || !data.teams || !data.teams.length) {
          console.log('Leaderboard zone: no active competition, skipping');
          advanceZone();
          return;
        }
        updateLeaderboardDisplay(data);
        leaderboardLastData = data;
        leaderboardPollTimer = setInterval(pollLeaderboard, 30000);
      })
      .catch(function(err) {
        console.error('Leaderboard zone: API error, skipping —', err.message);
        advanceZone();
      });
  }

  /**
   * Called when leaderboard zone becomes inactive — stop polling.
   */
  function onLeaderboardZoneInactive() {
    if (leaderboardPollTimer) {
      clearInterval(leaderboardPollTimer);
      leaderboardPollTimer = null;
    }
  }

  // ─── Announcements zone ──────────────────────────────────────

  /**
   * Show one announcements-state element, hide all others.
   */
  function showAnnouncementsState(stateId) {
    var states = document.querySelectorAll('.announcements-state');
    states.forEach(function(el) { el.classList.add('hidden'); });
    var target = document.getElementById(stateId);
    if (target) { target.classList.remove('hidden'); }
  }

  /**
   * Update the announcements display with fetched data.
   */
  function updateAnnouncementsDisplay(data) {
    if (!data || !data.active || !data.announcements || !data.announcements.length) {
      showAnnouncementsState('announcements-empty');
      return;
    }

    showAnnouncementsState('announcements-display');

    var container = document.getElementById('announcements-list');
    if (!container) return;
    container.innerHTML = '';

    // Apply compact class if many announcements
    container.classList.remove('announcements-compact');
    if (data.announcements.length > 4) {
      container.classList.add('announcements-compact');
    }

    data.announcements.forEach(function(announcement) {
      var card = document.createElement('div');
      card.className = 'announcement-card';
      card.setAttribute('data-priority', announcement.priority || 'normal');

      if (announcement.priority === 'urgent') {
        card.classList.add('announcement-urgent');
      }

      if (announcement.title) {
        var titleEl = document.createElement('div');
        titleEl.className = 'announcement-title';
        titleEl.textContent = announcement.title;
        card.appendChild(titleEl);
      }

      if (announcement.body) {
        var bodyEl = document.createElement('div');
        bodyEl.className = 'announcement-body';
        bodyEl.textContent = announcement.body;
        card.appendChild(bodyEl);
      }

      container.appendChild(card);
    });
  }

  /**
   * Poll /api/announcements for updated announcement data.
   */
  function pollAnnouncements() {
    fetch('/api/announcements')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        updateAnnouncementsDisplay(data);
        announcementsLastData = data;
      })
      .catch(function(err) {
        console.error('Announcements poll failed:', err);
        // Keep showing stale data if we have it
      });
  }

  /**
   * Called when announcements zone becomes active.
   * Skips zone if announcements aren't configured or no active announcements.
   */
  function onAnnouncementsZoneActive() {
    if (!announcementsConfigured) {
      console.log('Announcements zone: not configured, skipping');
      setTimeout(advanceZone, 0);
      return;
    }

    fetch('/api/announcements')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || !data.active || !data.announcements || !data.announcements.length) {
          console.log('Announcements zone: no active announcements, skipping');
          advanceZone();
          return;
        }
        updateAnnouncementsDisplay(data);
        announcementsLastData = data;
        announcementsPollTimer = setInterval(pollAnnouncements, 30000);
      })
      .catch(function(err) {
        console.error('Announcements zone: API error, skipping —', err.message);
        advanceZone();
      });
  }

  /**
   * Called when announcements zone becomes inactive — stop polling.
   */
  function onAnnouncementsZoneInactive() {
    if (announcementsPollTimer) {
      clearInterval(announcementsPollTimer);
      announcementsPollTimer = null;
    }
  }

  /**
   * Show a zone by name, triggering CSS crossfade transition.
   */
  function showZone(zoneName) {
    // Deactivate the outgoing zone (based on what's currently active, not currentIndex)
    var activeEl = document.querySelector('.zone.active');
    var previousZone = activeEl ? activeEl.id.replace('zone-', '') : null;

    var zones = document.querySelectorAll('.zone');
    zones.forEach(function (z) { z.classList.remove('active'); });

    var target = document.getElementById('zone-' + zoneName);
    if (target) {
      target.classList.add('active');
    }

    // Deactivate previous zone
    if (previousZone && previousZone !== zoneName) {
      if (previousZone === 'wod') onWodZoneInactive();
      if (previousZone === 'video') onVideoZoneInactive();
      if (previousZone === 'roster') onRosterZoneInactive();
      if (previousZone === 'leaderboard') onLeaderboardZoneInactive();
      if (previousZone === 'announcements') onAnnouncementsZoneInactive();
    }

    // Activate new zone
    if (zoneName === 'wod') onWodZoneActive();
    if (zoneName === 'video') onVideoZoneActive();
    if (zoneName === 'roster') onRosterZoneActive();
    if (zoneName === 'leaderboard') onLeaderboardZoneActive();
    if (zoneName === 'announcements') onAnnouncementsZoneActive();
  }

  /**
   * Advance to the next zone and schedule the following transition.
   * Also syncs server-side zone controller to stay in lock-step.
   */
  function advanceZone() {
    var fromZone = rotationOrder[currentIndex];
    var skipped = 0;
    var nextIndex = (currentIndex + 1) % rotationOrder.length;

    // Skip unhealthy zones (cycle guard: never skip more than full rotation)
    while (skipped < rotationOrder.length) {
      var candidate = rotationOrder[nextIndex];
      if (zoneHealth[candidate] === 'unhealthy') {
        console.log('Skipping unhealthy zone: ' + candidate);
        skipped++;
        nextIndex = (nextIndex + 1) % rotationOrder.length;
      } else {
        break;
      }
    }

    if (skipped > 0 && skipped < rotationOrder.length) {
      console.log('Skipped ' + skipped + ' unhealthy zone(s)');
    } else if (skipped >= rotationOrder.length) {
      console.log('All zones unhealthy \u2014 showing next zone anyway');
    }

    currentIndex = nextIndex;
    var toZone = rotationOrder[currentIndex];

    console.log('Zone transition: ' + fromZone + ' \u2192 ' + toZone);
    showZone(toZone);
    scheduleNext();

    // Sync server-side zone controller (fire-and-forget, marked as kiosk to not bump admin version)
    fetch('/api/zones/advance?source=kiosk', { method: 'POST' }).catch(function () {});
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
        advanceZone();
      }, duration);
    } else {
      // Standard fixed timer
      rotationTimer = setTimeout(advanceZone, duration);
    }
  }

  /**
   * Poll server zone state to detect admin-triggered advances.
   */
  function pollZoneState() {
    fetch('/api/zones')
      .then(function(res) { return res.json(); })
      .then(function(state) {
        if (state.advanceVersion && state.advanceVersion > lastAdvanceVersion) {
          lastAdvanceVersion = state.advanceVersion;
          // Admin advanced — jump to server's current zone
          var serverZone = state.currentZone;
          var idx = rotationOrder.indexOf(serverZone);
          if (idx !== -1 && idx !== currentIndex) {
            console.log('Admin advance detected — jumping to: ' + serverZone);
            currentIndex = idx;
            showZone(serverZone);
            scheduleNext();
          }
        }
        if (state.refreshVersion && state.refreshVersion > lastRefreshVersion) {
          lastRefreshVersion = state.refreshVersion;
          // Admin refreshed a service — reload current zone data
          var zone = rotationOrder[currentIndex];
          console.log('Admin refresh detected — reloading zone: ' + zone);
          showZone(zone);
          scheduleNext();
        }
      })
      .catch(function() {});
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
        durations.leaderboard = ((zones.leaderboard && zones.leaderboard.duration_seconds) || 90) * 1000;

        // Update play_full setting
        videoPlayFull = !!(zones.video && zones.video.play_full);

        // Update Instagram settings
        var ig = config.instagram || {};
        reelsMinDisplaySeconds = ig.min_display_seconds || 30;

        // Update MindBody configuration status
        var mb = config.mindbody || {};
        mindbodyConfigured = !!mb.configured;

        // Update leaderboard configuration status
        var lb = config.leaderboard || {};
        leaderboardConfigured = !!lb.active;

        // Update announcements duration and configuration status
        durations.announcements = ((zones.announcements && zones.announcements.duration_seconds) || 60) * 1000;
        var ann = config.announcements || {};
        announcementsConfigured = !!ann.active;

        // Update zone health status
        var health = config.health || {};
        zoneHealth = (health && health.zones) || {};

        // Log boost state changes
        var boostActive = !!zones.boostActive;
        if (boostActive !== lastBoostActive) {
          console.log('Roster boost ' + (boostActive ? 'ACTIVATED' : 'DEACTIVATED') + ' \u2014 rotation: [' + rotationOrder.join(', ') + ']');
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
   * Load WOD via live iframe. This is the only WOD display mode —
   * WODscreen must play live (videos, dynamic content) just like the video zone.
   * Shows "Connecting..." until the scraper authenticates and the iframe loads.
   */
  function tryWodIframe(wodPageUrl) {
    if (wodMode === 'iframe' && wodIframeLoaded) {
      return; // already showing live iframe
    }

    var iframe = document.getElementById('wod-iframe');
    if (!iframe) return;

    wodIframeLoaded = false;

    // If iframe doesn't load within 15s, stay on loading (poll will retry)
    var iframeTimeout = setTimeout(function () {
      if (!wodIframeLoaded) {
        console.log('WOD iframe load timeout \u2014 will retry on next poll');
        // Reset src so next poll attempt can retry
        iframe.src = '';
        wodMode = 'loading';
        showWodElement('wod-loading');
      }
    }, 15000);

    iframe.onload = function () {
      clearTimeout(iframeTimeout);
      // Ignore the blank load when we clear src
      if (!iframe.src || iframe.src === window.location.origin + '/' || iframe.src === 'about:blank') {
        return;
      }
      wodIframeLoaded = true;
      wodMode = 'iframe';
      showWodElement('wod-iframe');
      console.log('WOD iframe loaded \u2014 live content active');
    };

    iframe.onerror = function () {
      clearTimeout(iframeTimeout);
      console.log('WOD iframe error \u2014 will retry on next poll');
      wodMode = 'loading';
      showWodElement('wod-loading');
    };

    // Set iframe src to the pre-rendered WOD HTML (bypasses SPA auth issues)
    var renderedPath = '/api/wod/rendered';
    if (iframe.src !== window.location.origin + renderedPath) {
      iframe.src = renderedPath;
    }
  }

  /**
   * Poll WOD status and update display accordingly.
   * Only mode is live iframe — we wait for cookies, then load it.
   * No screenshot fallback: WODscreen must be live to be useful.
   */
  function pollWodStatus() {
    fetch('/api/wod/status')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        console.log('WOD status:', data.status, data.hasCookies ? '(cookies ready)' : '');

        if (data.hasCookies && data.wodPageUrl) {
          // We have auth — load the live iframe
          if (wodMode !== 'iframe' || !wodIframeLoaded) {
            tryWodIframe(data.wodPageUrl);
          }
        } else if (data.status === 'no-credentials') {
          // Can never connect — show error
          wodMode = 'error';
          showWodElement('wod-error');
        } else {
          // Still starting up (idle, launched, error with retry) — keep showing loading
          if (wodMode !== 'iframe') {
            wodMode = 'loading';
            showWodElement('wod-loading');
          }
        }

        wodLastStatus = data.status;
      })
      .catch(function (err) {
        console.error('WOD status poll failed:', err);
      });
  }

  /**
   * Initialize WOD display management.
   */
  function initWod() {
    showWodElement('wod-loading');
    wodMode = 'loading';

    // Poll status every 10 seconds until iframe is live
    pollWodStatus();
    wodStatusPollTimer = setInterval(pollWodStatus, 10000);
  }

  /**
   * Called when WOD zone becomes active — check status immediately.
   */
  function onWodZoneActive() {
    pollWodStatus();
  }

  /**
   * Called when WOD zone becomes inactive.
   */
  function onWodZoneInactive() {
    // Nothing to pause — iframe stays live in background
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
        durations.leaderboard = ((zones.leaderboard && zones.leaderboard.duration_seconds) || 90) * 1000;

        // Read play_full setting
        videoPlayFull = !!(zones.video && zones.video.play_full);

        // Read Instagram settings
        var ig = config.instagram || {};
        reelsMinDisplaySeconds = ig.min_display_seconds || 30;

        // Read MindBody configuration status
        var mb = config.mindbody || {};
        mindbodyConfigured = !!mb.configured;

        // Read leaderboard configuration status
        var lb = config.leaderboard || {};
        leaderboardConfigured = !!lb.active;

        // Read announcements configuration status
        durations.announcements = ((zones.announcements && zones.announcements.duration_seconds) || 60) * 1000;
        var ann = config.announcements || {};
        announcementsConfigured = !!ann.active;

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

        // Initialize leaderboard state
        if (!leaderboardConfigured) {
          showLeaderboardState('leaderboard-empty');
        } else {
          showLeaderboardState('leaderboard-loading');
        }

        // Initialize announcements state
        if (!announcementsConfigured) {
          showAnnouncementsState('announcements-empty');
        } else {
          showAnnouncementsState('announcements-loading');
        }

        // Start with first zone
        currentIndex = 0;
        var firstZone = rotationOrder[0];
        console.log('Zone rotation started: ' + firstZone);
        showZone(firstZone);
        scheduleNext();

        // Poll for config changes every 30 seconds
        setInterval(fetchConfig, 30000);
        // Poll for admin zone advances every 2 seconds
        setInterval(pollZoneState, 2000);
      })
      .catch(function (err) {
        console.error('Initial config fetch failed:', err);
        // Fallback: start with defaults
        showZone(rotationOrder[0]);
        scheduleNext();
        setInterval(fetchConfig, 30000);
        setInterval(pollZoneState, 2000);
      });
  }

  // Start on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
