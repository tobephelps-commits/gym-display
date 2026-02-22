const configLoader = require('./config-loader');

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

class VideoManager {
  constructor() {
    this._playlist = [];
    this._currentIndex = 0;

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
  }

  /**
   * Build playlist from config, filtering to enabled entries with valid YouTube IDs.
   */
  _buildPlaylist() {
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

    // Reset index if out of bounds
    if (this._currentIndex >= this._playlist.length) {
      this._currentIndex = 0;
    }

    console.log(`[VideoManager] Playlist loaded: ${this._playlist.length} videos`);
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
