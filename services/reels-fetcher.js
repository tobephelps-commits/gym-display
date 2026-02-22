const fs = require('fs');
const path = require('path');
const https = require('https');
const configLoader = require('./config-loader');

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'reels');
const GRAPH_API_BASE = 'https://graph.instagram.com/v21.0';
const TOKEN_REFRESH_DAYS = 30;

class ReelsFetcher {
  constructor() {
    this._enabled = false;
    this._accessToken = '';
    this._userId = '';
    this._maxReels = 20;
    this._fetchIntervalMinutes = 60;
    this._minDisplaySeconds = 30;

    this._reelsList = []; // Array of { id, filename }
    this._lastFetch = null;
    this._tokenSetAt = null;
    this._fetchTimer = null;
    this._tokenRefreshTimer = null;

    // Load config
    this._loadConfig();

    // Listen for config changes
    configLoader.onConfigChange(() => {
      this._loadConfig();
    });

    // Ensure cache directory exists
    this._ensureCacheDir();

    // Run initial fetch (best-effort, async)
    if (this._enabled) {
      this._startFetchCycle();
    }
  }

  /**
   * Load Instagram config from config-loader.
   */
  _loadConfig() {
    const config = configLoader.getConfig() || {};
    const ig = config.instagram || {};

    const wasEnabled = this._enabled;
    this._enabled = !!(ig.enabled && ig.access_token && ig.user_id);
    this._accessToken = ig.access_token || '';
    this._userId = ig.user_id || '';
    this._maxReels = ig.max_reels || 20;
    this._fetchIntervalMinutes = ig.fetch_interval_minutes || 60;
    this._minDisplaySeconds = ig.min_display_seconds || 30;

    if (this._accessToken) {
      this._tokenSetAt = this._tokenSetAt || new Date();
    }

    if (!this._enabled) {
      if (wasEnabled) {
        console.log('[ReelsFetcher] Instagram disabled or missing credentials');
        this._stopFetchCycle();
      } else {
        console.log('[ReelsFetcher] Instagram Reels disabled (no credentials configured)');
      }
    } else if (!wasEnabled && this._enabled) {
      console.log('[ReelsFetcher] Instagram Reels enabled');
      this._startFetchCycle();
    }
  }

  /**
   * Ensure cache/reels/ directory exists.
   */
  _ensureCacheDir() {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    } catch (err) {
      console.error(`[ReelsFetcher] Failed to create cache directory: ${err.message}`);
    }
  }

  /**
   * Fetch list of reels from Instagram Graph API.
   * @returns {Promise<Array<{id: string, media_url: string, timestamp: string}>>}
   */
  async fetchReelsList() {
    if (!this._enabled) return [];

    try {
      const url = `${GRAPH_API_BASE}/${this._userId}/media?fields=id,media_type,media_url,timestamp&access_token=${this._accessToken}`;
      const allVideos = [];
      let nextUrl = url;

      while (nextUrl && allVideos.length < this._maxReels) {
        const data = await this._httpGet(nextUrl);
        if (!data || !data.data) break;

        const videos = data.data.filter(item => item.media_type === 'VIDEO');
        allVideos.push(...videos.map(v => ({
          id: v.id,
          media_url: v.media_url,
          timestamp: v.timestamp
        })));

        nextUrl = (data.paging && data.paging.next) ? data.paging.next : null;
      }

      // Limit to max_reels most recent
      return allVideos.slice(0, this._maxReels);
    } catch (err) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        console.warn('[ReelsFetcher] Token expired or invalid. Please update instagram.access_token in config.yaml');
      } else {
        console.error(`[ReelsFetcher] Failed to fetch reels list: ${err.message}`);
      }
      return [];
    }
  }

  /**
   * Download a reel .mp4 file to cache.
   * @param {string} id - Reel ID
   * @param {string} mediaUrl - Direct .mp4 URL
   * @returns {Promise<boolean>} true if downloaded or already exists
   */
  async downloadReel(id, mediaUrl) {
    const filePath = path.join(CACHE_DIR, `${id}.mp4`);

    // Skip if file already exists and is non-empty
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) return true;
    } catch (e) {
      // File doesn't exist, proceed to download
    }

    try {
      await this._downloadFile(mediaUrl, filePath);
      return true;
    } catch (err) {
      console.error(`[ReelsFetcher] Failed to download reel ${id}: ${err.message}`);
      // Clean up partial file
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      return false;
    }
  }

  /**
   * Prune old reels not in the keepIds set.
   * @param {Set<string>} keepIds - Set of reel IDs to keep
   */
  pruneOldReels(keepIds) {
    try {
      const files = fs.readdirSync(CACHE_DIR);
      let pruned = 0;
      for (const file of files) {
        if (!file.endsWith('.mp4')) continue;
        const id = file.replace('.mp4', '');
        if (!keepIds.has(id)) {
          fs.unlinkSync(path.join(CACHE_DIR, file));
          pruned++;
        }
      }
      return pruned;
    } catch (err) {
      console.error(`[ReelsFetcher] Failed to prune old reels: ${err.message}`);
      return 0;
    }
  }

  /**
   * Run a complete fetch cycle: fetch list, download new, prune old.
   */
  async runFetchCycle() {
    if (!this._enabled) return;

    try {
      const reels = await this.fetchReelsList();
      if (reels.length === 0) {
        console.log('[ReelsFetcher] No reels found from API');
        return;
      }

      let downloaded = 0;
      const keepIds = new Set();

      for (const reel of reels) {
        keepIds.add(reel.id);
        const isNew = await this.downloadReel(reel.id, reel.media_url);
        if (isNew) downloaded++;
      }

      const pruned = this.pruneOldReels(keepIds);

      // Update internal list
      this._reelsList = reels.map(r => ({
        id: r.id,
        filename: `${r.id}.mp4`
      }));
      this._lastFetch = new Date();

      console.log(`[ReelsFetcher] Fetched ${reels.length} reels, downloaded ${downloaded} new, pruned ${pruned} old`);
    } catch (err) {
      console.error(`[ReelsFetcher] Fetch cycle failed: ${err.message}`);
    }
  }

  /**
   * Refresh the Instagram access token (long-lived tokens last 60 days).
   */
  async refreshToken() {
    if (!this._enabled || !this._accessToken) return;

    try {
      const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${this._accessToken}`;
      const data = await this._httpGet(url);

      if (data && data.access_token) {
        this._accessToken = data.access_token;
        this._tokenSetAt = new Date();
        console.log('[ReelsFetcher] Token refreshed successfully. New token (update config.yaml for persistence):');
        console.log(`[ReelsFetcher] access_token: ${this._accessToken}`);
      }
    } catch (err) {
      console.warn(`[ReelsFetcher] Token refresh failed: ${err.message}`);
    }
  }

  /**
   * Start the fetch and token refresh cycles.
   */
  _startFetchCycle() {
    this._stopFetchCycle();

    // Initial fetch (async, best-effort)
    this.runFetchCycle().catch(err => {
      console.error(`[ReelsFetcher] Initial fetch failed (non-fatal): ${err.message}`);
    });

    // Periodic fetch
    this._fetchTimer = setInterval(() => {
      this.runFetchCycle().catch(err => {
        console.error(`[ReelsFetcher] Periodic fetch failed: ${err.message}`);
      });
    }, this._fetchIntervalMinutes * 60 * 1000);

    // Token refresh every 30 days
    this._tokenRefreshTimer = setInterval(() => {
      const tokenAge = this._tokenSetAt ? (Date.now() - this._tokenSetAt.getTime()) / (1000 * 60 * 60 * 24) : 0;
      if (tokenAge >= TOKEN_REFRESH_DAYS) {
        this.refreshToken();
      }
    }, 24 * 60 * 60 * 1000); // Check daily
  }

  /**
   * Stop fetch and token refresh cycles.
   */
  _stopFetchCycle() {
    if (this._fetchTimer) {
      clearInterval(this._fetchTimer);
      this._fetchTimer = null;
    }
    if (this._tokenRefreshTimer) {
      clearInterval(this._tokenRefreshTimer);
      this._tokenRefreshTimer = null;
    }
  }

  /**
   * Returns array of { id, filename } for downloaded reels.
   */
  getReelsList() {
    return this._reelsList.slice();
  }

  /**
   * Returns status object.
   */
  getStatus() {
    const tokenAge = this._tokenSetAt
      ? Math.floor((Date.now() - this._tokenSetAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      enabled: this._enabled,
      reelsCount: this._reelsList.length,
      lastFetch: this._lastFetch ? this._lastFetch.toISOString() : null,
      tokenAgeDays: tokenAge
    };
  }

  /**
   * Returns whether Instagram Reels integration is enabled.
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * HTTP GET helper returning parsed JSON.
   */
  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: { 'User-Agent': 'GymDisplay/1.0' }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            const err = new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`);
            err.statusCode = res.statusCode;
            reject(err);
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('Request timeout'));
      });
      req.end();
    });
  }

  /**
   * Download a file from URL to local path.
   */
  _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : require('http');

      const req = protocol.request(url, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this._downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(resolve);
        });
        fileStream.on('error', (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      });

      req.on('error', reject);
      req.setTimeout(60000, () => {
        req.destroy(new Error('Download timeout'));
      });
      req.end();
    });
  }
}

// Singleton instance
const reelsFetcher = new ReelsFetcher();

module.exports = reelsFetcher;
