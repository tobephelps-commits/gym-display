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
        await page.goto(briefUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
          await page.goto(briefUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          console.log(`[BriefExtractor] Post-login URL: ${page.url()}`);
        } catch (navErr) {
          console.warn(`[BriefExtractor] Post-login navigation failed: ${navErr.message}`);
          return null;
        }
      }

      // Wait for React SPA content to render
      await page.waitForSelector(
        'iframe, [class*="workout"], [class*="narrative"], .track-detail, [class*="track"], [class*="freedom"], [class*="rx"]',
        { timeout: 20000 }
      ).catch(() => {});
      // Extra wait for SPA hydration
      await new Promise(r => setTimeout(r, 5000));

      // Diagnose page structure — find date sections and workout layout
      const pageStructure = await page.evaluate(() => {
        // Look for date-related elements (today's date, calendar nav, etc.)
        const today = new Date();
        const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const todayStr = today.getDate().toString();
        const monthStr = monthNames[today.getMonth()];
        const dayStr = dayNames[today.getDay()];

        // Find all elements with "RX" in text, grouped by their parent containers
        const rxElements = document.querySelectorAll('*');
        const workoutSections = [];
        for (const el of rxElements) {
          const text = (el.textContent || '').trim();
          if (/FREEDOM\s*\(RX\)/i.test(text) && text.length < 150) {
            // Check for date context in nearby elements
            let parent = el.parentElement;
            let dateContext = '';
            for (let i = 0; i < 5 && parent; i++) {
              const parentText = parent.textContent || '';
              // Look for date patterns like "Mar 17", "March 17", "17", day names
              const dateMatch = parentText.match(/(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*[\s,]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i)
                || parentText.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i)
                || parentText.match(/\d{1,2}\/\d{1,2}/);
              if (dateMatch) {
                dateContext = dateMatch[0];
                break;
              }
              parent = parent.parentElement;
            }
            workoutSections.push({
              text: text.substring(0, 120),
              dateContext,
              tag: el.tagName,
              classes: (el.className || '').toString().substring(0, 80)
            });
          }
        }

        // Also look for any date navigation / header elements
        const dateHeaders = [];
        const allEls = document.querySelectorAll('h1, h2, h3, h4, [class*="date"], [class*="day"], [class*="calendar"], [class*="header"], time, [datetime]');
        for (const el of allEls) {
          const text = (el.textContent || '').trim();
          if (text.length > 0 && text.length < 100 && /\d/.test(text)) {
            dateHeaders.push({
              tag: el.tagName,
              text: text.substring(0, 80),
              classes: (el.className || '').toString().substring(0, 60),
              datetime: el.getAttribute('datetime') || ''
            });
          }
        }

        return {
          todayDate: `${monthStr} ${todayStr} (${dayStr})`,
          workoutSections: workoutSections.slice(0, 10),
          dateHeaders: dateHeaders.slice(0, 15)
        };
      });

      console.log(`[BriefExtractor] Today: ${pageStructure.todayDate}`);
      console.log(`[BriefExtractor] Workout sections: ${JSON.stringify(pageStructure.workoutSections.map(s => ({ text: s.text.substring(0, 60), date: s.dateContext })))}`);
      console.log(`[BriefExtractor] Date headers: ${JSON.stringify(pageStructure.dateHeaders.map(h => ({ text: h.text.substring(0, 60), tag: h.tag, dt: h.datetime })))}`);

      // BTWB whiteboard shows multiple workout tracks. The brief video is
      // typically inside the RX version. We may need to click into it to
      // load the embedded player.
      const rxClicked = await this._clickRxWorkout(page);
      if (rxClicked) {
        // Wait for the workout detail / video to render after click
        await page.waitForSelector('iframe, video, [class*="video"], [class*="player"], [class*="brief"]', { timeout: 10000 }).catch(() => {});
        // Extra wait for dynamic content
        await new Promise(r => setTimeout(r, 3000));
      }

      // Extract YouTube URL using three strategies
      const { videoUrl, strategy } = await page.evaluate(() => {
        // Strategy 1: YouTube iframe src (including embed)
        const iframe = document.querySelector('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
        if (iframe) return { videoUrl: iframe.src, strategy: 'iframe' };

        // Strategy 2: YouTube link href (watch or short URLs)
        const link = document.querySelector('a[href*="youtube.com/watch"], a[href*="youtu.be/"], a[href*="youtube.com/embed"]');
        if (link) return { videoUrl: link.href, strategy: 'link' };

        // Strategy 3: Video/embed elements with YouTube sources
        const videoEl = document.querySelector('video source[src*="youtube"], embed[src*="youtube"]');
        if (videoEl) return { videoUrl: videoEl.src, strategy: 'video-element' };

        // Strategy 4: Regex scan of page HTML for YouTube URLs
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
          // Broad YouTube link search
          const ytLinks = document.querySelectorAll('a[href*="youtube"], a[href*="youtu.be"], a[href*="youtu"]');
          return {
            title: document.title,
            iframeCount: iframes.length,
            iframeSrcs: Array.from(iframes).map(f => f.src).slice(0, 5),
            ytLinkCount: ytLinks.length,
            ytLinkHrefs: Array.from(ytLinks).map(l => l.href).slice(0, 5),
            bodyLength: document.body.innerHTML.length,
            // Search for any youtube references in raw HTML
            ytInHtml: (document.body.innerHTML.match(/youtu[^\s"'<>]{5,80}/g) || []).slice(0, 10)
          };
        });
        console.log(`[BriefExtractor] Debug — title: "${debug.title}", iframes: ${debug.iframeCount}, ytLinks: ${debug.ytLinkCount}, bodyLen: ${debug.bodyLength}`);
        if (debug.ytLinkHrefs.length > 0) {
          console.log(`[BriefExtractor] Debug — YT link hrefs: ${JSON.stringify(debug.ytLinkHrefs)}`);
        }
        if (debug.iframeCount > 0) {
          console.log(`[BriefExtractor] Debug — iframe srcs: ${JSON.stringify(debug.iframeSrcs)}`);
        }
        if (debug.ytInHtml.length > 0) {
          console.log(`[BriefExtractor] Debug — YT in HTML: ${JSON.stringify(debug.ytInHtml)}`);
        }

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
   * Click on TODAY's RX workout section to expand it and reveal the embedded video.
   * BTWB whiteboard is organized by date columns with H3 headers like "Tue | 17".
   * We find today's date column, then click the RX workout within it.
   * Returns true if a click was performed.
   */
  async _clickRxWorkout(page) {
    try {
      const todayDate = new Date().getDate(); // e.g. 17

      const result = await page.evaluate((todayDate) => {
        // Step 1: Find today's date header (H3 with "| {date}")
        const dateHeaders = document.querySelectorAll('h3');
        let todayHeader = null;
        for (const h of dateHeaders) {
          const text = (h.textContent || '').trim();
          // Match patterns like "Tue | 17" or "Tue\n          | 17"
          const match = text.match(/\|\s*(\d{1,2})/);
          if (match && parseInt(match[1], 10) === todayDate) {
            todayHeader = h;
            break;
          }
        }

        if (!todayHeader) {
          return { found: false, reason: 'no-date-header', todayDate };
        }

        // Step 2: Find the day container that holds this header.
        // Walk up to find a parent that contains both the date header and workout content.
        // Then look for sibling or child containers with RX workouts.
        let dayContainer = todayHeader.parentElement;
        // Walk up until we find a container that has RX workout text
        for (let i = 0; i < 5 && dayContainer; i++) {
          const text = dayContainer.textContent || '';
          if (/\(RX\)/i.test(text) && text.length > 200) {
            break; // This container has workout content
          }
          dayContainer = dayContainer.parentElement;
        }

        if (!dayContainer) {
          return { found: false, reason: 'no-day-container', todayDate };
        }

        // Step 3: Within this container, find the RX workout element.
        // Look for the most specific (leaf) element containing "(RX)".
        const allElements = dayContainer.querySelectorAll('a, button, [role="button"], h1, h2, h3, h4, h5, h6, span, div, li, [class*="track"], [class*="workout"]');
        let bestEl = null;
        let bestLen = Infinity;
        let rxWorkoutText = '';

        for (const el of allElements) {
          const text = (el.textContent || '').trim();
          if (!/\(RX\)/i.test(text)) continue;
          if (text.length >= 200) continue;

          // Check if this is a leaf RX element (no child also matches)
          const children = el.querySelectorAll('*');
          let hasMatchingChild = false;
          for (const child of children) {
            if (/\(RX\)/i.test(child.textContent || '') && child.textContent.trim().length < 200) {
              hasMatchingChild = true;
              break;
            }
          }

          if (!hasMatchingChild && text.length < bestLen) {
            bestEl = el;
            bestLen = text.length;
            rxWorkoutText = text.substring(0, 100);
          }
        }

        if (bestEl) {
          bestEl.click();
          return { found: true, clicked: rxWorkoutText };
        }

        return { found: false, reason: 'no-rx-in-day-container', todayDate };
      }, todayDate);

      if (result.found) {
        console.log(`[BriefExtractor] Clicked today's RX workout: "${result.clicked}"`);
        return true;
      } else {
        console.log(`[BriefExtractor] Could not find today's RX workout: ${result.reason} (date=${todayDate})`);
        return false;
      }
    } catch (err) {
      console.warn(`[BriefExtractor] Click RX workout failed: ${err.message}`);
      return false;
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
