# Phase 18: Daily Workout Brief Video - Research

**Researched:** 2026-03-16
**Domain:** BTWB workout brief YouTube video extraction + playlist injection
**Confidence:** MEDIUM

<research_summary>
## Summary

Researched how to extract the daily workout brief YouTube video from Beyond The Whiteboard (BTWB) and inject it into the gym display's video rotation. BTWB allows gym programming providers (CompTrain, Linchpin, etc.) to attach YouTube "WOD Brief" videos to each day's workout via the Plan page. These videos are embedded on the workout/calendar pages as YouTube iframes or links visible to authenticated members.

The existing `wod-scraper.js` already authenticates with BTWB via WodScreen's OAuth flow and holds valid BTWB cookies. The approach extends this scraper to navigate to the gym's BTWB workout page, extract the YouTube URL from the DOM, and write it as a managed row in the Google Sheets Playlist tab. The `google-spreadsheet` library is already installed and used for sheet writes. VideoManager already reads from the Playlist tab, so the brief video enters the rotation automatically.

**Primary recommendation:** After WOD scrape, open a new page with BTWB cookies, navigate to the gym's workout page, extract YouTube iframe/link src, and write it to the Sheets Playlist tab as a managed "Daily Brief" row. Use a sentinel title (e.g., `[Daily Brief]`) to identify and replace the row on each scrape cycle.
</research_summary>

<standard_stack>
## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| puppeteer-core | ^24.37.5 | Browser automation for BTWB scraping | Already used by wod-scraper.js |
| google-spreadsheet | (installed) | Google Sheets API wrapper | Already used by sheets-client.js for tab creation/writes |
| google-auth-library | (installed) | JWT auth for Sheets API | Already used by sheets-client.js |

### Supporting (Already Installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| config-loader | internal | YAML config with hot-reload | Config for BTWB gym URL, enable/disable |
| video-manager | internal | YouTube playlist management | Already reads Playlist tab, extracts YouTube IDs |

### No New Dependencies Required
This phase uses only libraries already in the project. The `google-spreadsheet` library supports row-level CRUD operations needed for writing the brief video URL to the Playlist tab.

**Installation:**
```bash
# Nothing new to install — all dependencies already present
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Approach: Sheets Write-Back

```
WodScraper.login()
  ├── Steps 1-5: Existing WodScreen auth flow (unchanged)
  └── Step 6 (NEW): Extract daily brief video
       ├── Open new page with BTWB cookies
       ├── Navigate to gym workout page
       ├── Extract YouTube URL from DOM
       ├── Write/update Playlist row via Sheets API
       └── Close extra page
```

### Pattern 1: Dedicated Brief Extractor Service
**What:** Create a `brief-extractor.js` service that runs after WOD scrape, reusing the browser instance and BTWB cookies from WodScraper
**When to use:** This is the recommended pattern — keeps wod-scraper.js focused on WOD display, new service handles brief extraction
**Example:**
```javascript
// services/brief-extractor.js
class BriefExtractor {
  constructor(wodScraper, sheetsClient) {
    this._wodScraper = wodScraper;
    this._sheetsClient = sheetsClient;
    this._lastVideoUrl = null;
  }

  async extractAndInject() {
    // Get browser from WodScraper (reuse authenticated session)
    const browser = this._wodScraper.browser;
    if (!browser) return;

    // Open new page with existing BTWB cookies
    const page = await browser.newPage();
    try {
      await page.setCookie(...this._wodScraper.cookies);
      await page.goto(gymWorkoutUrl, { waitUntil: 'networkidle2' });

      // Extract YouTube URL from workout narrative
      const videoUrl = await page.evaluate(() => {
        // Look for YouTube iframes
        const iframe = document.querySelector('iframe[src*="youtube"]');
        if (iframe) return iframe.src;

        // Look for YouTube links
        const link = document.querySelector('a[href*="youtube"], a[href*="youtu.be"]');
        if (link) return link.href;

        return null;
      });

      if (videoUrl) {
        await this._writeBriefToSheets(videoUrl);
      }
    } finally {
      await page.close();
    }
  }
}
```

### Pattern 2: Managed Playlist Row via Sentinel Title
**What:** Use a distinctive title like `[Daily Brief]` to identify the auto-managed row in the Sheets Playlist tab. On each scrape cycle, find and update this row (or create it if missing).
**When to use:** Always — prevents duplicate brief entries accumulating in the sheet
**Example:**
```javascript
async _writeBriefToSheets(videoUrl) {
  const auth = sheetsClient._createAuth();
  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle['Playlist'];
  if (!sheet) return;

  const rows = await sheet.getRows();
  const SENTINEL = '[Daily Brief]';

  // Find existing brief row
  const existing = rows.find(r => r.get('title') === SENTINEL);

  if (existing) {
    // Update URL if changed
    if (existing.get('url') !== videoUrl) {
      existing.set('url', videoUrl);
      existing.set('enabled', 'TRUE');
      await existing.save();
    }
  } else {
    // Create new managed row
    await sheet.addRow({
      url: videoUrl,
      title: SENTINEL,
      enabled: 'TRUE',
      days: '',     // Play every day (brief changes daily)
      focus: 'TRUE' // Focus mode so it plays prominently
    });
  }
}
```

### Pattern 3: BTWB Workout Page Navigation
**What:** Navigate to the gym's workout page on beyondthewhiteboard.com using authenticated cookies, not through WodScreen
**When to use:** WodScreen only shows text/stats — the brief video lives on the BTWB workout detail page
**Navigation approach:**
```javascript
// BTWB gym page URL patterns:
// - https://beyondthewhiteboard.com/gyms/{gym-id}  (calendar view)
// - https://beyondthewhiteboard.com/members/calendar (logged-in member view)
// - Mobile: https://m.beyondthewhiteboard.com/gym

// The gym_url should be configurable in config.yaml:
// wodscreen:
//   brief_url: "https://beyondthewhiteboard.com/members/calendar"
```

### Anti-Patterns to Avoid
- **Navigating WodScreen for the brief video:** WodScreen only displays text workout info, leaderboards, and movement GIFs — NO videos
- **In-memory playlist injection:** Loses state on restart; doesn't integrate with Sheets-first architecture
- **Scraping multiple BTWB pages:** Start with the simplest page that contains the video; don't crawl
- **Hardcoding DOM selectors:** BTWB is a React SPA that may change; use multiple fallback strategies
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YouTube ID extraction | Custom regex | Existing `extractYouTubeId()` in video-manager.js | Already handles all YouTube URL formats |
| Sheets row CRUD | Raw googleapis calls | `google-spreadsheet` library (already installed) | Row-level API with `.addRow()`, `.save()`, `.get()` |
| Browser auth | Separate BTWB login flow | Reuse WodScraper's browser + cookies | Auth already working; single browser instance saves Pi memory |
| Video playlist integration | Custom playlist injection code | Write to Sheets Playlist tab → VideoManager reads it | Existing architecture handles everything downstream |
| Scheduling | New cron/timer | Hook into existing WodScraper session loop | Already runs every 30 minutes with daily re-login at 4 AM |

**Key insight:** This phase is almost entirely plumbing — connecting an existing authenticated browser session to an existing playlist management system via an existing Sheets write mechanism. The only genuinely new work is discovering the correct BTWB page/DOM structure for the brief video.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: BTWB is a React SPA — DOM May Not Be Ready
**What goes wrong:** Navigating to the workout page and immediately querying the DOM returns null because React hasn't rendered yet
**Why it happens:** BTWB is a single-page React app; content loads asynchronously after initial page load
**How to avoid:** Use `waitForSelector` with a generous timeout to wait for workout content to render, or `waitForNetworkIdle` after navigation. Fall back to `waitForTimeout` if needed.
**Warning signs:** YouTube URL extraction returns null even when the page should have a video

### Pitfall 2: BTWB Page Structure is Unknown and May Change
**What goes wrong:** Hardcoded selectors break when BTWB updates their UI
**Why it happens:** BTWB is a private React SPA with no public DOM documentation; class names may be minified/hashed
**How to avoid:** Use multiple extraction strategies in priority order: (1) `iframe[src*="youtube"]`, (2) `a[href*="youtube"]` or `a[href*="youtu.be"]`, (3) regex scan of page HTML for YouTube URLs. Log extraction method used so failures are diagnosable.
**Warning signs:** Extraction worked yesterday but returns null today

### Pitfall 3: Cookie/Session Scope Issues
**What goes wrong:** New page opened with `setCookie` doesn't have valid BTWB session
**Why it happens:** Cookies may be scoped to WodScreen domain, not BTWB domain. Or BTWB may require additional session state (localStorage tokens).
**How to avoid:** WodScraper already extracts cookies from BOTH `wodscreen.com` and `beyondthewhiteboard.com` domains (line 236-238 of wod-scraper.js). Filter to BTWB-domain cookies when setting on the new page. If cookies alone don't work, try navigating BTWB within the same page context.
**Warning signs:** BTWB page redirects to login page despite setting cookies

### Pitfall 4: No Brief Video for Today
**What goes wrong:** Extraction crashes or creates empty playlist row when no video exists
**Why it happens:** Not all programming includes daily brief videos; some days may have no video attached
**How to avoid:** Treat "no video found" as a normal state, not an error. When no video is found: log at INFO level, keep previous brief row enabled if still valid, or disable it. Don't delete the row (avoids churn).
**Warning signs:** Errors in logs every day at 4 AM on rest days

### Pitfall 5: Pi Memory Constraints with Multiple Pages
**What goes wrong:** Opening a second Puppeteer page crashes or slows the Pi
**Why it happens:** Raspberry Pi has limited RAM; each Chromium page uses significant memory
**How to avoid:** Open the brief extraction page, extract the URL quickly, and close the page immediately. Don't keep it open. Consider extracting the brief during the daily re-login at 4 AM when the WOD page is being rebuilt anyway, rather than as a separate ongoing process.
**Warning signs:** Pi becomes sluggish after brief extraction; kiosk display stutters

### Pitfall 6: Stale Brief Video in Playlist
**What goes wrong:** Yesterday's brief video keeps playing because today's extraction failed silently
**Why it happens:** Extraction failed but the old Playlist row remains enabled
**How to avoid:** Track the date of the last successful extraction. If extraction fails and the existing row is >24 hours old, disable it (set enabled=FALSE). This prevents showing stale content while allowing the current day's video to persist through transient failures.
**Warning signs:** Same brief video playing for multiple days when programming changes daily
</common_pitfalls>

<code_examples>
## Code Examples

### Reusing WodScraper's Browser for Brief Extraction
```javascript
// Source: Existing wod-scraper.js patterns (lines 236-250)
// The scraper already extracts BTWB cookies - reuse them

async extractBriefVideo() {
  if (!this.browser || this.cookies.length === 0) {
    console.log('[BriefExtractor] No browser/cookies available — skipping');
    return null;
  }

  const page = await this.browser.newPage();
  try {
    // Set BTWB-domain cookies on the new page
    const btwbCookies = this.cookies.filter(c =>
      c.domain && c.domain.includes('beyondthewhiteboard')
    );
    if (btwbCookies.length > 0) {
      await page.setCookie(...btwbCookies);
    }

    // Navigate to gym workout page
    const config = configLoader.getConfig();
    const briefUrl = config.wodscreen.brief_url || 'https://beyondthewhiteboard.com/members/calendar';
    await page.goto(briefUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for workout content to render (React SPA)
    await page.waitForSelector('[class*="workout"], [class*="wod"], .narrative', {
      timeout: 15000
    }).catch(() => {});

    // Extract YouTube URL using multiple strategies
    const videoUrl = await page.evaluate(() => {
      // Strategy 1: YouTube iframe
      const iframe = document.querySelector('iframe[src*="youtube"], iframe[src*="youtu.be"]');
      if (iframe) return iframe.src;

      // Strategy 2: YouTube link
      const links = document.querySelectorAll('a[href*="youtube.com/watch"], a[href*="youtu.be/"]');
      for (const link of links) {
        return link.href;
      }

      // Strategy 3: Regex scan of page HTML for YouTube URLs
      const html = document.body.innerHTML;
      const match = html.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/);
      if (match) return match[0];

      return null;
    });

    return videoUrl;
  } finally {
    await page.close(); // Always close to free Pi memory
  }
}
```

### Writing Brief Video to Sheets Playlist Tab
```javascript
// Source: Existing sheets-client.js patterns (writeInstructionsTab, _writeTimingTab)
// Uses the same google-spreadsheet library and auth pattern

async writeBriefToPlaylist(videoUrl) {
  if (!this._isConfigured()) return;

  const SENTINEL_TITLE = '[Daily Brief]';

  try {
    const auth = this._createAuth();
    const doc = new GoogleSpreadsheet(this.spreadsheetId, auth);
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle['Playlist'];
    if (!sheet) {
      console.log('[Sheets] No Playlist tab — cannot write daily brief');
      return;
    }

    const rows = await sheet.getRows();
    const existingRow = rows.find(r => r.get('title') === SENTINEL_TITLE);

    if (existingRow) {
      const currentUrl = existingRow.get('url');
      if (currentUrl !== videoUrl) {
        existingRow.set('url', videoUrl);
        existingRow.set('enabled', 'TRUE');
        await existingRow.save();
        console.log(`[Sheets] Daily brief updated: ${videoUrl}`);
      } else {
        console.log('[Sheets] Daily brief URL unchanged');
      }
    } else {
      await sheet.addRow({
        url: videoUrl,
        title: SENTINEL_TITLE,
        enabled: 'TRUE',
        days: '',      // Every day — brief changes daily
        focus: 'TRUE'  // Prominent rotation
      });
      console.log(`[Sheets] Daily brief added: ${videoUrl}`);
    }
  } catch (err) {
    console.warn(`[Sheets] Failed to write daily brief: ${err.message}`);
  }
}
```

### Hooking Into the WOD Scrape Cycle
```javascript
// Source: Existing session loop pattern in wod-scraper.js (lines 544-589)
// Brief extraction runs after successful WOD login

// In the session loop or after login():
if (this.status === 'ready') {
  // Extract and inject daily brief (non-blocking)
  this._extractDailyBrief().catch(err => {
    console.warn(`[WodScraper] Brief extraction failed (non-fatal): ${err.message}`);
  });
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Puppeteer iframe access via contentFrame() | Direct page.evaluate() for same-origin | Stable | YouTube iframes are cross-origin; extract src attribute instead of accessing frame content |
| google-spreadsheet v3 row API | google-spreadsheet v4 with `row.get()/set()` | 2023 | Row objects use get/set instead of direct property access |
| Manual setCookie per domain | page.setCookie with domain array | Stable | Set all cookies at once; Puppeteer handles domain matching |

**New tools/patterns to consider:**
- **Puppeteer `page.waitForNetworkIdle()`:** More reliable than `networkidle2` for SPAs that make many sequential API calls
- **`google-spreadsheet` addRow with insert option:** Can insert at a specific position if ordering matters

**Deprecated/outdated:**
- **Puppeteer `page.waitForNavigation()` alone:** Not sufficient for SPAs; combine with `waitForSelector` or `waitForNetworkIdle`
- **Direct property access on google-spreadsheet rows:** Use `row.get('column')` and `row.set('column', value)` in v4+
</sota_updates>

<open_questions>
## Open Questions

1. **Exact BTWB workout page URL and DOM structure**
   - What we know: Gym pages are at `beyondthewhiteboard.com/gyms/{id}`, member calendar at `/members/calendar`. YouTube brief videos are attached via the BTWB Plan page and display as iframes or links.
   - What's unclear: The exact DOM selectors for the brief video on the authenticated workout page. BTWB is a React SPA with potentially minified class names.
   - Recommendation: Make the `brief_url` configurable in config.yaml. During first implementation, add verbose logging of page HTML structure. Use multiple extraction strategies (iframe src, link href, regex) with fallbacks. Consider a **discovery step** during first run that logs available YouTube URLs on the page for manual verification.

2. **Which BTWB page shows the brief video in web view?**
   - What we know: The mobile app shows it on the calendar page. WodScreen does NOT show it. The coaching "Plan" page is where it's attached.
   - What's unclear: Whether the member-facing web view (`/members/calendar` or `/gyms/{id}`) renders the brief video, or if it's mobile-app-only.
   - Recommendation: Test with the authenticated browser during implementation. Try `/members/calendar` first, then the gym-specific page. If neither works, try the mobile site (`m.beyondthewhiteboard.com/gym`).

3. **Sheets Playlist row management — focus mode appropriate?**
   - What we know: Focus mode alternates the video into every other rotation slot, making it very prominent.
   - What's unclear: Whether the gym owner wants the brief video to be prominent (focus=TRUE) or just part of normal rotation (focus=FALSE).
   - Recommendation: Default to `focus: TRUE` (the brief is the most time-relevant content). Make configurable via config.yaml `wodscreen.brief_focus: true/false`.

4. **Timing: When should brief extraction run?**
   - What we know: WOD scrape runs every 30 minutes with daily re-login at 4 AM. Programming typically posts the night before or early morning.
   - What's unclear: Exactly when the brief video is attached to the workout (could be same time as workout text, or later).
   - Recommendation: Run brief extraction on every WOD scrape cycle (every 30 min). This catches both early and late-posted videos. The Sheets write is idempotent so frequent checks are harmless.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- Existing codebase: `services/wod-scraper.js` — Full Puppeteer auth flow, cookie extraction, session management
- Existing codebase: `services/video-manager.js` — YouTube URL extraction, Sheets Playlist reading, day filtering
- Existing codebase: `services/sheets-client.js` — google-spreadsheet library usage, tab creation, row writes
- BTWB blog: "Running a Virtual Gym" — Confirms YouTube brief videos are attached to workouts via Plan page

### Secondary (MEDIUM confidence)
- BTWB blog: "Feature Release: Coaches Notes" — Confirms WOD Brief video attachment and Movement Demo categories
- BTWB blog: "WodScreen Updates" — Confirms WodScreen does NOT show video content (text/leaderboards/GIFs only)
- BTWB support: WodScreen Daily WODs — Confirms WodScreen displays up to 4 workouts, top performers, movement GIFs
- Web search: BTWB URL patterns — `/gyms/{id}` and `/members/calendar` URL structure confirmed
- Web search: Puppeteer iframe extraction best practices — waitForSelector, try-catch, multiple extraction strategies

### Tertiary (LOW confidence - needs validation during implementation)
- BTWB workout page DOM structure — Cannot verify without authenticated access; selectors are hypothetical
- Whether web view (not just mobile app) renders brief video — needs runtime testing
- Exact YouTube embed format on BTWB pages (iframe vs link vs embedded player) — needs runtime discovery
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Puppeteer browser automation + Google Sheets API (both existing)
- Ecosystem: BTWB workout page structure, YouTube embed extraction
- Patterns: Sheets write-back, sentinel row management, browser session reuse
- Pitfalls: SPA rendering timing, cookie scoping, Pi memory, stale content

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and in use
- Architecture: HIGH — extends existing patterns (wod-scraper + sheets-client)
- Pitfalls: HIGH — derived from existing production experience with wod-scraper
- Code examples: MEDIUM — based on existing codebase patterns; BTWB DOM selectors unverified
- BTWB page structure: LOW — needs runtime discovery during implementation

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (30 days — BTWB may update their UI but architecture approach is stable)
</metadata>

---

*Phase: 18-daily-workout-brief-video*
*Research completed: 2026-03-16*
*Ready for planning: yes*
