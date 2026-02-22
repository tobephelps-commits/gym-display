const express = require('express');
const path = require('path');
const configLoader = require('./services/config-loader');

// Load config (exits on failure)
configLoader.loadConfig();
configLoader.startWatching();

const zoneController = require('./services/zone-controller');
const wodScraper = require('./services/wod-scraper');
const { createWodProxy } = require('./services/wod-proxy');

const config = configLoader.getConfig();
const port = (config.system && config.system.port) || 3000;

const app = express();
app.use(express.json());

// Mount WodScreen reverse proxy — strips iframe-blocking headers, injects session cookies
app.use('/wod-proxy', createWodProxy(() => wodScraper.getCookieString()));

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

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
    system: current.system || {}
  };

  res.json(sanitized);
});

// Zone API endpoints
app.get('/api/zones/current', (req, res) => {
  res.json(zoneController.getZoneState());
});

app.post('/api/zones/advance', (req, res) => {
  const state = zoneController.advanceZone();
  res.json(state);
});

// WOD API endpoints
app.get('/api/wod/status', (req, res) => {
  res.json(wodScraper.getStatus());
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

// Log config reloads
configLoader.onConfigChange(() => {
  console.log('Config reloaded');
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Gym Display server running on port ${port}`);

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
});

module.exports = { app, server };
