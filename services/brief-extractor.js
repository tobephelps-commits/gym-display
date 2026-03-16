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
      const allCookies = this._wodScraper.cookies;
      const btwbCookies = allCookies.filter(
        cookie => cookie.domain && cookie.domain.includes('beyondthewhiteboard')
      );
      console.log(`[BriefExtractor] Total cookies: ${allCookies.length}, BTWB cookies: ${btwbCookies.length}`);

      if (btwbCookies.length > 0) {
        await page.setCookie(...btwbCookies);
      } else {
        // No BTWB cookies — need to login directly
        console.log('[BriefExtractor] No BTWB cookies available — attempting direct login');
        await this._loginToBtwb(page, wodConfig);
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
      console.log(`[BriefExtractor] Landed on: ${currentUrl}`);
      if (currentUrl.includes('signin') || currentUrl.includes('login')) {
        console.warn('[BriefExtractor] BTWB session expired — attempting login');
        await this._loginToBtwb(page, wodConfig);
        // Re-navigate after login
        try {
          await page.goto(briefUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          console.log(`[BriefExtractor] Post-login URL: ${page.url()}`);
        } catch (navErr) {
          console.warn(`[BriefExtractor] Post-login navigation failed: ${navErr.message}`);
          return null;
        }
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
        // Debug: log page title and iframe/link counts to help diagnose
        const debug = await page.evaluate(() => {
          const iframes = document.querySelectorAll('iframe');
          const links = document.querySelectorAll('a[href*="youtube"], a[href*="youtu.be"]');
          const allLinks = document.querySelectorAll('a');
          return {
            title: document.title,
            iframeCount: iframes.length,
            iframeSrcs: Array.from(iframes).map(f => f.src).slice(0, 5),
            ytLinkCount: links.length,
            bodyLength: document.body.innerHTML.length,
            bodySnippet: document.body.innerText.substring(0, 500)
          };
        });
        console.log(`[BriefExtractor] Debug — title: "${debug.title}", iframes: ${debug.iframeCount}, ytLinks: ${debug.ytLinkCount}, bodyLen: ${debug.bodyLength}`);
        if (debug.iframeCount > 0) {
          console.log(`[BriefExtractor] Debug — iframe srcs: ${JSON.stringify(debug.iframeSrcs)}`);
        }
        console.log(`[BriefExtractor] Debug — body snippet: ${debug.bodySnippet.substring(0, 200)}`);

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
   * Login to BTWB directly using WodScreen credentials.
   * Used when WodScraper doesn't have BTWB-domain cookies.
   */
  async _loginToBtwb(page, wodConfig) {
    try {
      const username = wodConfig.username;
      const password = wodConfig.password;
      if (!username || !password) {
        console.warn('[BriefExtractor] No credentials available for BTWB login');
        return;
      }

      console.log('[BriefExtractor] Navigating to BTWB signin...');
      await page.goto('https://beyondthewhiteboard.com/signin', { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for login form
      await page.waitForSelector('input[type="email"], input[name="email"], input[type="text"]', { timeout: 10000 }).catch(() => {});

      // Fill email
      const emailInput = await page.$('input[type="email"]') || await page.$('input[name="email"]') || await page.$('input[type="text"]');
      if (emailInput) {
        await emailInput.click({ clickCount: 3 });
        await emailInput.type(username);
      }

      // Fill password
      const passInput = await page.$('input[type="password"]');
      if (passInput) {
        await passInput.click({ clickCount: 3 });
        await passInput.type(password);
      }

      // Submit
      const submitBtn = await page.$('button[type="submit"]') || await page.$('input[type="submit"]') || await page.$('.btn-primary');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      }

      console.log(`[BriefExtractor] Post-login URL: ${page.url()}`);
    } catch (err) {
      console.warn(`[BriefExtractor] BTWB login failed: ${err.message}`);
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
