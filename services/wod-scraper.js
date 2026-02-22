const puppeteer = require('puppeteer-core');
const path = require('path');
const configLoader = require('./config-loader');

class WodScraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.cookies = [];
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
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--no-first-run',
          '--no-zygote',
        ],
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
      console.log(`[WodScraper] Navigating to ${url}/launch/index.html`);
      await this.page.goto(`${url}/launch/index.html`, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Wait for login form — try common patterns since exact selectors are unknown
      console.log('[WodScraper] Waiting for login form...');
      const usernameSelector = await this._findSelector([
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[type="text"]',
        '#email',
        '#username',
      ]);

      const passwordSelector = await this._findSelector([
        'input[type="password"]',
        'input[name="password"]',
        '#password',
      ]);

      if (!usernameSelector || !passwordSelector) {
        console.error('[WodScraper] Could not find login form elements');
        this.status = 'error';
        await this.captureScreenshot(); // Capture state for debugging
        return;
      }

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
        // Fallback: press Enter
        await this.page.keyboard.press('Enter');
      }

      // Wait for navigation after login
      console.log('[WodScraper] Waiting for post-login navigation...');
      await this.page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 15000,
      }).catch(() => {
        // Some SPAs don't trigger navigation — wait for content change instead
        console.log('[WodScraper] No navigation detected — checking for content change');
      });

      // Wait a moment for React SPA to settle
      await this._sleep(3000);

      // Look for the daily WOD launch button and click it
      console.log('[WodScraper] Looking for daily WOD launch button...');
      const launchButton = await this._findClickableElement([
        'button',
        'a.btn',
        '.launch-button',
        '[data-testid*="launch"]',
        '[data-testid*="wod"]',
        '.wod-button',
      ]);

      if (launchButton) {
        await this.page.click(launchButton);
        console.log('[WodScraper] Clicked launch button, waiting for WOD page...');
        await this._sleep(5000);
      } else {
        console.log('[WodScraper] No explicit launch button found — may already be on WOD page');
      }

      // Store the resulting page URL as relative pathname (for use with /wod-proxy)
      this.wodPageUrl = new URL(this.page.url()).pathname;
      console.log(`[WodScraper] WOD page URL: ${this.wodPageUrl}`);

      // Extract and store cookies (explicitly request for www.wodscreen.com domain)
      this.cookies = await this.page.cookies('https://www.wodscreen.com');
      console.log(`[WodScraper] Stored ${this.cookies.length} cookies`);

      // Capture initial screenshot
      await this.captureScreenshot();

      this.status = 'ready';
      console.log('[WodScraper] Login complete — status: ready');
    } catch (err) {
      this.status = 'error';
      console.error(`[WodScraper] Login failed: ${err.message}`);
      // Keep lastScreenshot if available — don't null it out
      await this.captureScreenshot().catch(() => {});
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
          // Retry login periodically if in error state
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
   * Return current scraper status.
   */
  getStatus() {
    return {
      status: this.status,
      wodPageUrl: this.wodPageUrl,
      lastScreenshotTime: this.lastScreenshotTime,
      cookieCount: this.cookies ? this.cookies.length : 0,
    };
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
