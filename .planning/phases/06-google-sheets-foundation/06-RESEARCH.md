# Phase 6: Google Sheets Foundation - Research

**Researched:** 2026-02-23
**Domain:** Google Sheets API v4 integration with Node.js for a Raspberry Pi display system
**Confidence:** HIGH

<research_summary>
## Summary

Researched the Google Sheets API v4 ecosystem for building a read-only polling integration in a Node.js Express application on Raspberry Pi. The standard approach uses `google-spreadsheet` (v5.2.0) as a high-level wrapper over the raw `googleapis` client, with `google-auth-library` for service account JWT authentication.

Key finding: This is a well-solved problem domain. The `google-spreadsheet` wrapper handles token refresh, rate-limit retry with exponential backoff, and typed data access automatically. The existing MindBody polling pattern in `services/mindbody.js` maps 1:1 to the Sheets integration architecture — singleton class, `setInterval` polling, in-memory cache, stale-cache-on-error resilience.

**Primary recommendation:** Use `google-spreadsheet` v5 + `google-auth-library` for JWT auth. Follow the existing MindBody service pattern. Poll every 5 minutes with `batchGet`-equivalent calls. Store service account credentials in `config.yaml` (gitignored, same as existing MindBody credentials pattern).
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| google-spreadsheet | 5.2.0 | High-level Sheets API wrapper | Built-in retry/backoff, row-based API, simpler than raw googleapis |
| google-auth-library | latest | JWT service account authentication | Official Google auth library, automatic token refresh |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| googleapis | 171.4.0 | Raw Google API client | Only if needing Drive API or other Google services alongside Sheets |
| @googleapis/sheets | 12.0.0 | Scoped Sheets-only client | Lighter alternative to full googleapis, but less documented |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| google-spreadsheet | raw googleapis | googleapis is lower-level, requires hand-rolling retry/backoff, but gives access to batchGet and all API params |
| google-spreadsheet | @googleapis/sheets | Scoped package is lighter but less community documentation |
| Service account JSON file | Environment variables | Env vars avoid file on disk but complicate private key newline handling |

**Installation:**
```bash
npm install google-spreadsheet google-auth-library
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
services/
├── sheets-client.js     # Google Sheets polling client (new)
├── mindbody.js          # Existing MindBody client (pattern to follow)
├── config-loader.js     # Existing config loader (reuse)
└── ...
```

### Pattern 1: Singleton Polling Service (match existing MindBody pattern)
**What:** A class that polls Sheets on an interval, caches data in memory, and serves it synchronously to route handlers.
**When to use:** Any periodic external data source for the display system.
**Example:**
```javascript
// Source: Matches existing services/mindbody.js pattern
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

class SheetsClient {
  constructor() {
    this.cachedData = {};
    this.lastPoll = null;
    this.polling = false;
    this._interval = null;
  }

  _createAuth() {
    return new JWT({
      email: this.serviceAccountEmail,
      key: this.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }

  async poll() {
    try {
      const doc = new GoogleSpreadsheet(this.spreadsheetId, this._createAuth());
      await doc.loadInfo();
      // Read each configured tab...
      this.lastPoll = Date.now();
    } catch (err) {
      console.warn(`[Sheets] Poll failed: ${err.message}`);
      // Keep stale cache — display shows last-known-good data
    }
  }

  startPolling() {
    this.poll();
    this._interval = setInterval(() => this.poll(), this.pollIntervalMs);
  }
}

module.exports = new SheetsClient();
```

### Pattern 2: Service Account JWT Authentication
**What:** Use a Google Cloud service account with a JSON key for server-to-server auth. No OAuth consent flow needed.
**When to use:** Server applications that access Google APIs without user interaction.
**Example:**
```javascript
// Source: google-auth-library official docs
const { JWT } = require('google-auth-library');

const auth = new JWT({
  email: 'display@project-id.iam.gserviceaccount.com',
  key: '-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
// Token refresh is automatic — never manage tokens manually
```

### Pattern 3: Multi-Tab Reading with batchGet (raw googleapis)
**What:** Read multiple sheet tabs in a single API call (counts as 1 request against quota).
**When to use:** When reading from 2+ tabs per poll cycle.
**Example:**
```javascript
// Source: Google Sheets API official docs — batchGet
// Note: This is the raw googleapis pattern. google-spreadsheet uses
// doc.loadInfo() + sheet.getRows() per tab instead.
const result = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: SPREADSHEET_ID,
  ranges: ['Schedule!A1:G', 'Announcements!A2:B', 'Leaderboard!A1:F'],
  valueRenderOption: 'FORMATTED_VALUE',
});
// result.data.valueRanges[0].values => Schedule data
// result.data.valueRanges[1].values => Announcements data
```

### Pattern 4: Config-Driven Credentials (match existing config.yaml pattern)
**What:** Store Sheets credentials in config.yaml alongside existing MindBody credentials. Same gitignore protection, same hot-reload support.
**When to use:** This project — credentials are already managed via config.yaml.
**Example:**
```yaml
# config.yaml (gitignored — credentials stay local on Pi only)
sheets:
  spreadsheet_id: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
  service_account_email: "display@project-id.iam.gserviceaccount.com"
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
  poll_interval_minutes: 5
```

### Anti-Patterns to Avoid
- **OAuth2 for server-to-server:** Service accounts don't need OAuth consent screens. Using OAuth when a service account suffices adds unnecessary complexity.
- **Polling faster than 1 minute:** No display content changes fast enough to justify sub-minute polling. It wastes quota for no benefit.
- **Creating a new GoogleSpreadsheet instance per request:** Instantiate once (or per poll cycle), not per API handler call.
- **Storing credentials in code or committed files:** Always use gitignored config files or environment variables.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token refresh | Manual token caching + expiry check | google-auth-library JWT | Automatic refresh, handles edge cases (clock skew, network retry) |
| Rate limit retry | Custom retry loop with delays | google-spreadsheet built-in | Library retries 429s with exponential backoff automatically |
| Exponential backoff | Math.pow(2, attempt) * 1000 + jitter | google-spreadsheet built-in | Google's recommended formula is already implemented in the library |
| Data type conversion | parseInt/parseFloat on cell values | google-spreadsheet cell.value | Library returns typed values (number, boolean, string) |
| A1 range notation builder | String concatenation for ranges | Direct string literals | Range notation is simple enough (`'TabName!A1:Z'`) — a builder adds complexity for no gain |
| Webhook change detection | Drive API push notifications | Poll + hash comparison | Pi has no public HTTPS endpoint; webhook renewal every 7 days adds ops burden |

**Key insight:** Google's auth ecosystem is mature and handles the hard parts (token lifecycle, retry, backoff) automatically. The existing project already has the correct polling/caching pattern in `services/mindbody.js`. Phase 6 is integration work, not architecture invention.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Service Account Not Shared on the Sheet
**What goes wrong:** All API calls return 403 or "Requested entity was not found" with a confusing error message.
**Why it happens:** The service account is a separate Google identity. It has zero access to any sheets by default — even sheets in the same Google Workspace.
**How to avoid:** After creating the service account, open the Google Sheet → Share → add the service account email (e.g., `display@project-id.iam.gserviceaccount.com`) as a Viewer.
**Warning signs:** 403 errors on first run despite correct credentials.

### Pitfall 2: Private Key Newline Mangling
**What goes wrong:** Auth fails with "error:0909006C:PEM routines" or similar OpenSSL error.
**Why it happens:** When the private key is stored in config.yaml or environment variables, `\n` literal characters get escaped to `\\n`. The JWT library needs actual newlines.
**How to avoid:** Always apply `.replace(/\\n/g, '\n')` when reading the private key from config/env.
**Warning signs:** PEM/OpenSSL errors during auth, key "looks right" but doesn't parse.

### Pitfall 3: FORMATTED_VALUE Returns Strings for Everything (raw googleapis)
**What goes wrong:** Numbers come back as `"42"` (string), currencies as `"$1,234.00"`, dates as locale strings.
**Why it happens:** The default `valueRenderOption` is `FORMATTED_VALUE` which returns display strings, not typed values.
**How to avoid:** Use `google-spreadsheet` library which provides typed `cell.value` alongside `cell.formattedValue`. Or use `UNFORMATTED_VALUE` with raw googleapis (but then dates become serial numbers).
**Warning signs:** All values are strings, numeric sorting doesn't work.

### Pitfall 4: Tab Names Are Case-Sensitive
**What goes wrong:** `doc.sheetsByTitle['schedule']` returns `undefined` when the tab is named `Schedule`.
**Why it happens:** JavaScript object property lookup is case-sensitive.
**How to avoid:** Use exact tab names matching the Google Sheet. Or use `doc.sheetsByIndex[0]` for positional access.
**Warning signs:** `undefined` errors when accessing sheet data.

### Pitfall 5: getRows() Fragile with Non-Standard Headers
**What goes wrong:** Row objects have missing or wrong property names.
**Why it happens:** `getRows()` uses the first row as column headers. Merged cells, empty headers, or duplicate column names break the mapping.
**How to avoid:** Ensure sheet has clean, unique header row. Or use `loadCells()` with explicit coordinates for full control.
**Warning signs:** Row data doesn't match expected columns.

### Pitfall 6: Many Small Requests Instead of Range Reads
**What goes wrong:** Quota is consumed rapidly, 429 errors appear.
**Why it happens:** Fetching 50 individual cells costs 50 quota units vs. fetching a range (`A1:J50`) which costs 1.
**How to avoid:** Always fetch ranges or use `getRows()` which fetches the entire sheet in one call.
**Warning signs:** 429 rate limit errors despite low poll frequency.

### Pitfall 7: Cold Start Quota Spike
**What goes wrong:** If the Node process crashes and restarts repeatedly (systemd auto-restart), each startup triggers an immediate poll. Multiple rapid restarts spike API calls.
**Why it happens:** No startup debounce or "last poll" persistence across restarts.
**How to avoid:** Add a brief startup delay (e.g., 5 seconds) before first poll, or check if poll was recent before re-polling.
**Warning signs:** Multiple crash/restart cycles in logs, occasional 429 on startup.
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources:

### Service Account Auth with google-spreadsheet v5
```javascript
// Source: google-spreadsheet npm docs + google-auth-library
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const serviceAccountAuth = new JWT({
  email: config.sheets.service_account_email,
  key: config.sheets.private_key.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const doc = new GoogleSpreadsheet(config.sheets.spreadsheet_id, serviceAccountAuth);
await doc.loadInfo(); // loads sheet metadata (tab names, properties)
console.log(doc.title); // spreadsheet title
```

### Reading Rows from a Tab
```javascript
// Source: google-spreadsheet npm docs
const sheet = doc.sheetsByTitle['Announcements'];
const rows = await sheet.getRows();

// rows is an array of GoogleSpreadsheetRow objects
rows.forEach(row => {
  console.log(row.get('Title'));   // access by header name
  console.log(row.get('Active')); // returns string 'TRUE' or 'FALSE'
});
```

### Reading Cells with loadCells (more control)
```javascript
// Source: google-spreadsheet npm docs
const sheet = doc.sheetsByTitle['Leaderboard'];
await sheet.loadCells('A1:F20');

const cell = sheet.getCell(1, 0); // row 1, col 0 (0-indexed)
console.log(cell.value);          // typed value (number, string, boolean)
console.log(cell.formattedValue); // display string as Sheets shows it
```

### Discovering Tab Names
```javascript
// Source: google-spreadsheet npm docs
await doc.loadInfo();
const sheetTitles = doc.sheetsByIndex.map(s => s.title);
console.log(sheetTitles); // ['Schedule', 'Announcements', 'Leaderboard']
```

### Raw googleapis batchGet (alternative for multi-tab efficiency)
```javascript
// Source: Google Sheets API official docs
const { google } = require('googleapis');

const auth = new google.auth.GoogleAuth({
  keyFile: '/path/to/credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

const result = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: SPREADSHEET_ID,
  ranges: ['Tab1!A1:Z', 'Tab2!A1:Z', 'Tab3!A1:Z'],
  valueRenderOption: 'FORMATTED_VALUE',
});

// result.data.valueRanges[0].values => Tab1 data (array of arrays)
// result.data.valueRanges[1].values => Tab2 data
```

### Stale-Cache-on-Error Pattern (matches existing MindBody approach)
```javascript
// Source: Established pattern from services/mindbody.js
async poll() {
  try {
    const doc = new GoogleSpreadsheet(this.spreadsheetId, this._createAuth());
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[this.tabName];
    const rows = await sheet.getRows();

    this.cachedData = rows.map(row => ({
      title: row.get('Title') || '',
      body: row.get('Body') || '',
      active: row.get('Active') === 'TRUE',
    }));

    this.lastPoll = Date.now();
    console.log(`[Sheets] Polled: ${this.cachedData.length} rows`);
  } catch (err) {
    console.warn(`[Sheets] Poll failed: ${err.message}`);
    // Keep stale cache — display continues showing last-known-good data
  }
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| googleapis (raw) for simple reads | google-spreadsheet v5 wrapper | 2023+ (v4→v5 rewrite) | Built-in retry, cleaner API, TypeScript support |
| Manual token management | google-auth-library auto-refresh | Ongoing | Token lifecycle fully automated for service accounts |
| google-spreadsheet v4 (callback-style) | google-spreadsheet v5 (async/await, ESM) | 2023 | Breaking API change — v5 requires google-auth-library as peer dep |
| OAuth2 for server apps | Service account JWT | Long-standing | Service accounts are the correct pattern for server-to-server |

**New tools/patterns to consider:**
- **google-spreadsheet v5.2.0:** Latest release (Feb 2026), actively maintained, MIT license
- **@googleapis/sheets scoped package:** Lighter alternative to full googleapis monolith if you prefer raw API access

**Deprecated/outdated:**
- **google-spreadsheet v3/v4:** Major API changes in v5; older tutorials reference deprecated methods
- **Manual gtoken/jwt-client packages:** Superseded by google-auth-library which bundles everything
- **googleapis for simple Sheets reads:** Overkill for read-only single-sheet use cases; google-spreadsheet is the pragmatic choice
</sota_updates>

<open_questions>
## Open Questions

1. **Should we use google-spreadsheet or raw googleapis for multi-tab reads?**
   - What we know: `google-spreadsheet` requires separate `getRows()` calls per tab (one API call each). Raw `googleapis` supports `batchGet` to read multiple tabs in a single API call.
   - What's unclear: Whether the per-tab overhead matters at a 5-minute poll interval (it almost certainly doesn't).
   - Recommendation: Start with `google-spreadsheet` for simplicity. If Phase 8 (Leaderboard) and Phase 9 (Announcements) add enough tabs that per-tab calls feel wasteful, switch to `googleapis` `batchGet` at that point. At 5-minute intervals with 3-4 tabs, the quota impact is negligible either way (~1 vs ~4 requests per poll).

2. **Where to store credentials on Pi — config.yaml or separate file?**
   - What we know: Existing pattern uses `config.yaml` (gitignored, chmod 600) for MindBody credentials. Google service account credentials include a long private key that may be awkward in YAML.
   - What's unclear: Whether the private key's embedded newlines will cause YAML parsing issues.
   - Recommendation: Use `config.yaml` for spreadsheet ID, service account email, and a `credentials_file` path pointing to the JSON key file stored separately (e.g., `/home/BigBarn/secrets/google-credentials.json`). This keeps the pattern consistent while avoiding YAML multiline key issues. Alternative: inline the private key in config.yaml with proper YAML multiline syntax.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [Google Sheets API Quickstart - Node.js](https://developers.google.com/workspace/sheets/api/quickstart/nodejs) — setup, auth, basic reads
- [Google Sheets API Usage Limits](https://developers.google.com/workspace/sheets/api/limits) — 300 read/min project, 60 read/min user
- [Google Sheets API Reading Samples](https://developers.google.com/workspace/sheets/api/samples/reading) — batchGet, range notation
- [google-spreadsheet npm](https://www.npmjs.com/package/google-spreadsheet) — v5.2.0, Feb 2026
- [google-spreadsheet GitHub](https://github.com/theoephraim/node-google-spreadsheet) — API reference, auth examples
- [googleapis npm](https://www.npmjs.com/package/googleapis) — v171.4.0
- [google-auth-library GitHub](https://github.com/googleapis/google-auth-library-nodejs) — JWT, service account auth
- [Google OAuth2 Service Accounts](https://developers.google.com/identity/protocols/oauth2/service-account) — service account setup

### Secondary (MEDIUM confidence)
- [google-spreadsheet vs @googleapis/sheets comparison](https://npm-compare.com/google-spreadsheet,@googleapis/sheets) — download trends, feature comparison
- [Google Sheets API Troubleshooting](https://developers.google.com/workspace/sheets/api/troubleshoot-api-errors) — error codes, 403/429 handling
- [Stateful - Google Sheets API Limits Guide](https://stateful.com/blog/google-sheets-api-limits) — practical quota guidance

### Tertiary (LOW confidence - needs validation)
- None — all findings verified against official sources
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Google Sheets API v4
- Ecosystem: google-spreadsheet, google-auth-library, googleapis
- Patterns: Polling service, singleton cache, service account JWT, stale-cache resilience
- Pitfalls: Auth sharing, private key newlines, case-sensitive tabs, quota management

**Confidence breakdown:**
- Standard stack: HIGH — verified with npm registry, official Google docs
- Architecture: HIGH — matches existing project patterns (services/mindbody.js)
- Pitfalls: HIGH — documented in official troubleshooting guides, confirmed by multiple sources
- Code examples: HIGH — from official library docs and Google API samples

**Research date:** 2026-02-23
**Valid until:** 2026-03-25 (30 days — Google Sheets API ecosystem is stable)
</metadata>

---

*Phase: 06-google-sheets-foundation*
*Research completed: 2026-02-23*
*Ready for planning: yes*
