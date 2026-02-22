const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const configLoader = require('./config-loader');

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'reels');
const PYTHON_CMD = process.platform === 'win32' ? 'py' : 'python3';

class ReelsFetcher {
  constructor() {
    this._enabled = false;
    this._username = '';
    this._maxReels = 10;
    this._fetchIntervalMinutes = 60;
    this._minDisplaySeconds = 30;

    this._reelsList = []; // Array of { id, filename }
    this._lastFetch = null;
    this._fetchTimer = null;
    this._fetching = false;

    // Load config
    this._loadConfig();

    // Listen for config changes
    configLoader.onConfigChange(() => {
      this._loadConfig();
    });

    // Ensure cache directory exists
    this._ensureCacheDir();

    // Scan existing cached reels
    this._scanCachedReels();

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
    this._enabled = !!(ig.enabled && ig.username);
    this._username = ig.username || '';
    this._maxReels = ig.max_reels || 10;
    this._fetchIntervalMinutes = ig.fetch_interval_minutes || 60;
    this._minDisplaySeconds = ig.min_display_seconds || 30;

    if (!this._enabled) {
      if (wasEnabled) {
        console.log('[ReelsFetcher] Instagram disabled or missing username');
        this._stopFetchCycle();
      } else {
        console.log('[ReelsFetcher] Instagram Reels disabled (no username configured)');
      }
    } else if (!wasEnabled && this._enabled) {
      console.log(`[ReelsFetcher] Instagram Reels enabled for @${this._username}`);
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
   * Scan existing cached .mp4 files and populate _reelsList.
   */
  _scanCachedReels() {
    try {
      const files = fs.readdirSync(CACHE_DIR)
        .filter(f => f.endsWith('.mp4'))
        .sort()
        .reverse(); // newest first by filename (date-based)

      this._reelsList = files.map(f => ({
        id: f.replace('.mp4', ''),
        filename: f
      }));

      if (this._reelsList.length > 0) {
        console.log(`[ReelsFetcher] Found ${this._reelsList.length} cached reels`);
      }
    } catch (err) {
      // Directory may not exist yet
    }
  }

  /**
   * Run instaloader to fetch reels from the public profile.
   * Downloads only VIDEO posts, skips images, limited to max_reels.
   */
  async runFetchCycle() {
    if (!this._enabled || this._fetching) return;
    this._fetching = true;

    try {
      console.log(`[ReelsFetcher] Fetching reels from @${this._username}...`);

      await this._runInstaloader();

      // Clean up non-mp4 files instaloader may create
      this._cleanNonVideos();

      // Scan what we have now
      this._scanCachedReels();

      // Prune if over limit
      if (this._reelsList.length > this._maxReels) {
        const toRemove = this._reelsList.slice(this._maxReels);
        for (const reel of toRemove) {
          try {
            fs.unlinkSync(path.join(CACHE_DIR, reel.filename));
          } catch (e) { /* ignore */ }
        }
        this._reelsList = this._reelsList.slice(0, this._maxReels);
        console.log(`[ReelsFetcher] Pruned ${toRemove.length} old reels`);
      }

      this._lastFetch = new Date();
      console.log(`[ReelsFetcher] Fetch complete: ${this._reelsList.length} reels cached`);
    } catch (err) {
      console.error(`[ReelsFetcher] Fetch cycle failed: ${err.message}`);
    } finally {
      this._fetching = false;
    }
  }

  /**
   * Remove non-mp4 files that instaloader may leave behind.
   */
  _cleanNonVideos() {
    try {
      const files = fs.readdirSync(CACHE_DIR);
      for (const f of files) {
        if (!f.endsWith('.mp4')) {
          fs.unlinkSync(path.join(CACHE_DIR, f));
        }
      }
    } catch (err) { /* ignore */ }
  }

  /**
   * Shell out to instaloader to download videos.
   * Uses --no-pictures to skip images, --count to limit posts scanned.
   */
  _runInstaloader() {
    return new Promise((resolve, reject) => {
      // Scan more posts than max_reels since not all posts are videos
      const scanCount = this._maxReels * 2;

      const args = [
        '-m', 'instaloader',
        '--no-captions',
        '--no-metadata-json',
        '--no-compress-json',
        '--no-pictures',
        '--no-profile-pic',
        '--no-video-thumbnails',
        '--count', String(scanCount),
        '--dirname-pattern', CACHE_DIR,
        '--filename-pattern', '{date_utc}',
        '--', this._username
      ];

      console.log(`[ReelsFetcher] Running: ${PYTHON_CMD} ${args.join(' ')}`);

      const proc = execFile(PYTHON_CMD, args, {
        timeout: 120000, // 2 minute timeout
        maxBuffer: 1024 * 1024
      }, (err, stdout, stderr) => {
        if (err) {
          // instaloader exits non-zero on rate limits but may have
          // already downloaded some files - that's okay
          if (stderr && stderr.includes('403')) {
            console.warn('[ReelsFetcher] Hit Instagram rate limit (some reels may still have downloaded)');
            resolve();
          } else {
            reject(new Error(err.message));
          }
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Start the periodic fetch cycle.
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
  }

  /**
   * Stop the periodic fetch cycle.
   */
  _stopFetchCycle() {
    if (this._fetchTimer) {
      clearInterval(this._fetchTimer);
      this._fetchTimer = null;
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
    return {
      enabled: this._enabled,
      username: this._username,
      reelsCount: this._reelsList.length,
      lastFetch: this._lastFetch ? this._lastFetch.toISOString() : null
    };
  }

  /**
   * Returns whether Instagram Reels integration is enabled.
   */
  isEnabled() {
    return this._enabled;
  }
}

// Singleton instance
const reelsFetcher = new ReelsFetcher();

module.exports = reelsFetcher;
