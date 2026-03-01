const puppeteer = require('puppeteer-core');
const path = require('path');
const configLoader = require('./config-loader');

class WodScraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.cookies = [];
    this.localStorage = {};
    this.renderedHtml = null;
    this.lastScreenshot = null;
    this.lastScreenshotTime = null;
    this.status = 'idle';
    this.wodPageUrl = null;
    this._sessionInterval = null;
    this._dailyTimeout = null;

    // Listen for config changes to pick up credential updates
    configLoader.onConfigChange((newConfig) => {
      console.log('[WodScraper] Config changed — credentials will apply on next login cycle');
    });
  }

  /**
   * Detect Chrome/Chromium executable path based on platform.
   */
  _getExecutablePath() {
    if (process.platform === 'win32') {
      const commonPaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
          : null,
      ].filter(Boolean);

      const fs = require('fs');
      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          return p;
        }
      }
      // Fallback — hope it's on PATH
      return 'chrome.exe';
    }

    // Linux (Raspberry Pi)
    return '/usr/bin/chromium-browser';
  }

  /**
   * Launch headless Chromium browser.
   */
  async launch() {
    try {
      const executablePath = this._getExecutablePath();
      console.log(`[WodScraper] Launching browser: ${executablePath}`);

      this.browser = await puppeteer.launch({
        executablePath,
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--no-first-run',
          '--no-zygote',
          '--ozone-platform=headless',
        ],
        timeout: 60000,
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1920, height: 1080 });
      this.status = 'launched';
      console.log('[WodScraper] Browser launched successfully');
    } catch (err) {
      this.status = 'error';
      console.error(`[WodScraper] Failed to launch browser: ${err.message}`);
      throw err;
    }
  }

  /**
   * Log into WodScreen and navigate to the daily WOD page.
   *
   * Auth flow (verified via Playwright):
   *   1. Navigate to wodscreen.com/launch/index.html
   *   2. Click "Authorize" in welcome modal → redirects to beyondthewhiteboard.com/signin
   *   3. Fill email/password on btwb, click "Sign In" → redirects back to wodscreen.com
   *   4. Click "Daily WOD" on screen selection page → shows the workout
   */
  async login() {
    if (!this.page) {
      console.error('[WodScraper] Cannot login — browser not launched');
      this.status = 'error';
      return;
    }

    const config = configLoader.getConfig();
    const wodConfig = config.wodscreen || {};
    const url = wodConfig.url || 'https://www.wodscreen.com';
    const username = wodConfig.username;
    const password = wodConfig.password;

    if (!username || !password || username === 'your_username') {
      console.warn('[WodScraper] WodScreen credentials not configured — skipping login');
      this.status = 'no-credentials';
      return;
    }

    try {
      // Step 1: Navigate to WodScreen launch page
      console.log(`[WodScraper] Navigating to ${url}/launch/index.html`);
      await this.page.goto(`${url}/launch/index.html`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Step 2: Handle "Authorize" modal if present
      // WodScreen shows "Welcome to WODScreen! Click the button below to authorize WODScreen to access your gym."
      // Clicking Authorize redirects to beyondthewhiteboard.com/signin
      console.log('[WodScraper] Looking for AUTHORIZE modal...');
      const authClicked = await this._clickElementByText(
        ['authorize'],
        'button, a, [role="button"], .btn, input[type="button"]',
        10000
      );
      if (authClicked) {
        console.log('[WodScraper] Clicked AUTHORIZE button, waiting for redirect...');
        await this.page.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: 15000,
        }).catch(() => {
          console.log('[WodScraper] No navigation after Authorize — checking page state');
        });
        await this._sleep(2000);
      } else {
        console.log('[WodScraper] No AUTHORIZE modal found — continuing');
      }

      // Step 3: Check if we're on a login page (btwb redirects to /signin)
      const currentUrl = this.page.url();
      console.log(`[WodScraper] Current URL after authorize: ${currentUrl}`);

      const usernameSelector = await this._findSelector([
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        '#email',
        '#username',
      ]);

      const passwordSelector = await this._findSelector([
        'input[type="password"]',
        'input[name="password"]',
        '#password',
      ]);

      if (usernameSelector && passwordSelector) {
        console.log('[WodScraper] Login form found — entering credentials...');

        // Clear and fill username
        await this.page.click(usernameSelector);
        await this.page.evaluate((sel) => { document.querySelector(sel).value = ''; }, usernameSelector);
        await this.page.type(usernameSelector, username, { delay: 50 });

        // Clear and fill password
        await this.page.click(passwordSelector);
        await this.page.evaluate((sel) => { document.querySelector(sel).value = ''; }, passwordSelector);
        await this.page.type(passwordSelector, password, { delay: 50 });

        // Find and click submit button
        const submitSelector = await this._findSelector([
          'button[type="submit"]',
          'input[type="submit"]',
          'button:not([type])',
          '.login-button',
          '.btn-login',
          '.submit',
        ]);

        if (submitSelector) {
          await this.page.click(submitSelector);
        } else {
          await this.page.keyboard.press('Enter');
        }

        // Wait for navigation back to WodScreen after login
        console.log('[WodScraper] Waiting for post-login redirect to WodScreen...');
        await this.page.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: 30000,
        }).catch(() => {
          console.log('[WodScraper] No navigation detected after login submit');
        });

        await this._sleep(3000);
        console.log(`[WodScraper] Post-login URL: ${this.page.url()}`);
      } else {
        console.log('[WodScraper] No login form found — may already be authenticated');
        await this._sleep(2000);
      }

      // Step 4: Select the "Daily WOD" screen if screen selection page is shown
      // The screen selection is a list of cards. Each card has a text label and a button.
      // We need to find the list item containing "Daily WOD" and click its button.
      console.log('[WodScraper] Looking for Daily WOD screen selection...');
      const wodScreenClicked = await this._clickButtonInParent(
        'daily wod',
        10000
      );
      if (wodScreenClicked) {
        console.log('[WodScraper] Selected Daily WOD screen, waiting for content...');
        await this._sleep(5000);
      } else {
        console.log('[WodScraper] No screen selection found — may already be on WOD page');
      }

      // Store the resulting page URL as relative pathname (for use with /wod-proxy)
      this.wodPageUrl = new URL(this.page.url()).pathname;
      console.log(`[WodScraper] WOD page URL: ${this.wodPageUrl}`);

      // Extract cookies from both WodScreen and btwb domains (auth spans both)
      const wodCookies = await this.page.cookies('https://www.wodscreen.com');
      const btwbCookies = await this.page.cookies('https://www.beyondthewhiteboard.com');
      this.cookies = [...wodCookies, ...btwbCookies];
      console.log(`[WodScraper] Stored ${this.cookies.length} cookies (${wodCookies.length} WodScreen + ${btwbCookies.length} btwb)`);

      // Extract localStorage from WodScreen page (SPA stores auth tokens here)
      this.localStorage = await this.page.evaluate(() => {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          data[key] = localStorage.getItem(key);
        }
        return data;
      });
      console.log(`[WodScraper] Extracted ${Object.keys(this.localStorage).length} localStorage entries`);

      // Extract fully-rendered HTML for iframe display
      await this._captureRenderedHtml();
      console.log(`[WodScraper] Rendered HTML captured (${this.renderedHtml ? this.renderedHtml.length : 0} bytes)`);

      // Signal cookies-ready immediately so frontend can start iframe
      this.status = 'cookies-ready';
      console.log('[WodScraper] Cookies acquired — status: cookies-ready');

      // Capture initial screenshot in background (don't block on it)
      this.captureScreenshot().then(() => {
        this.status = 'ready';
        console.log('[WodScraper] Screenshot captured — status: ready');
      }).catch((err) => {
        // Still set ready — cookies are the important part
        this.status = 'ready';
        console.error(`[WodScraper] Background screenshot failed: ${err.message}`);
      });
    } catch (err) {
      this.status = 'error';
      console.error(`[WodScraper] Login failed: ${err.message}`);
      // Clear screenshot so frontend doesn't display the auth/error page
      this.lastScreenshot = null;
      this.lastScreenshotTime = null;
      // Detached frame = browser is dead, force relaunch on next retry
      if (err.message.includes('detached') || err.message.includes('Target closed') ||
          err.message.includes('Session closed') || err.message.includes('Protocol error')) {
        console.log('[WodScraper] Browser frame is dead — will relaunch on next retry');
        this.page = null;
      }
    }
  }

  /**
   * Try multiple selectors and return the first one that exists on the page.
   */
  async _findSelector(selectors) {
    for (const selector of selectors) {
      try {
        const el = await this.page.$(selector);
        if (el) return selector;
      } catch (e) {
        // Continue trying
      }
    }
    return null;
  }

  /**
   * Try to find a clickable element from a list of selectors.
   * Returns the first visible, non-disabled match.
   */
  async _findClickableElement(selectors) {
    for (const selector of selectors) {
      try {
        const elements = await this.page.$$(selector);
        for (const el of elements) {
          const isVisible = await el.evaluate((node) => {
            const style = window.getComputedStyle(node);
            return style.display !== 'none' &&
                   style.visibility !== 'hidden' &&
                   style.opacity !== '0' &&
                   !node.disabled;
          });
          if (isVisible) {
            return selector;
          }
        }
      } catch (e) {
        // Continue trying
      }
    }
    return null;
  }

  /**
   * Find and click the first visible element matching any keyword in its text content.
   * Waits up to timeoutMs for a matching element to appear.
   * @returns {boolean} true if an element was clicked
   */
  async _clickElementByText(keywords, selectorList, timeoutMs = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const clicked = await this.page.evaluate((kws, selectors) => {
          const elements = document.querySelectorAll(selectors);
          for (const el of elements) {
            const text = (el.textContent || '').toLowerCase().trim();
            const style = window.getComputedStyle(el);
            const visible = style.display !== 'none' &&
                            style.visibility !== 'hidden' &&
                            style.opacity !== '0' &&
                            el.offsetParent !== null;
            if (visible && kws.some(kw => text.includes(kw))) {
              el.click();
              return true;
            }
          }
          return false;
        }, keywords, selectorList);

        if (clicked) return true;
      } catch (e) {
        // Page might be navigating — retry
      }
      await this._sleep(500);
    }
    return false;
  }

  /**
   * Find a list item or card containing the given text keyword, then click
   * the button inside it. Handles WodScreen's screen selection UI where
   * the clickable button is a child of the card, not the text itself.
   * @returns {boolean} true if a button was clicked
   */
  async _clickButtonInParent(keyword, timeoutMs = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const clicked = await this.page.evaluate((kw) => {
          // Find all list items and card-like containers
          const containers = document.querySelectorAll('li, [class*="card"], [class*="Card"]');
          for (const container of containers) {
            const text = (container.textContent || '').toLowerCase();
            if (text.includes(kw)) {
              // Found the container with our keyword — click its button
              const btn = container.querySelector('button, [role="button"], a[href]');
              if (btn) {
                btn.click();
                return true;
              }
            }
          }
          return false;
        }, keyword);

        if (clicked) return true;
      } catch (e) {
        // Page might be navigating — retry
      }
      await this._sleep(500);
    }
    return false;
  }

  /**
   * Capture a JPEG screenshot of the current page.
   */
  async captureScreenshot() {
    if (!this.page) return;
    try {
      this.lastScreenshot = await this.page.screenshot({
        type: 'jpeg',
        quality: 85,
        fullPage: false,
      });
      this.lastScreenshotTime = new Date().toISOString();
      console.log('[WodScraper] Screenshot captured');
    } catch (err) {
      console.error(`[WodScraper] Screenshot failed: ${err.message}`);
      // Keep last good screenshot — don't null it out
    }
  }

  /**
   * Start the session maintenance loop.
   * - Captures screenshots and validates session on interval
   * - Forces full re-login daily at the configured hour
   */
  startSessionLoop(intervalMs) {
    const config = configLoader.getConfig();
    const wodConfig = config.wodscreen || {};

    if (!intervalMs) {
      const refreshMinutes = wodConfig.refresh_interval_minutes || 30;
      intervalMs = refreshMinutes * 60 * 1000;
    }

    console.log(`[WodScraper] Starting session loop (interval: ${intervalMs / 1000}s)`);

    // Periodic session check and screenshot
    this._sessionInterval = setInterval(async () => {
      try {
        if (this.status === 'ready' && this.page) {
          await this.captureScreenshot();
          await this._captureRenderedHtml();

          // Validate session — check if we're still on a WOD page (not redirected to login)
          const currentUrl = this.page.url();
          const isLoginPage = currentUrl.includes('login') ||
                              currentUrl.includes('signin') ||
                              currentUrl.includes('auth');

          if (isLoginPage) {
            console.log('[WodScraper] Session expired — re-logging in');
            await this.login();
          }
        } else if (this.status === 'error' || this.status === 'no-credentials') {
          // Retry login periodically if in error state — relaunch browser if page is dead
          if (!this.page || this.page.isClosed()) {
            console.log('[WodScraper] Browser page is dead — relaunching browser');
            await this._relaunchBrowser();
          }
          console.log(`[WodScraper] Status is "${this.status}" — attempting login`);
          await this.login();
        }
      } catch (err) {
        console.error(`[WodScraper] Session loop error: ${err.message}`);
      }
    }, intervalMs);

    // Schedule daily full re-login at configured hour (default 4 AM)
    this._scheduleDailyRelogin();
  }

  /**
   * Schedule a daily full re-login at the configured hour.
   */
  _scheduleDailyRelogin() {
    const config = configLoader.getConfig();
    const timezone = (config.system && config.system.timezone) || 'America/Denver';

    const scheduleNext = () => {
      const now = new Date();
      // Target 4 AM in configured timezone
      const targetHour = 4;

      // Calculate ms until next 4 AM (approximate — doesn't handle DST perfectly)
      const tomorrow4am = new Date(now);
      tomorrow4am.setHours(targetHour, 0, 0, 0);
      if (tomorrow4am <= now) {
        tomorrow4am.setDate(tomorrow4am.getDate() + 1);
      }

      const msUntil = tomorrow4am.getTime() - now.getTime();
      console.log(`[WodScraper] Next daily re-login in ${Math.round(msUntil / 60000)} minutes`);

      this._dailyTimeout = setTimeout(async () => {
        console.log('[WodScraper] Daily re-login starting...');
        try {
          await this.login();
        } catch (err) {
          console.error(`[WodScraper] Daily re-login failed: ${err.message}`);
        }
        // Schedule next day
        scheduleNext();
      }, msUntil);
    };

    scheduleNext();
  }

  /**
   * Return cookies formatted as Cookie header string for proxy injection.
   */
  getCookieString() {
    if (!this.cookies || this.cookies.length === 0) return null;
    return this.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Return localStorage data extracted from the authenticated WodScreen page.
   */
  getLocalStorage() {
    return this.localStorage || {};
  }

  /**
   * Return rendered HTML of the WOD page (pre-authenticated, static snapshot).
   */
  getRenderedHtml() {
    return this.renderedHtml;
  }

  /**
   * Extract the fully-rendered WOD page HTML from the browser.
   * Inlines computed styles and removes scripts to create a self-contained snapshot.
   */
  async _captureRenderedHtml() {
    if (!this.page) return;
    try {
      this.renderedHtml = await this.page.evaluate(() => {
        return document.documentElement.outerHTML;
      });

      // Post-process: make resource URLs absolute and strip scripts
      if (this.renderedHtml) {
        // Remove all <script> tags (we want a static display, no SPA re-init)
        this.renderedHtml = this.renderedHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

        // Inject base href, hide options sidebar, and clean up display for iframe
        const displayCss = [
          'body{margin:0;overflow:hidden;}',
          // Hide the settings/options panel (appears as a right-side drawer)
          '[class*="etting"],[class*="ptions"],[class*="idebar"],[class*="rawer"]{display:none!important;}',
          // Hide the settings gear button (bottom-left)
          'footer~div,div[style*="position: fixed"]{display:none!important;}',
        ].join('');

        this.renderedHtml = '<!DOCTYPE html><html>' +
          this.renderedHtml.replace(/<head>/i,
            '<head><base href="https://www.wodscreen.com/">' +
            `<style>${displayCss}</style>`);
      }
    } catch (err) {
      console.error(`[WodScraper] Failed to capture rendered HTML: ${err.message}`);
    }
  }

  /**
   * Return current scraper status.
   */
  getStatus() {
    return {
      status: this.status,
      wodPageUrl: this.wodPageUrl,
      lastScreenshotTime: this.lastScreenshotTime,
      cookieCount: this.cookies ? this.cookies.length : 0,
      hasCookies: !!(this.cookies && this.cookies.length > 0),
    };
  }

  /**
   * Relaunch the browser after a fatal error (detached frame, crash, etc.).
   */
  async _relaunchBrowser() {
    try {
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
    } catch (_) { /* ignore */ }
    this.browser = null;
    this.page = null;
    await this.launch();
  }

  /**
   * Shut down browser gracefully.
   */
  async shutdown() {
    if (this._sessionInterval) {
      clearInterval(this._sessionInterval);
      this._sessionInterval = null;
    }
    if (this._dailyTimeout) {
      clearTimeout(this._dailyTimeout);
      this._dailyTimeout = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
        console.log('[WodScraper] Browser closed');
      } catch (err) {
        console.error(`[WodScraper] Error closing browser: ${err.message}`);
      }
      this.browser = null;
      this.page = null;
    }
    this.status = 'idle';
  }

  /**
   * Helper sleep.
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance — don't auto-start, server.js will call launch() and login()
const wodScraper = new WodScraper();

module.exports = wodScraper;
