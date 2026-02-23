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
const { createWodProxy } = require('./services/wod-proxy');

const config = configLoader.getConfig();
const port = (config.system && config.system.port) || 3000;

const app = express();
app.use(express.json());

// Mount WodScreen reverse proxy — strips iframe-blocking headers, injects session cookies
app.use('/wod-proxy', createWodProxy(
  () => wodScraper.getCookieString(),
  () => wodScraper.getLocalStorage()
));

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
    system: current.system || {}
  };

  // Override rotation_order with the effective (possibly boosted) order from zone controller
  const zoneState = zoneController.getZoneState();
  sanitized.zones.rotation_order = zoneState.rotationOrder;
  sanitized.zones.boostActive = zoneController.isBoostActive();

  res.json(sanitized);
});

// Zone API endpoints
app.get('/api/zones/current', (req, res) => {
  const state = zoneController.getZoneState();
  state.boostActive = zoneController.isBoostActive();
  res.json(state);
});

app.post('/api/zones/advance', (req, res) => {
  const state = zoneController.advanceZone();
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

// Log config reloads
configLoader.onConfigChange(() => {
  console.log('Config reloaded');
});

const bindAddress = process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0';

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
});

module.exports = { app, server };
