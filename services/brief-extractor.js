/**
 * BriefExtractor — extracts the daily workout brief YouTube video from BTWB
 * and writes it to the Sheets Playlist tab as a [Daily Brief] sentinel row.
 *
 * Non-fatal: all errors are logged at WARN level and never thrown.
 * Runs after each WOD scrape cycle via the onPostScrape hook.
 */

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fs = require('fs');
const configLoader = require('./config-loader');

class BriefExtractor {
  constructor(wodScraper, sheetsClient) {
    this._wodScraper = wodScraper;
    this._sheetsClient = sheetsClient;
    this._lastVideoUrl = null;
    this._lastExtractDate = null;
    this._enabled = true;
  }

  /**
   * Core extraction flow — navigate to BTWB, find YouTube brief video,
   * write it to the Sheets Playlist tab as [Daily Brief].
   * Returns the video URL found (or null).
   */
  async extractAndInject() {
    let page = null;
    try {
      const config = configLoader.getConfig();
      const wodConfig = config.wodscreen || {};

      // Guard: explicitly disabled
      if (wodConfig.brief_enabled === false) {
        console.log('[BriefExtractor] Disabled via config (brief_enabled: false)');
        return null;
      }

      // Guard: no browser
      if (!this._wodScraper.browser) {
        console.log('[BriefExtractor] Skipping — WodScraper has no browser');
        return null;
      }

      // Guard: no cookies
      if (!this._wodScraper.cookies || this._wodScraper.cookies.length === 0) {
        console.log('[BriefExtractor] Skipping — WodScraper has no cookies');
        return null;
      }

      // Guard: Sheets not configured
      if (!this._sheetsClient._isConfigured()) {
        console.log('[BriefExtractor] Skipping — SheetsClient not configured');
        return null;
      }

      // Open a new page in the existing browser
      page = await this._wodScraper.browser.newPage();

      // Set BTWB cookies on the new page
      const btwbCookies = this._wodScraper.cookies.filter(
        cookie => cookie.domain && cookie.domain.includes('beyondthewhiteboard')
      );
      if (btwbCookies.length > 0) {
        await page.setCookie(...btwbCookies);
      }

      // Navigate to BTWB workout page
      const briefUrl = wodConfig.brief_url || 'https://beyondthewhiteboard.com/whiteboard';
      console.log(`[BriefExtractor] Navigating to ${briefUrl}`);

      try {
        await page.goto(briefUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (navErr) {
        console.warn(`[BriefExtractor] Navigation failed (BTWB may be down): ${navErr.message}`);
        return null;
      }

      // Check for login redirect
      const currentUrl = page.url();
      if (currentUrl.includes('signin') || currentUrl.includes('login')) {
        console.warn('[BriefExtractor] BTWB session expired for brief extraction');
        return null;
      }

      // Wait for content to render (BTWB is a React SPA)
      await page.waitForSelector(
        'iframe, [class*="workout"], [class*="narrative"], .track-detail',
        { timeout: 15000 }
      ).catch(() => {});

      // Extract YouTube URL using three strategies
      const { videoUrl, strategy } = await page.evaluate(() => {
        // Strategy 1: YouTube iframe src
        const iframe = document.querySelector('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
        if (iframe) return { videoUrl: iframe.src, strategy: 'iframe' };

        // Strategy 2: YouTube link href
        const link = document.querySelector('a[href*="youtube.com/watch"], a[href*="youtu.be/"]');
        if (link) return { videoUrl: link.href, strategy: 'link' };

        // Strategy 3: Regex scan of page HTML
        const html = document.body.innerHTML;
        const match = html.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
        if (match) return { videoUrl: match[0], strategy: 'regex' };

        return { videoUrl: null, strategy: null };
      });

      if (strategy) {
        console.log(`[BriefExtractor] Found video via ${strategy}: ${videoUrl}`);
      } else {
        console.log('[BriefExtractor] No brief video found for today');
        // If previous brief is >24h old, disable it in Sheets
        if (this._lastExtractDate) {
          const hoursSince = (Date.now() - this._lastExtractDate.getTime()) / (1000 * 60 * 60);
          if (hoursSince > 24) {
            await this._disableBriefInPlaylist();
          }
        }
        return null;
      }

      // Check if URL unchanged
      if (videoUrl === this._lastVideoUrl) {
        console.log('[BriefExtractor] Brief video unchanged');
        return videoUrl;
      }

      // Normalize: convert embed URLs to watch URLs
      const normalizedUrl = this._normalizeYouTubeUrl(videoUrl);
      if (!normalizedUrl) {
        console.warn(`[BriefExtractor] Could not normalize URL: ${videoUrl}`);
        return null;
      }

      // Write to Sheets Playlist tab
      await this._writeBriefToPlaylist(normalizedUrl);
      return normalizedUrl;
    } catch (err) {
      console.warn(`[BriefExtractor] Extraction failed: ${err.message}`);
      return null;
    } finally {
      if (page) {
        try { await page.close(); } catch (_) { /* ignore */ }
      }
    }
  }

  /**
   * Normalize YouTube URL — convert embed/short URLs to standard watch URL.
   * @param {string} url
   * @returns {string|null} Normalized URL or null if invalid
   */
  _normalizeYouTubeUrl(url) {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/);
    if (!match) return null;
    return `https://www.youtube.com/watch?v=${match[1]}`;
  }

  /**
   * Write the brief video URL to the Sheets Playlist tab as [Daily Brief].
   * Uses sentinel row pattern — updates existing row or creates new one.
   */
  async _writeBriefToPlaylist(videoUrl) {
    try {
      const config = configLoader.getConfig();
      const auth = this._sheetsClient._createAuth();
      const doc = new GoogleSpreadsheet(this._sheetsClient.spreadsheetId, auth);
      await doc.loadInfo();

      const sheet = doc.sheetsByTitle['Playlist'];
      if (!sheet) {
        console.warn('[BriefExtractor] No Playlist tab found in Sheets');
        return;
      }

      const rows = await sheet.getRows();
      const sentinel = '[Daily Brief]';
      const existingRow = rows.find(row => row.get('title') === sentinel);

      const focusValue = (config.wodscreen && config.wodscreen.brief_focus !== false) ? 'TRUE' : 'FALSE';

      if (existingRow) {
        const currentUrl = existingRow.get('url');
        if (currentUrl === videoUrl) {
          // URL unchanged — ensure enabled
          if (existingRow.get('enabled') !== 'TRUE') {
            existingRow.set('enabled', 'TRUE');
            await existingRow.save();
            console.log('[BriefExtractor] Re-enabled existing brief row');
          }
        } else {
          existingRow.set('url', videoUrl);
          existingRow.set('enabled', 'TRUE');
          await existingRow.save();
          console.log(`[BriefExtractor] Updated brief row: ${videoUrl}`);
        }
      } else {
        await sheet.addRow({
          url: videoUrl,
          title: sentinel,
          enabled: 'TRUE',
          days: '',
          focus: focusValue
        });
        console.log(`[BriefExtractor] Created brief row: ${videoUrl}`);
      }

      this._lastVideoUrl = videoUrl;
      this._lastExtractDate = new Date();
    } catch (err) {
      console.warn(`[BriefExtractor] Sheets write failed: ${err.message}`);
    }
  }

  /**
   * Disable the [Daily Brief] row in the Playlist tab (e.g., rest day, no video found).
   */
  async _disableBriefInPlaylist() {
    try {
      const auth = this._sheetsClient._createAuth();
      const doc = new GoogleSpreadsheet(this._sheetsClient.spreadsheetId, auth);
      await doc.loadInfo();

      const sheet = doc.sheetsByTitle['Playlist'];
      if (!sheet) return;

      const rows = await sheet.getRows();
      const existingRow = rows.find(row => row.get('title') === '[Daily Brief]');
      if (existingRow && existingRow.get('enabled') === 'TRUE') {
        existingRow.set('enabled', 'FALSE');
        await existingRow.save();
        console.log('[BriefExtractor] Disabled stale brief row (>24h old)');
      }
    } catch (err) {
      console.warn(`[BriefExtractor] Failed to disable stale brief: ${err.message}`);
    }
  }

  /**
   * Return status object for API consumers.
   */
  getStatus() {
    const config = configLoader.getConfig() || {};
    const wodConfig = config.wodscreen || {};
    return {
      enabled: wodConfig.brief_enabled !== false,
      lastVideoUrl: this._lastVideoUrl,
      lastExtractDate: this._lastExtractDate ? this._lastExtractDate.toISOString() : null,
      sheetsConfigured: this._sheetsClient._isConfigured()
    };
  }
}

module.exports = {
  create(wodScraper, sheetsClient) {
    return new BriefExtractor(wodScraper, sheetsClient);
  }
};
