const express = require('express');
const path = require('path');
const configLoader = require('./services/config-loader');

// Load config (exits on failure)
configLoader.loadConfig();
configLoader.startWatching();

const config = configLoader.getConfig();
const port = (config.system && config.system.port) || 3000;

const app = express();

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

// Log config reloads
configLoader.onConfigChange(() => {
  console.log('Config reloaded');
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Gym Display server running on port ${port}`);
});

module.exports = { app, server };
