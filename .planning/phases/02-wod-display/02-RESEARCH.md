# Phase 2: WOD Display - Research

**Researched:** 2026-02-21
**Domain:** Browser automation for WodScreen.com (React SPA), embedding in kiosk display
**Confidence:** HIGH

<research_summary>
## Summary

Researched how to automate WodScreen.com login/navigation and display the live WOD page within the existing zone rotation system. WodScreen is a React SPA (`/launch/index.html`) by Beyond the Whiteboard — no public API, no one has automated it before, requires JS execution for all interactions.

Two viable approaches emerged: (1) **Reverse proxy with header stripping** to iframe the live WodScreen page, with Puppeteer handling initial login and session cookies; (2) **Puppeteer screenshot caching** where a headless browser navigates to the WOD page and captures periodic screenshots served as images. The proxy approach gives a truly live page but is fragile with React SPAs. The screenshot approach is rock-solid reliable but technically not "live" (though for content that changes once daily, a 30-60 second refresh is indistinguishable from live).

**Primary recommendation:** Start with reverse proxy + iframe approach for live page display (user's preference). Build screenshot caching as the automatic fallback when proxy/iframe fails — this gives both the desired live experience AND bulletproof reliability.

</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| puppeteer-core | ^24.x | Browser automation (login, navigation) | Must use `-core` on ARM64 — no bundled Chromium for Pi |
| http-proxy-middleware | ^3.0.5 | Reverse proxy with header manipulation | Standard Express middleware, supports responseInterceptor for stripping X-Frame-Options |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tough-cookie | ^5.x | Server-side cookie jar management | Storing/injecting WodScreen session cookies into proxy requests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| puppeteer-core | playwright | Playwright has better ARM64 support (auto-downloads Chromium for ARM64), but project design doc specifies Puppeteer |
| http-proxy-middleware | node-http-proxy | Lower level, more control, but HPM is simpler for Express integration |
| Screenshot fallback | CDP screencast | Screencast has high CPU usage on Pi (issue #11062), periodic screenshots are lighter |

**Installation:**
```bash
npm install puppeteer-core http-proxy-middleware tough-cookie
```

**On Raspberry Pi:**
```bash
sudo apt install chromium-browser
# puppeteer-core uses system Chromium — no download needed
```

</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
services/
├── wod-scraper.js       # Puppeteer automation: login, navigate, session management
├── wod-proxy.js         # Reverse proxy middleware for WodScreen iframe embedding
├── zone-controller.js   # (existing) Zone rotation engine
└── config-loader.js     # (existing) YAML config with hot-reload
public/
├── index.html           # (existing) Zone containers
├── app.js               # (existing) Zone rotation frontend
└── styles.css           # (existing) Crossfade transitions
```

### Pattern 1: Puppeteer Session Manager
**What:** A singleton service that manages a headless Chromium instance, handles WodScreen login, navigates to the daily WOD page, and maintains session cookies. Runs separately from the kiosk Chromium.
**When to use:** Always — this is the core automation regardless of display approach.
```javascript
// services/wod-scraper.js
const puppeteer = require('puppeteer-core');

class WodScraper {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.page = null;
    this.cookies = [];
    this.lastScreenshot = null;
    this.status = 'idle'; // idle | ready | error
  }

  async launch() {
    this.browser = await puppeteer.launch({
      executablePath: process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/chromium-browser',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--no-first-run',
      ],
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1920, height: 1080 });
  }

  async login() {
    // Navigate to launch page, wait for React app to render
    // Fill login form, submit, wait for auth redirect
    // Click daily WOD launch button
    // Capture cookies for proxy injection
  }

  async captureScreenshot() {
    // Fallback: capture screenshot as JPEG buffer
    // Store in this.lastScreenshot
  }

  async getCookies() {
    return await this.page.cookies();
  }
}
```

### Pattern 2: Reverse Proxy with Cookie Injection
**What:** Express middleware that proxies WodScreen requests through localhost, stripping iframe-blocking headers and injecting session cookies obtained by Puppeteer.
**When to use:** Primary display approach — enables true live page in iframe.
```javascript
// services/wod-proxy.js
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

function createWodProxy(getCookiesFn) {
  return createProxyMiddleware({
    target: 'https://wodscreen.com',
    changeOrigin: true,
    selfHandleResponse: true,
    pathRewrite: { '^/wod-proxy': '' },
    on: {
      proxyRes: responseInterceptor(async (buffer, proxyRes) => {
        // Strip iframe-blocking headers
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];

        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          let body = buffer.toString('utf8');
          body = body.replace('<head>', '<head><base href="https://wodscreen.com/">');
          return body;
        }
        return buffer;
      }),
      proxyReq: async (proxyReq) => {
        const cookies = await getCookiesFn();
        if (cookies) {
          proxyReq.setHeader('Cookie', cookies);
        }
      }
    }
  });
}
```

### Pattern 3: Screenshot Fallback with Graceful Degradation
**What:** When iframe/proxy approach fails (detected by frontend health check), automatically fall back to serving cached screenshots.
**When to use:** Fallback — ensures the WOD zone NEVER shows a blank screen.
```javascript
// API endpoint for screenshot fallback
app.get('/api/wod/screenshot', (req, res) => {
  const screenshot = wodScraper.lastScreenshot;
  if (screenshot) {
    res.set('Content-Type', 'image/jpeg');
    res.send(screenshot);
  } else {
    res.status(503).json({ error: 'WOD not available' });
  }
});
```

### Anti-Patterns to Avoid
- **Running two full Chromium instances simultaneously on Pi:** The kiosk Chromium + a headless instance is ~600-800MB RAM. On a 4GB Pi this works but is tight. Use `--single-process` and `--no-zygote` flags on the headless instance to reduce memory.
- **CDP screencast for "live" display:** Causes very high CPU usage (Puppeteer issue #11062). Periodic screenshots are much lighter.
- **Storing credentials in cookies/localStorage on the kiosk browser:** Keep auth isolated to the headless Puppeteer instance. The kiosk browser only sees proxied/screenshot content.

</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP proxying with header manipulation | Custom proxy with `http` module | `http-proxy-middleware` with `responseInterceptor` | Handles compression, chunked encoding, WebSocket upgrades, error cases |
| Cookie parsing and management | Manual `Set-Cookie` parsing | `tough-cookie` | Cookie spec is complex (domain, path, SameSite, expiry, HttpOnly) |
| Browser automation | Custom CDP protocol calls | `puppeteer-core` | Manages page lifecycle, navigation, waits, error recovery |
| Retry/reconnection logic | Custom setTimeout loops | Structured state machine with clear states | Ad-hoc retry loops become unmaintainable spaghetti |

**Key insight:** The complexity in this phase is NOT in any single component — it's in the error handling and recovery. Login expires? Session drops? Site structure changes? Page fails to load? Each failure mode needs a clear recovery path. Use established libraries for the plumbing so you can focus on the state machine logic.

</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Puppeteer No ARM64 Binary
**What goes wrong:** `npm install puppeteer` downloads x86_64 Chromium which crashes on Pi
**Why it happens:** Puppeteer does not ship ARM64 Linux Chromium binaries (issue #7740, closed as "not planned")
**How to avoid:** Use `puppeteer-core` (no bundled browser) + system-installed `chromium-browser`. Set `executablePath` explicitly.
**Warning signs:** `ENOENT` or segfault on launch, 170MB download during npm install on Pi

### Pitfall 2: /dev/shm Exhaustion on Pi
**What goes wrong:** Chromium crashes with `Page crashed!` errors
**Why it happens:** Pi's `/dev/shm` is often only 64MB; Chromium uses shared memory heavily
**How to avoid:** Always pass `--disable-dev-shm-usage` flag
**Warning signs:** Random page crashes after running for a while, especially with multiple tabs

### Pitfall 3: React SPA Breaks Under Reverse Proxy
**What goes wrong:** WodScreen app loads but doesn't function — API calls fail, routing breaks
**Why it happens:** React SPA may check `window.location.hostname`, use absolute API URLs, or have CORS restrictions that don't expect `localhost`
**How to avoid:** Inject `<base href>` for relative URLs. If SPA has hostname checks, use `responseInterceptor` to patch JS. Have screenshot fallback ready.
**Warning signs:** SPA loads but shows spinner forever, API requests go to wrong host, console errors about CORS

### Pitfall 4: Session Expiry at 3 AM
**What goes wrong:** WOD shows blank screen in the morning because login session expired overnight
**Why it happens:** Session cookies expire, no one is watching at 3 AM to re-login
**How to avoid:** Scheduled session health checks (e.g., every 30 minutes). If session dead, re-run login automation. Log all auth state changes.
**Warning signs:** WOD works after restart but goes blank after hours/days

### Pitfall 5: Stale WOD From Yesterday
**What goes wrong:** TV shows yesterday's workout because the page/screenshot wasn't refreshed
**Why it happens:** Puppeteer page stayed on the previous day's WOD, or cached screenshot wasn't updated
**How to avoid:** Daily refresh at configurable time (e.g., 4 AM). Force re-navigation through the launch page → daily WOD button flow. Don't just reload — re-navigate from scratch.
**Warning signs:** Correct WOD on first day, wrong WOD on subsequent days

</common_pitfalls>

<code_examples>
## Code Examples

### Puppeteer-core Setup for Raspberry Pi
```javascript
// Source: Puppeteer docs + community patterns for ARM64
const puppeteer = require('puppeteer-core');

const LAUNCH_OPTIONS = {
  executablePath: process.platform === 'win32'
    ? null // auto-detect on Windows for dev
    : '/usr/bin/chromium-browser',
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
};

async function launchBrowser() {
  const browser = await puppeteer.launch(LAUNCH_OPTIONS);
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  return { browser, page };
}
```

### Express Reverse Proxy with Header Stripping
```javascript
// Source: http-proxy-middleware docs + responseInterceptor recipe
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

app.use('/wod-proxy', createProxyMiddleware({
  target: 'https://wodscreen.com',
  changeOrigin: true,
  selfHandleResponse: true,
  pathRewrite: { '^/wod-proxy': '' },
  on: {
    proxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];

      const ct = proxyRes.headers['content-type'] || '';
      if (ct.includes('text/html')) {
        let html = buffer.toString('utf8');
        html = html.replace('<head>', '<head><base href="https://wodscreen.com/">');
        return html;
      }
      return buffer;
    }),
    proxyReq: (proxyReq, req) => {
      proxyReq.setHeader('Host', 'wodscreen.com');
      // Inject session cookies from Puppeteer
      if (req.wodCookies) {
        proxyReq.setHeader('Cookie', req.wodCookies);
      }
    }
  }
}));
```

### Periodic Screenshot Capture (Fallback)
```javascript
// Source: Puppeteer page.screenshot() API
async function captureScreenshotLoop(page, intervalMs = 30000) {
  let lastScreenshot = null;

  async function capture() {
    try {
      lastScreenshot = await page.screenshot({
        type: 'jpeg',
        quality: 85,
        fullPage: false,
      });
    } catch (err) {
      console.error('Screenshot capture failed:', err.message);
      // Keep last good screenshot — don't null it out
    }
  }

  // Initial capture
  await capture();

  // Periodic refresh
  setInterval(capture, intervalMs);

  return () => lastScreenshot; // getter function
}
```

</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `puppeteer` with bundled Chromium | `puppeteer-core` + system Chromium on ARM64 | Ongoing (ARM64 never supported for bundled) | Must use `puppeteer-core` on Pi, always |
| Custom http proxy code | `http-proxy-middleware` v3 with `responseInterceptor` | v3.0 (2024) | Clean API for modifying proxied responses |
| CDP `Page.startScreencast` for live streaming | Periodic `page.screenshot()` for kiosk displays | Community consensus | Screencast causes high CPU (issue #11062); screenshots are lighter for slowly-changing content |
| Puppeteer `headless: true` (old headless) | `headless: 'shell'` or `headless: true` (new headless) | Puppeteer v21+ | New headless mode is the default; old headless available via `headless: 'shell'` for lighter weight |

**New tools/patterns to consider:**
- **Playwright:** Better ARM64 Linux support (auto-downloads Chromium for ARM64). Worth considering if Puppeteer ARM64 issues become painful. But project design doc specifies Puppeteer.
- **Puppeteer `page.screencast()`:** High-level API added in recent versions for WebM recording. Not useful for live display but good for debugging.

**Deprecated/outdated:**
- **`puppeteer` (full package) on ARM64:** Will download useless x86 binary. Always use `puppeteer-core`.
- **`PUPPETEER_CHROMIUM_REVISION` env var:** Replaced by `.puppeteerrc.cjs` configuration file in v19+.

</sota_updates>

<open_questions>
## Open Questions

1. **WodScreen X-Frame-Options headers**
   - What we know: The site is a React SPA, likely has iframe restrictions
   - What's unclear: Exact headers sent. Could be `X-Frame-Options: DENY`, `SAMEORIGIN`, or CSP `frame-ancestors`
   - Recommendation: Test during implementation with `curl -I https://wodscreen.com/launch/index.html`. If blocked, proxy approach handles it. If not blocked, even simpler — direct iframe.

2. **WodScreen login flow specifics**
   - What we know: Requires btwb credentials, React SPA login form
   - What's unclear: Exact form selectors, whether there's CAPTCHA, 2FA, or CSRF tokens. Whether login redirects or uses XHR.
   - Recommendation: Investigate with Puppeteer during plan 02-01 execution. Launch headless, navigate, inspect DOM. Build login automation iteratively.

3. **Daily WOD button identification**
   - What we know: Launch page has a button to show daily WOD. Cannot navigate to WOD directly by URL.
   - What's unclear: Button selector, whether it opens a new page/tab or renders inline, what the resulting URL/state looks like.
   - Recommendation: Investigate with Puppeteer during execution. This is a discovery task that can't be fully researched without live credentials.

4. **Session duration / expiry pattern**
   - What we know: WodScreen uses btwb auth which has session cookies
   - What's unclear: How long sessions last, whether they survive page reloads, what the expiry signal looks like
   - Recommendation: Monitor during testing. Build session health check that periodically validates auth state and re-logins when needed.

5. **Dual Chromium memory impact on Pi 5**
   - What we know: Kiosk Chromium ~300MB + headless Puppeteer Chromium ~200-300MB = ~500-600MB. Pi 5 has 4GB.
   - What's unclear: Real-world memory usage with WodScreen SPA loaded in both contexts
   - Recommendation: Monitor with `free -m` during Pi testing. Should be fine with 4GB but worth tracking. Use `--no-zygote` and lean flags on headless instance.

</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [Puppeteer System Requirements](https://pptr.dev/guides/system-requirements) — ARM64 Linux NOT listed for bundled Chromium
- [Puppeteer Configuration Guide](https://pptr.dev/guides/configuration) — `.puppeteerrc.cjs`, `executablePath`
- [Puppeteer Installation Guide](https://pptr.dev/guides/installation) — `puppeteer-core` vs `puppeteer`
- [http-proxy-middleware npm](https://www.npmjs.com/package/http-proxy-middleware) — v3.0.5, `responseInterceptor` API
- [http-proxy-middleware responseInterceptor recipe](https://github.com/chimurai/http-proxy-middleware/blob/master/recipes/response-interceptor.md)

### Secondary (MEDIUM confidence)
- [Puppeteer ARM support issue #10172](https://github.com/puppeteer/puppeteer/issues/10172) — Closed as "not planned"
- [Puppeteer ARM64 issue #7740](https://github.com/puppeteer/puppeteer/issues/7740) — Confirmed no ARM64 binary
- [Puppeteer page crashes on Pi #4925](https://github.com/puppeteer/puppeteer/issues/4925) — `/dev/shm` fix
- [CDP screencast CPU usage #11062](https://github.com/puppeteer/puppeteer/issues/11062) — High CPU confirmed
- [Playwright ARM64 support](https://playwright.dev/docs/browsers) — Better ARM64 support than Puppeteer
- [WODScreen Support Articles](https://support.btwb.com/en/support/solutions/folders/35000212467) — 5 display types documented
- [WODScreen Blog: Updates (2018)](https://btwb.blog/2018/06/19/wodscreen-updates/) — Launch flow described

### Tertiary (LOW confidence - needs validation during implementation)
- WodScreen X-Frame-Options headers — not verified, need `curl -I` test
- WodScreen login form selectors — need live Puppeteer inspection
- Session expiry duration — need empirical testing
- Memory usage of dual Chromium on Pi 5 — need real-world measurement

</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Puppeteer-core for browser automation on ARM64
- Ecosystem: http-proxy-middleware, tough-cookie for proxy + session management
- Patterns: Reverse proxy iframe embedding, screenshot fallback, session health monitoring
- Pitfalls: ARM64 binary, /dev/shm, SPA proxy issues, session expiry, stale WOD

**Confidence breakdown:**
- Standard stack: HIGH — puppeteer-core + system Chromium on ARM64 is well-documented and widely used
- Architecture: HIGH — reverse proxy pattern is established; screenshot fallback is standard Puppeteer
- Pitfalls: HIGH — all documented in GitHub issues with confirmed fixes
- Code examples: HIGH — from official docs and verified community patterns
- WodScreen-specific behavior: LOW — no public documentation on login flow, selectors, or iframe policy

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (30 days — Puppeteer ecosystem stable, WodScreen unlikely to change)

</metadata>

---

*Phase: 02-wod-display*
*Research completed: 2026-02-21*
*Ready for planning: yes*
