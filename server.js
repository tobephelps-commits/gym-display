const express = require('express');
const path = require('path');
const configLoader = require('./services/config-loader');

// Load config (exits on failure)
configLoader.loadConfig();
configLoader.startWatching();

const zoneController = require('./services/zone-controller');
const videoManager = require('./services/video-manager');
const reelsFetcher = require('./services/reels-fetcher');
const wodScraper = require('./services/wod-scraper');
const mindbodyClient = require('./services/mindbody');
const sheetsClient = require('./services/sheets-client');
const leaderboardService = require('./services/leaderboard-service');
const announcementsService = require('./services/announcements-service');
const healthMonitor = require('./services/zone-health-monitor');
const notificationService = require('./services/notification-service');
const alertManager = require('./services/alert-manager');
const { createWodProxy } = require('./services/wod-proxy');

const config = configLoader.getConfig();
const port = (config.system && config.system.port) || 3000;

// Health monitor instance — created after server starts
let monitor = null;
let notifications = null;
let alerts = null;

const app = express();
app.use(express.json());

// Mount WodScreen reverse proxy — strips iframe-blocking headers, injects session cookies
app.use('/wod-proxy', createWodProxy(
  () => wodScraper.getCookieString(),
  () => wodScraper.getLocalStorage()
));

// ── Admin Auth Middleware ──
// Checks Bearer token or ?token= query param against system.admin_token config.
// If admin_token is not configured, allows all requests (open access for local Pi).
function adminAuthMiddleware(req, res, next) {
  const current = configLoader.getConfig();
  const adminToken = current.system && current.system.admin_token;

  // No token configured — open access
  if (!adminToken) {
    return next();
  }

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7) === adminToken) {
    return next();
  }

  // Check query param
  if (req.query.token === adminToken) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized — invalid or missing admin token' });
}

// Serve admin static files BEFORE general static middleware
app.use('/admin', adminAuthMiddleware, express.static(path.join(__dirname, 'public', 'admin'), {
  etag: false,
  lastModified: false,
  setHeaders: function (res) {
    res.set('Cache-Control', 'no-store');
  }
}));

// Serve static files from public/ with no-cache headers (ensures code updates load immediately)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: function (res) {
    res.set('Cache-Control', 'no-store');
  }
}));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Zone health status endpoint (no auth — health data is non-sensitive)
app.get('/api/health/zones', (req, res) => {
  if (!monitor) {
    return res.json({ overall: 'unknown', zones: {}, timestamp: new Date().toISOString() });
  }
  res.json(monitor.getHealthStatus());
});

// Config endpoint — returns sanitized config (no credentials)
app.get('/api/config', (req, res) => {
  const current = configLoader.getConfig();

  const sanitized = {
    zones: current.zones || {},
    videos: (current.videos || []).map((v) => ({
      url: v.url,
      title: v.title,
      enabled: v.enabled
    })),
    instagram: {
      enabled: (current.instagram && current.instagram.enabled) || false,
      min_display_seconds: (current.instagram && current.instagram.min_display_seconds) || 30
    },
    mindbody: {
      configured: !!(current.mindbody && current.mindbody.api_key && current.mindbody.api_key !== 'your_api_key')
    },
    sheets: {
      configured: sheetsClient.getStatus().configured
    },
    playlist: {
      source: videoManager.getSource(),
      count: videoManager.getVideoCount()
    },
    leaderboard: {
      active: leaderboardService.isActive()
    },
    announcements: {
      active: announcementsService.isActive()
    },
    system: current.system || {}
  };

  // Override rotation_order with the effective (possibly boosted) order from zone controller
  const zoneState = zoneController.getZoneState();
  sanitized.zones.rotation_order = zoneState.rotationOrder;
  sanitized.zones.boostActive = zoneController.isBoostActive();

  // Add per-zone health status for frontend rotation skip logic
  if (monitor) {
    const healthStatus = monitor.getHealthStatus();
    sanitized.health = {
      zones: {}
    };
    for (const [zone, state] of Object.entries(healthStatus.zones)) {
      sanitized.health.zones[zone] = state.status; // 'healthy', 'degraded', 'unhealthy'
    }
  } else {
    sanitized.health = { zones: {} };
  }

  // Add alert system status
  sanitized.alerts = alerts ? alerts.getStatus() : null;

  res.json(sanitized);
});

// Zone API endpoints
app.get('/api/zones', (req, res) => {
  res.json(zoneController.getZoneState());
});

app.get('/api/zones/current', (req, res) => {
  const state = zoneController.getZoneState();
  state.boostActive = zoneController.isBoostActive();
  res.json(state);
});

app.post('/api/zones/advance', (req, res) => {
  const fromAdmin = req.query.source !== 'kiosk';
  const state = zoneController.advanceZone(fromAdmin);
  res.json(state);
});

// Video API endpoints
app.get('/api/videos', (req, res) => {
  res.json({
    videos: videoManager.getPlaylist(),
    count: videoManager.getVideoCount(),
    source: videoManager.getSource()
  });
});

app.post('/api/videos/reset', (req, res) => {
  videoManager.resetPlaylist();
  res.json({
    message: 'Playlist reset',
    videos: videoManager.getPlaylist(),
    count: videoManager.getVideoCount()
  });
});

// Reels API endpoints
app.get('/api/reels', (req, res) => {
  res.json({
    enabled: reelsFetcher.isEnabled(),
    reels: reelsFetcher.getReelsList(),
    status: reelsFetcher.getStatus()
  });
});

app.get('/api/reels/files/:filename', (req, res) => {
  const filename = req.params.filename;

  // Path traversal prevention
  if (!/^[a-zA-Z0-9_-]+\.mp4$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(__dirname, 'cache', 'reels', filename);
  res.sendFile(filePath, {
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes'
    }
  }, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Reel not found' });
    }
  });
});

// WOD API endpoints
app.get('/api/wod/status', (req, res) => {
  res.json(wodScraper.getStatus());
});

app.get('/api/wod/rendered', (req, res) => {
  const html = wodScraper.getRenderedHtml();
  if (html) {
    res.set('Content-Type', 'text/html');
    res.set('Cache-Control', 'no-cache');
    res.send(html);
  } else {
    res.status(503).json({ error: 'WOD content not yet available' });
  }
});

app.get('/api/wod/screenshot', (req, res) => {
  const screenshot = wodScraper.lastScreenshot;
  if (screenshot) {
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-cache');
    res.send(screenshot);
  } else {
    res.status(503).json({ error: 'No WOD screenshot available' });
  }
});

app.post('/api/wod/refresh', async (req, res) => {
  try {
    console.log('[Server] Manual WOD refresh requested');
    await wodScraper.login();
    res.json({ message: 'WOD refresh triggered', status: wodScraper.getStatus() });
  } catch (err) {
    res.status(500).json({ error: 'WOD refresh failed', message: err.message });
  }
});

// Roster API endpoints
app.get('/api/roster', (req, res) => {
  res.json(mindbodyClient.getRoster());
});

app.get('/api/schedule', (req, res) => {
  const classes = mindbodyClient.getSchedule().map(c => ({
    id: c.Id,
    name: (c.ClassDescription && c.ClassDescription.Name) || 'Class',
    startTime: c.StartDateTime,
    endTime: c.EndDateTime,
    coach: (c.Staff && c.Staff.Name) || 'Coach'
  }));
  res.json({ classes, count: classes.length });
});

app.get('/api/mindbody/status', (req, res) => {
  res.json(mindbodyClient.getStatus());
});

// Sheets API endpoints
app.get('/api/sheets/status', (req, res) => {
  res.json(sheetsClient.getStatus());
});

app.get('/api/sheets/tabs', (req, res) => {
  res.json({ tabs: sheetsClient.getTabNames() });
});

app.get('/api/sheets/data/:tab', (req, res) => {
  const tabName = req.params.tab;
  const tabNames = sheetsClient.getTabNames();

  if (tabNames.length > 0 && !tabNames.includes(tabName)) {
    return res.status(404).json({ error: `Tab "${tabName}" not found`, available: tabNames });
  }

  const data = sheetsClient.getTabData(tabName);
  res.json({ tab: tabName, data, count: data.length });
});

// Leaderboard API endpoint
app.get('/api/leaderboard', (req, res) => {
  res.json(leaderboardService.getLeaderboard());
});

// Announcements API endpoint
app.get('/api/announcements', (req, res) => {
  res.json(announcementsService.getAnnouncements());
});

// ── Admin API Endpoints (protected by auth middleware) ──

// GET /api/admin/status — Aggregate all service statuses
app.get('/api/admin/status', adminAuthMiddleware, (req, res) => {
  const zoneState = zoneController.getZoneState();
  const wodStatus = wodScraper.getStatus();
  const mbStatus = mindbodyClient.getStatus();
  const shStatus = sheetsClient.getStatus();
  const reelsStatus = reelsFetcher.getStatus();
  const announceData = announcementsService.getAnnouncements();
  const roster = mindbodyClient.getRoster();
  const schedule = mindbodyClient.getSchedule();

  res.json({
    uptime: process.uptime(),
    nodeEnv: process.env.NODE_ENV || 'development',
    zones: {
      currentZone: zoneState.currentZone,
      nextZone: zoneState.nextZone,
      boostActive: zoneController.isBoostActive(),
      rotationOrder: zoneState.rotationOrder
    },
    wod: {
      status: wodStatus.status,
      lastLogin: wodStatus.lastScreenshotTime,
      lastScreenshot: wodStatus.lastScreenshotTime
    },
    mindbody: {
      configured: mbStatus.configured,
      polling: mbStatus.polling,
      lastSchedulePoll: mbStatus.lastSchedulePoll,
      activeClass: mbStatus.activeClass,
      scheduleCount: schedule.length,
      roster: roster.classInfo ? {
        className: roster.classInfo.name,
        athleteCount: roster.count
      } : null
    },
    sheets: {
      configured: shStatus.configured,
      polling: shStatus.polling,
      lastPoll: shStatus.lastPoll,
      tabs: shStatus.tabs
    },
    videos: {
      count: videoManager.getVideoCount(),
      source: videoManager.getSource()
    },
    reels: {
      enabled: reelsStatus.enabled,
      count: reelsStatus.reelsCount
    },
    leaderboard: {
      active: leaderboardService.isActive()
    },
    announcements: {
      active: announcementsService.isActive(),
      count: announceData.count
    },
    health: monitor ? monitor.getHealthStatus() : null
  });
});

// GET /api/admin/config/full — Full config with credentials masked
app.get('/api/admin/config/full', adminAuthMiddleware, (req, res) => {
  const current = JSON.parse(JSON.stringify(configLoader.getConfig()));

  // Mask sensitive credentials
  if (current.wodscreen && current.wodscreen.password) {
    current.wodscreen.password = '***';
  }
  if (current.mindbody) {
    if (current.mindbody.api_key) current.mindbody.api_key = '***';
    if (current.mindbody.password) current.mindbody.password = '***';
  }
  if (current.sheets && current.sheets.credentials_file) {
    current.sheets.credentials_file = current.sheets.credentials_file; // show path only, no contents
  }
  if (current.system && current.system.admin_token) {
    current.system.admin_token = '***';
  }

  res.json(current);
});

// POST /api/admin/config — Update config sections
app.post('/api/admin/config', adminAuthMiddleware, (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    configLoader.saveConfig(body);
    res.json({ success: true, message: 'Config updated' });
  } catch (err) {
    console.error(`[Admin] Config update failed: ${err.message}`);
    res.status(500).json({ error: 'Config update failed', message: err.message });
  }
});

// POST /api/admin/config/restore — Restore config from backup
app.post('/api/admin/config/restore', adminAuthMiddleware, (req, res) => {
  try {
    const restored = configLoader.restoreBackup();
    if (!restored) {
      return res.status(404).json({ error: 'No backup file found. A backup is created each time settings are saved.' });
    }
    res.json({ success: true, message: 'Config restored from backup' });
  } catch (err) {
    console.error(`[Admin] Config restore failed: ${err.message}`);
    res.status(500).json({ error: 'Config restore failed', message: err.message });
  }
});

// GET /api/admin/alerts — Alert system status and history
app.get('/api/admin/alerts', adminAuthMiddleware, (req, res) => {
  res.json({
    notifications: notifications ? notifications.getStatus() : null,
    alerts: alerts ? alerts.getStatus() : null,
    history: alerts ? alerts.getAlertHistory() : []
  });
});

// POST /api/admin/refresh/:service — Trigger manual service refresh
app.post('/api/admin/refresh/:service', adminAuthMiddleware, async (req, res) => {
  const service = req.params.service;
  try {
    switch (service) {
      case 'wod':
        await wodScraper.login();
        zoneController.bumpRefreshVersion();
        return res.json({ success: true, service, message: 'WOD refresh triggered' });
      case 'sheets':
        await sheetsClient.poll();
        zoneController.bumpRefreshVersion();
        return res.json({ success: true, service, message: 'Sheets poll triggered' });
      case 'videos':
        videoManager.resetPlaylist();
        zoneController.bumpRefreshVersion();
        return res.json({ success: true, service, message: 'Video playlist reset' });
      case 'health':
        if (monitor) monitor.checkAll();
        return res.json({ success: true, service, message: 'Health check triggered' });
      default:
        return res.status(400).json({ error: `Unknown service: ${service}`, supported: ['wod', 'sheets', 'videos', 'health'] });
    }
  } catch (err) {
    console.error(`[Admin] Refresh ${service} failed: ${err.message}`);
    res.status(500).json({ error: `Refresh ${service} failed`, message: err.message });
  }
});

// Log config reloads
configLoader.onConfigChange(() => {
  console.log('Config reloaded');
});

const bindAddress = '0.0.0.0';

const server = app.listen(port, bindAddress, () => {
  console.log(`Gym Display server running on ${bindAddress}:${port} (${process.env.NODE_ENV || 'development'})`);

  // Initialize WodScraper — best-effort, server runs even if this fails
  (async () => {
    try {
      console.log('[Server] Initializing WodScraper...');
      await wodScraper.launch();
      await wodScraper.login();
      wodScraper.startSessionLoop();
      console.log('[Server] WodScraper initialized successfully');
    } catch (err) {
      console.error(`[Server] WodScraper initialization failed (non-fatal): ${err.message}`);
    }
  })();

  // Initialize MindBody client — best-effort, server runs even if this fails
  try {
    mindbodyClient.startPolling();
    console.log('[Server] MindBody polling started');

    // Periodic boost check — only if MindBody is configured
    if (mindbodyClient.getStatus().configured) {
      setInterval(() => {
        const schedule = mindbodyClient.getSchedule();
        zoneController.checkBoost(schedule);
      }, 30000);
      console.log('[Server] Boost check interval started (every 30s)');
    }
  } catch (err) {
    console.error(`[Server] MindBody initialization failed (non-fatal): ${err.message}`);
  }

  // Start Google Sheets polling (best-effort — server works without it)
  try {
    sheetsClient.startPolling();
    console.log('[Server] Sheets polling initialized');
  } catch (err) {
    console.error(`[Server] Sheets initialization failed (non-fatal): ${err.message}`);
  }

  // Initialize zone health monitor (after all services are initialized)
  try {
    monitor = healthMonitor.create({
      wodScraper,
      videoManager,
      reelsFetcher,
      mindbodyClient,
      sheetsClient,
      leaderboardService,
      announcementsService,
      configLoader
    });
    monitor.startMonitoring();
    console.log('[Server] Zone health monitor started');
  } catch (err) {
    console.error(`[Server] Health monitor initialization failed (non-fatal): ${err.message}`);
  }

  // Initialize alert system (after health monitor)
  try {
    const alertsConfig = configLoader.getConfig().alerts || {};
    notifications = notificationService.create({
      pushover: {
        user_key: alertsConfig.pushover?.user_key || '',
        app_token: alertsConfig.pushover?.app_token || ''
      },
      email: {
        gmail_user: alertsConfig.email?.gmail_user || '',
        gmail_app_password: alertsConfig.email?.gmail_app_password || '',
        recipients: (alertsConfig.email?.recipients || []).filter(r => r)
      }
    });

    alerts = alertManager.create(notifications, alertsConfig.thresholds || {});
    console.log('[Server] Alert system initialized');
  } catch (err) {
    console.error(`[Server] Alert system initialization failed (non-fatal): ${err.message}`);
  }

  // Connect alert manager to health monitor (late-binding avoids circular dependency)
  if (monitor && alerts) {
    monitor.setAlertManager(alerts);
    console.log('[Server] Alert manager connected to health monitor');
  }
});

module.exports = { app, server };
