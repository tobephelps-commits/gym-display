---
phase: 02-wod-display
plan: 02-FIX
type: fix
wave: 1
depends_on: []
files_modified: [services/wod-scraper.js, services/wod-proxy.js, public/app.js]
autonomous: true
---

<objective>
Fix 1 UAT issue from v1.0 MVP verification.

Source: v1.0-UAT.md
Diagnosed: yes — multi-bug chain with 4 root causes identified
Priority: 0 blocker, 1 major, 0 minor, 0 cosmetic

UAT-001: WOD zone shows WodScreen authorization popup instead of workout content when credentials are configured (major)
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/v1.0-UAT.md

**Affected source files:**
@services/wod-scraper.js
@services/wod-proxy.js
@public/app.js
</context>

<tasks>
<task type="auto">
  <name>Task 1: Fix proxy domain mismatch and wodPageUrl path handling</name>
  <files>services/wod-proxy.js, services/wod-scraper.js</files>
  <action>
**Root Causes addressed:**
- Proxy targets `https://wodscreen.com` but cookies are scoped to `www.wodscreen.com`
- `wodPageUrl` is stored as absolute URL (e.g. `https://www.wodscreen.com/some/path`) but frontend uses it as a relative path after `/wod-proxy`, creating nonsensical proxy URLs

**Fix 1 — Proxy target domain:**
In `services/wod-proxy.js`, change the proxy target from `https://wodscreen.com` to `https://www.wodscreen.com`. Update the Host header to `www.wodscreen.com`. Update the base href injection to `https://www.wodscreen.com/`.

**Fix 2 — Store relative wodPageUrl:**
In `services/wod-scraper.js` line 197, after `this.wodPageUrl = this.page.url()`, extract only the pathname from the URL. Use `new URL(this.page.url()).pathname` to strip the origin, so `wodPageUrl` stores `/some/path` instead of `https://www.wodscreen.com/some/path`.

**Fix 3 — Cookie domain handling:**
In `services/wod-scraper.js` `getCookieString()` method, keep the existing concatenation but ensure `page.cookies()` is called with the WodScreen URL to get all cookies. In the `login()` method after navigation, call `this.cookies = await this.page.cookies('https://www.wodscreen.com')` to explicitly request cookies for that domain.
  </action>
  <verify>
- Server starts without errors
- `GET /api/wod/status` returns scraper status
- Proxy target is www.wodscreen.com in wod-proxy.js
- wodPageUrl in scraper stores a pathname (starts with `/`), not a full URL
  </verify>
  <done>Proxy domain matches cookie domain; wodPageUrl is a relative path usable by frontend proxy</done>
</task>

<task type="auto">
  <name>Task 2: Add gym authorization click to Puppeteer login flow</name>
  <files>services/wod-scraper.js</files>
  <action>
**Root Cause addressed:**
WodScreen has a two-step process: (1) user login, then (2) gym/box authorization ("click to authorize gym"). The scraper only handles step 1. After login, the page may show an authorization prompt that requires clicking a gym selection button before the WOD content is displayed.

**Fix:**
After the existing post-login wait and launch button search (lines 177-194), add a second discovery step specifically for gym authorization elements. Look for elements that might represent a gym selection or authorization action:

1. After the existing `_findClickableElement` for launch button, add a new search targeting authorization/gym selection elements. Wait up to 5 seconds for them to appear using `page.waitForSelector` with a short timeout (don't block forever if not present).
2. Search for clickable elements containing text like "authorize", "select gym", "choose", "continue", or gym-related content. Use `page.evaluate` to find elements by text content since the exact selectors are unknown.
3. If found, click the element and wait 5 seconds for the page to settle.
4. If NOT found after the timeout, continue as normal (the gym may already be authorized or this step may not exist for all accounts).
5. After this step, re-capture the page URL and cookies (they may have changed after authorization).

The flow should be:
```
login → post-login wait → launch button click → gym auth click (new) → capture URL & cookies → screenshot
```

Keep the approach defensive: log what's found, never crash if elements aren't found, and always proceed to capture the final state regardless.
  </action>
  <verify>
- Server starts without errors
- Server log shows "[WodScraper] Looking for gym authorization..." step
- If WodScreen auth popup exists, scraper clicks through it
- If no auth popup, scraper continues gracefully
  </verify>
  <done>Puppeteer login flow handles the gym authorization step after credentials login</done>
</task>

<task type="auto">
  <name>Task 3: Fix iframe fallback — detect auth popup content</name>
  <files>public/app.js</files>
  <action>
**Root Cause addressed:**
The iframe `onload` handler unconditionally considers the load successful, even when the loaded content is the WodScreen authorization popup (HTTP 200). This prevents the screenshot fallback from ever triggering.

**Fix:**
In the `tryWodIframe` function, modify the iframe onload handler to validate that the loaded content is actual WOD content, not an auth page. Since we can't read cross-origin iframe content directly (even through proxy, CSP may block), use a different approach:

1. After iframe loads, wait 2 seconds for content to settle.
2. Check the scraper status via `/api/wod/status` — if the scraper reports `status: 'ready'` AND has a recent screenshot (lastScreenshotTime within last 5 minutes), trust the iframe.
3. If the scraper status is NOT ready (error, no-credentials, idle), don't trust the iframe — fall back to screenshot mode immediately.
4. Add a `wodScraperReady` flag tracked from `pollWodStatus` that the iframe onload can check.

Simpler alternative (preferred): Instead of trying to validate iframe content, **only attempt iframe when scraper status is 'ready'**. The `tryWodIframe` function is already only called when `data.status === 'ready'` from `pollWodStatus`, but add a guard inside `tryWodIframe` itself. If the scraper is not ready, skip iframe entirely and go straight to screenshot. This makes the iframe a "bonus" — screenshot is the reliable path.

Additionally: when scraper status is `'ready'` but iframe is attempted, start a screenshot refresh timer as backup. If the iframe shows something wrong, the user at least gets screenshot fallback on the next WOD zone rotation.
  </action>
  <verify>
- Frontend loads without JavaScript errors
- When scraper is not ready: WOD zone shows screenshot or error state (never iframe)
- When scraper is ready: WOD zone attempts iframe with screenshot as fallback
- Auth popup content does NOT get shown to user (falls back to screenshot instead)
  </verify>
  <done>WOD zone never displays auth popup — falls back to screenshot when iframe content is suspect</done>
</task>
</tasks>

<verification>
Before declaring plan complete:
- [ ] Server starts without errors (`npm start`)
- [ ] All three affected files modified correctly
- [ ] Proxy targets www.wodscreen.com (matches cookie domain)
- [ ] wodPageUrl stored as relative pathname
- [ ] Login flow includes gym authorization step
- [ ] Frontend iframe logic has proper fallback guards
- [ ] Existing zone rotation, video, and roster functionality unaffected
</verification>

<success_criteria>
- UAT-001 root cause chain addressed at all 4 points
- WOD zone displays either workout content or screenshot fallback — never auth popup
- Graceful degradation: screenshot shown when iframe is unreliable
- Ready for re-verification with /gsd:verify-work
</success_criteria>

<output>
After completion, create `.planning/phases/02-wod-display/02-FIX-SUMMARY.md`
</output>
