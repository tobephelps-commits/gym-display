const configLoader = require('./config-loader');
const sheetsClient = require('./sheets-client');

/**
 * Extract YouTube video ID from various URL formats.
 * Supports: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/v/
 * @param {string} url - YouTube URL
 * @returns {string|null} Video ID or null if not a valid YouTube URL
 */
function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * Check if a string looks like a YouTube URL (for distinguishing from other video URLs).
 * @param {string} url
 * @returns {boolean}
 */
function isYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /(?:youtu\.be\/|youtube\.com\/)/.test(url);
}

class VideoManager {
  constructor() {
    this._playlist = [];
    this._currentIndex = 0;
    this._source = 'config';

    // Build initial playlist from config
    this._buildPlaylist();

    // Listen for config changes and rebuild playlist
    configLoader.onConfigChange(() => {
      const oldIds = this._playlist.map(v => v.videoId);
      this._buildPlaylist();
      const newIds = this._playlist.map(v => v.videoId);

      // Log additions and removals
      const added = newIds.filter(id => !oldIds.includes(id));
      const removed = oldIds.filter(id => !newIds.includes(id));
      if (added.length > 0) {
        console.log(`[VideoManager] Videos added: ${added.length}`);
      }
      if (removed.length > 0) {
        console.log(`[VideoManager] Videos removed: ${removed.length}`);
      }
      if (added.length > 0 || removed.length > 0) {
        console.log(`[VideoManager] Playlist updated: ${this._playlist.length} videos`);
      }
    });

    // Periodic Sheets sync — check every 60 seconds for Sheets playlist changes
    this._sheetsInterval = setInterval(() => {
      this._checkSheetsUpdate();
    }, 60000);
  }

  /**
   * Build playlist from Sheets "Playlist" tab if available.
   * Returns array of {videoId, title, url} if Sheets has a Playlist tab (even if empty).
   * Returns null if Sheets not configured or no Playlist tab (signals: use config fallback).
   */
  _buildPlaylistFromSheets() {
    const status = sheetsClient.getStatus();
    if (!status.configured || !status.tabs.includes('Playlist')) {
      return null;
    }

    const rows = sheetsClient.getTabData('Playlist');
    if (!Array.isArray(rows)) {
      return null;
    }

    const playlist = [];
    for (const row of rows) {
      if (!row.url) continue;

      // Silently skip non-YouTube URLs (handled by ReelsFetcher in Plan 02)
      if (!isYouTubeUrl(row.url)) continue;

      const videoId = extractYouTubeId(row.url);
      if (!videoId) {
        console.warn(`[VideoManager] Skipping malformed YouTube URL: ${row.url}`);
        continue;
      }

      // Check enabled flag — "TRUE", "true", "yes", "1" (case-insensitive)
      const enabled = String(row.enabled || '').trim().toLowerCase();
      if (!['true', 'yes', '1'].includes(enabled)) continue;

      playlist.push({
        videoId,
        title: row.title || 'Untitled',
        url: row.url
      });
    }

    return playlist;
  }

  /**
   * Build playlist from config, filtering to enabled entries with valid YouTube IDs.
   * Tries Sheets first, falls back to config.yaml.
   */
  _buildPlaylist() {
    // Try Sheets first
    const sheetsPlaylist = this._buildPlaylistFromSheets();
    if (sheetsPlaylist !== null) {
      this._playlist = sheetsPlaylist;
      this._source = 'sheets';
    } else {
      // Fall back to config.yaml
      const config = configLoader.getConfig() || {};
      const videos = config.videos || [];

      this._playlist = [];
      for (const entry of videos) {
        if (!entry.enabled) continue;

        const videoId = extractYouTubeId(entry.url);
        if (!videoId) {
          console.warn(`[VideoManager] Skipping invalid YouTube URL: ${entry.url}`);
          continue;
        }

        this._playlist.push({
          videoId,
          title: entry.title || 'Untitled',
          url: entry.url
        });
      }
      this._source = 'config';
    }

    // Reset index if out of bounds
    if (this._currentIndex >= this._playlist.length) {
      this._currentIndex = 0;
    }

    console.log(`[VideoManager] Playlist loaded from ${this._source}: ${this._playlist.length} videos`);
  }

  /**
   * Check if Sheets playlist has changed and rebuild if needed.
   */
  _checkSheetsUpdate() {
    const sheetsPlaylist = this._buildPlaylistFromSheets();
    if (sheetsPlaylist === null) return; // Sheets not available, no action

    const currentIds = this._playlist.map(v => v.videoId).join(',');
    const newIds = sheetsPlaylist.map(v => v.videoId).join(',');

    if (currentIds !== newIds) {
      this._playlist = sheetsPlaylist;
      this._source = 'sheets';
      if (this._currentIndex >= this._playlist.length) {
        this._currentIndex = 0;
      }
      console.log(`[VideoManager] Sheets playlist updated: ${this._playlist.length} videos`);
    }
  }

  /**
   * Returns the current playlist source: 'sheets' or 'config'.
   */
  getSource() {
    return this._source;
  }

  /**
   * Returns array of { videoId, title } for enabled videos with valid YouTube IDs.
   */
  getPlaylist() {
    return this._playlist.map(v => ({ videoId: v.videoId, title: v.title }));
  }

  /**
   * Returns count of enabled videos.
   */
  getVideoCount() {
    return this._playlist.length;
  }

  /**
   * Reset playlist index to 0. Called when video zone activates.
   */
  resetPlaylist() {
    this._currentIndex = 0;
  }

  /**
   * Returns current video { videoId, title } or null if playlist exhausted.
   */
  getCurrentVideo() {
    if (this._playlist.length === 0 || this._currentIndex >= this._playlist.length) {
      return null;
    }
    const v = this._playlist[this._currentIndex];
    return { videoId: v.videoId, title: v.title };
  }

  /**
   * Advance to next video. Returns next video or null if playlist complete.
   */
  advanceVideo() {
    this._currentIndex++;
    return this.getCurrentVideo();
  }
}

// Singleton instance
const videoManager = new VideoManager();

module.exports = videoManager;
module.exports.extractYouTubeId = extractYouTubeId;
