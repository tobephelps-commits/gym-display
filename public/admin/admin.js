/* ── BigBarn Admin Panel JavaScript ── */

(function () {
  'use strict';

  // ── API Helper ──
  // Wraps fetch with /api/admin/ prefix, error handling, and JSON parsing.
  async function api(url, options) {
    const fullUrl = '/api/admin/' + url.replace(/^\//, '');
    const defaults = {
      headers: { 'Content-Type': 'application/json' }
    };
    const opts = Object.assign({}, defaults, options);

    const response = await fetch(fullUrl, opts);
    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error || data.message || 'Request failed';
      throw new Error(errMsg);
    }

    return data;
  }

  // ── Toast Notification ──
  let toastTimer = null;

  function showToast(message, type) {
    type = type || 'success';
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' visible';

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('visible');
    }, 3000);
  }

  // ── Format Helpers ──

  /**
   * Converts seconds to "Xd Xh Xm" format.
   */
  function formatUptime(seconds) {
    var s = Math.floor(seconds);
    var days = Math.floor(s / 86400);
    var hours = Math.floor((s % 86400) / 3600);
    var minutes = Math.floor((s % 3600) / 60);

    var parts = [];
    if (days > 0) parts.push(days + 'd');
    if (hours > 0) parts.push(hours + 'h');
    parts.push(minutes + 'm');
    return parts.join(' ');
  }

  /**
   * Converts ISO timestamp to relative "X min ago" format.
   */
  function formatTimestamp(iso) {
    if (!iso) return 'never';

    var then = new Date(iso);
    var now = new Date();
    var diffMs = now - then;
    var diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return 'just now';
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + ' min ago';
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    var diffDay = Math.floor(diffHr / 24);
    return diffDay + 'd ago';
  }

  // ── Tab Navigation ──
  var tabs = document.querySelectorAll('.nav-tab');
  var pages = document.querySelectorAll('.page-section');

  function switchTab(pageName) {
    tabs.forEach(function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-page') === pageName);
    });
    pages.forEach(function (page) {
      page.classList.toggle('hidden', page.id !== 'page-' + pageName);
    });
    window.location.hash = pageName;
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      switchTab(tab.getAttribute('data-page'));
    });
  });

  // On load: read URL hash to show correct tab, default to dashboard
  var initialPage = window.location.hash.replace('#', '') || 'dashboard';
  if (!document.getElementById('page-' + initialPage)) {
    initialPage = 'dashboard';
  }
  switchTab(initialPage);

  // ── Uptime Badge ──
  function updateUptime() {
    api('status')
      .then(function (data) {
        var badge = document.getElementById('uptime-badge');
        badge.textContent = 'Up ' + formatUptime(data.uptime);
      })
      .catch(function () {
        // Silent fail — badge shows stale data
      });
  }

  updateUptime();
  setInterval(updateUptime, 60000);

  // ── Expose to window for page-specific code ──
  window.AdminApp = {
    api: api,
    showToast: showToast,
    formatUptime: formatUptime,
    formatTimestamp: formatTimestamp
  };

  // ══════════════════════════════════════════════
  // ── Settings Page Logic ──
  // ══════════════════════════════════════════════

  var ALL_ZONES = ['wod', 'video', 'roster', 'leaderboard', 'announcements'];
  var currentConfig = null;

  // ── Load full config and populate all settings forms ──
  function loadSettings() {
    api('config/full')
      .then(function (cfg) {
        currentConfig = cfg;
        populateZoneSettings(cfg);
        populatePlaylist(cfg);
        populateSystemSettings(cfg);
      })
      .catch(function (err) {
        showToast('Failed to load config: ' + err.message, 'error');
      });
  }

  // ── Zone Settings ──

  function populateZoneSettings(cfg) {
    var zones = cfg.zones || {};
    var order = zones.rotation_order || ALL_ZONES.slice();

    // Durations
    setVal('duration-wod', zones.wod && zones.wod.duration_seconds);
    setVal('duration-roster', zones.roster && zones.roster.duration_seconds);
    setVal('duration-leaderboard', zones.leaderboard && zones.leaderboard.duration_seconds);
    setVal('duration-announcements', zones.announcements && zones.announcements.duration_seconds);

    // Leaderboard title
    var lbConfig = config.leaderboard || {};
    setVal('leaderboard-title', lbConfig.title || '');

    // Video zone
    var vid = zones.video || {};
    document.getElementById('video-play-full').checked = !!vid.play_full;
    setVal('video-fallback', vid.fallback_seconds);

    // Roster boost
    var roster = zones.roster || {};
    setVal('boost-minutes', roster.boost_before_class_minutes);
    setVal('boost-frequency', roster.boost_frequency);

    // Rotation order list
    renderZoneOrderList(order);
  }

  function renderZoneOrderList(order) {
    var ul = document.getElementById('zone-order-list');
    ul.innerHTML = '';

    // Build full list: ordered zones first, then any missing zones (unchecked)
    var fullList = order.slice();
    ALL_ZONES.forEach(function (z) {
      if (fullList.indexOf(z) === -1) fullList.push(z);
    });

    fullList.forEach(function (zone, idx) {
      var li = document.createElement('li');
      li.className = 'zone-order-item';
      li.setAttribute('data-zone', zone);

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = order.indexOf(zone) !== -1;
      cb.style.cssText = 'width:16px;height:16px;accent-color:#4a9eff;';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'zone-name';
      nameSpan.textContent = zone;

      var arrows = document.createElement('span');
      arrows.className = 'zone-arrows';

      var upBtn = document.createElement('button');
      upBtn.innerHTML = '&#9650;';
      upBtn.title = 'Move up';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', function () { moveZone(zone, -1); });

      var downBtn = document.createElement('button');
      downBtn.innerHTML = '&#9660;';
      downBtn.title = 'Move down';
      downBtn.disabled = idx === fullList.length - 1;
      downBtn.addEventListener('click', function () { moveZone(zone, 1); });

      arrows.appendChild(upBtn);
      arrows.appendChild(downBtn);

      li.appendChild(cb);
      li.appendChild(nameSpan);
      li.appendChild(arrows);
      ul.appendChild(li);
    });
  }

  function moveZone(zone, direction) {
    var items = document.querySelectorAll('.zone-order-item');
    var list = [];
    items.forEach(function (item) { list.push(item.getAttribute('data-zone')); });

    var idx = list.indexOf(zone);
    var newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= list.length) return;

    list.splice(idx, 1);
    list.splice(newIdx, 0, zone);
    renderZoneOrderList(getCheckedZones(list));
  }

  function getCheckedZones(fullList) {
    // If fullList not provided, read from DOM
    if (!fullList) {
      var items = document.querySelectorAll('.zone-order-item');
      fullList = [];
      items.forEach(function (item) { fullList.push(item.getAttribute('data-zone')); });
    }

    // Get current checkbox states from DOM before re-render
    var checkedMap = {};
    var existingItems = document.querySelectorAll('.zone-order-item');
    existingItems.forEach(function (item) {
      var z = item.getAttribute('data-zone');
      var cb = item.querySelector('input[type="checkbox"]');
      checkedMap[z] = cb ? cb.checked : true;
    });

    var checked = [];
    fullList.forEach(function (z) {
      if (checkedMap[z] !== false) checked.push(z);
    });
    return checked;
  }

  function getCurrentRotationOrder() {
    var items = document.querySelectorAll('.zone-order-item');
    var order = [];
    items.forEach(function (item) {
      var cb = item.querySelector('input[type="checkbox"]');
      if (cb && cb.checked) {
        order.push(item.getAttribute('data-zone'));
      }
    });
    return order;
  }

  function collectZoneSettings() {
    var errors = [];

    var wodDur = getNumVal('duration-wod', 'WOD Duration', errors);
    var rosterDur = getNumVal('duration-roster', 'Roster Duration', errors);
    var lbDur = getNumVal('duration-leaderboard', 'Leaderboard Duration', errors);
    var annDur = getNumVal('duration-announcements', 'Announcements Duration', errors);
    var fallback = getNumVal('video-fallback', 'Video Fallback Duration', errors);
    var boostMin = getNumVal('boost-minutes', 'Boost Minutes', errors, true);
    var boostFreq = getNumVal('boost-frequency', 'Boost Frequency', errors);

    var order = getCurrentRotationOrder();
    if (order.length === 0) {
      errors.push('At least one zone must be in rotation');
    }

    if (errors.length > 0) return { errors: errors };

    return {
      data: {
        zones: {
          rotation_order: order,
          wod: { duration_seconds: wodDur },
          video: {
            play_full: document.getElementById('video-play-full').checked,
            fallback_seconds: fallback
          },
          roster: {
            duration_seconds: rosterDur,
            boost_before_class_minutes: boostMin,
            boost_frequency: boostFreq
          },
          leaderboard: { duration_seconds: lbDur },
          announcements: { duration_seconds: annDur }
        },
        leaderboard: { title: (document.getElementById('leaderboard-title') || {}).value || '' }
      }
    };
  }

  // ── Video Playlist ──

  var playlistVideos = [];

  function populatePlaylist(cfg) {
    // Check if source is sheets
    api('status').then(function (status) {
      if (status.videos && status.videos.source === 'sheets') {
        document.getElementById('playlist-sheets-msg').style.display = 'block';
        document.getElementById('playlist-config-section').style.display = 'none';
      } else {
        document.getElementById('playlist-sheets-msg').style.display = 'none';
        document.getElementById('playlist-config-section').style.display = 'block';
        playlistVideos = (cfg.videos || []).map(function (v) {
          return { url: v.url, title: v.title, enabled: v.enabled !== false, days: v.days || '' };
        });
        renderPlaylist();
      }
    }).catch(function () {
      // Fallback: show config-based playlist
      playlistVideos = (cfg.videos || []).map(function (v) {
        return { url: v.url, title: v.title, enabled: v.enabled !== false, days: v.days || '' };
      });
      renderPlaylist();
    });
  }

  function renderPlaylist() {
    var tbody = document.getElementById('playlist-tbody');
    tbody.innerHTML = '';

    playlistVideos.forEach(function (vid, idx) {
      var tr = document.createElement('tr');

      var tdTitle = document.createElement('td');
      tdTitle.textContent = vid.title || '(untitled)';

      var tdUrl = document.createElement('td');
      tdUrl.className = 'url-cell';
      tdUrl.textContent = vid.url;
      tdUrl.title = vid.url;

      var tdEnabled = document.createElement('td');
      var enabledCb = document.createElement('input');
      enabledCb.type = 'checkbox';
      enabledCb.checked = vid.enabled;
      enabledCb.style.cssText = 'width:16px;height:16px;accent-color:#4a9eff;';
      enabledCb.addEventListener('change', function () {
        playlistVideos[idx].enabled = enabledCb.checked;
      });
      tdEnabled.appendChild(enabledCb);

      var tdDays = document.createElement('td');
      var daysInput = document.createElement('input');
      daysInput.type = 'text';
      daysInput.placeholder = 'e.g. Mon,Wed,Fri';
      daysInput.value = vid.days || '';
      daysInput.style.cssText = 'width:120px;font-size:12px;';
      daysInput.addEventListener('change', function () {
        playlistVideos[idx].days = daysInput.value.trim();
      });
      tdDays.appendChild(daysInput);

      var tdRemove = document.createElement('td');
      var removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove';
      removeBtn.textContent = 'X';
      removeBtn.title = 'Remove video';
      removeBtn.addEventListener('click', function () {
        if (confirm('Remove "' + (vid.title || vid.url) + '" from playlist?')) {
          playlistVideos.splice(idx, 1);
          renderPlaylist();
        }
      });
      tdRemove.appendChild(removeBtn);

      tr.appendChild(tdTitle);
      tr.appendChild(tdUrl);
      tr.appendChild(tdEnabled);
      tr.appendChild(tdDays);
      tr.appendChild(tdRemove);
      tbody.appendChild(tr);
    });
  }

  // Add video form toggle
  var addVideoBtn = document.getElementById('add-video-btn');
  var addVideoForm = document.getElementById('add-video-form');

  if (addVideoBtn) {
    addVideoBtn.addEventListener('click', function () {
      addVideoForm.style.display = 'block';
      addVideoBtn.style.display = 'none';
      document.getElementById('new-video-title').value = '';
      document.getElementById('new-video-url').value = '';
      clearError('new-video-url');
    });
  }

  var cancelAddVideo = document.getElementById('cancel-add-video');
  if (cancelAddVideo) {
    cancelAddVideo.addEventListener('click', function () {
      addVideoForm.style.display = 'none';
      addVideoBtn.style.display = '';
    });
  }

  var confirmAddVideo = document.getElementById('confirm-add-video');
  if (confirmAddVideo) {
    confirmAddVideo.addEventListener('click', function () {
      var title = document.getElementById('new-video-title').value.trim();
      var url = document.getElementById('new-video-url').value.trim();

      clearError('new-video-url');
      if (!url || !isValidUrl(url)) {
        setError('new-video-url', 'Please enter a valid URL');
        return;
      }

      playlistVideos.push({ url: url, title: title || url, enabled: true, days: '' });
      renderPlaylist();
      addVideoForm.style.display = 'none';
      addVideoBtn.style.display = '';
    });
  }

  // ── System Settings ──

  function populateSystemSettings(cfg) {
    var sys = cfg.system || {};
    setVal('sys-port', sys.port);
    document.getElementById('sys-log-level').value = sys.log_level || 'info';
    setVal('sys-timezone', sys.timezone);
    setVal('sys-screen-off', sys.screen_off_start);
    setVal('sys-screen-on', sys.screen_off_end);
    // Admin token: leave blank (masked on server)
    document.getElementById('sys-admin-token').value = '';
  }

  function collectSystemSettings() {
    var errors = [];
    var logLevel = document.getElementById('sys-log-level').value;
    var timezone = document.getElementById('sys-timezone').value.trim();
    var screenOff = document.getElementById('sys-screen-off').value;
    var screenOn = document.getElementById('sys-screen-on').value;
    var adminToken = document.getElementById('sys-admin-token').value;

    if (!timezone) {
      errors.push('Timezone is required');
      setError('sys-timezone', 'Required');
    } else {
      clearError('sys-timezone');
    }

    if (errors.length > 0) return { errors: errors };

    var data = {
      system: {
        log_level: logLevel,
        timezone: timezone,
        screen_off_start: screenOff,
        screen_off_end: screenOn
      }
    };

    // Only include admin_token if user typed something
    if (adminToken) {
      data.system.admin_token = adminToken;
    }

    return { data: data };
  }

  // ── Save Handlers ──

  function saveSection(collectFn, btnId, successMsg) {
    var btn = document.getElementById(btnId);
    var result = collectFn();

    if (result.errors) {
      showToast(result.errors[0], 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    api('config', {
      method: 'POST',
      body: JSON.stringify(result.data)
    })
      .then(function () {
        showToast(successMsg, 'success');
        // Re-fetch config to confirm
        return api('config/full');
      })
      .then(function (cfg) {
        currentConfig = cfg;
      })
      .catch(function (err) {
        showToast('Save failed: ' + err.message, 'error');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = btn.id.replace('-btn', '').replace('save-', 'Save ').replace('zones', 'Zone Settings').replace('playlist', 'Playlist').replace('system', 'System Settings');
        resetBtnLabel(btn);
      });
  }

  function resetBtnLabel(btn) {
    var labels = {
      'save-zones-btn': 'Save Zone Settings',
      'save-playlist-btn': 'Save Playlist',
      'save-system-btn': 'Save System Settings'
    };
    btn.textContent = labels[btn.id] || 'Save';
  }

  // Save zone settings
  var saveZonesBtn = document.getElementById('save-zones-btn');
  if (saveZonesBtn) {
    saveZonesBtn.addEventListener('click', function () {
      saveSection(collectZoneSettings, 'save-zones-btn', 'Zone settings saved');
    });
  }

  // Save playlist
  var savePlaylistBtn = document.getElementById('save-playlist-btn');
  if (savePlaylistBtn) {
    savePlaylistBtn.addEventListener('click', function () {
      var btn = document.getElementById('save-playlist-btn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      api('config', {
        method: 'POST',
        body: JSON.stringify({ videos: playlistVideos })
      })
        .then(function () {
          showToast('Playlist saved', 'success');
          return api('config/full');
        })
        .then(function (cfg) {
          currentConfig = cfg;
        })
        .catch(function (err) {
          showToast('Save failed: ' + err.message, 'error');
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Save Playlist';
        });
    });
  }

  // Save system settings
  var saveSystemBtn = document.getElementById('save-system-btn');
  if (saveSystemBtn) {
    saveSystemBtn.addEventListener('click', function () {
      saveSection(collectSystemSettings, 'save-system-btn', 'System settings saved');
    });
  }

  // Restore backup
  var restoreBtn = document.getElementById('restore-backup-btn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', function () {
      if (!confirm('Restore config from backup? This will overwrite current settings.')) return;
      restoreBtn.disabled = true;
      api('config/restore', { method: 'POST' })
        .then(function () {
          showToast('Config restored from backup', 'success');
          loadSettings();
        })
        .catch(function (err) {
          showToast('Restore failed: ' + err.message, 'error');
        })
        .finally(function () {
          restoreBtn.disabled = false;
        });
    });
  }

  // ── Helpers ──

  function setVal(id, val) {
    var el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
  }

  function getNumVal(id, label, errors, allowZero) {
    var el = document.getElementById(id);
    var val = parseFloat(el.value);
    clearError(id);
    if (isNaN(val) || (!allowZero && val <= 0) || (allowZero && val < 0)) {
      setError(id, label + ' must be a positive number');
      errors.push(label + ' must be a positive number');
      return null;
    }
    return val;
  }

  function setError(id, msg) {
    var el = document.getElementById('error-' + id);
    if (el) el.textContent = msg;
  }

  function clearError(id) {
    var el = document.getElementById('error-' + id);
    if (el) el.textContent = '';
  }

  function isValidUrl(str) {
    try {
      var u = new URL(str);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  // ── Load settings when settings tab is shown ──
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (tab.getAttribute('data-page') === 'settings' && !currentConfig) {
        loadSettings();
      }
    });
  });

  // Also load if settings is the initial page
  if (initialPage === 'settings') {
    loadSettings();
  }

})();
