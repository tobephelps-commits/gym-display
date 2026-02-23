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
})();
