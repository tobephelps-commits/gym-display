# Phase 4: MindBody Integration - Research

**Researched:** 2026-02-21
**Domain:** MindBody Public API v6 — class schedules, roster/check-in data, token management
**Confidence:** HIGH

<research_summary>
## Summary

Researched the MindBody Public API v6 ecosystem for building a live class roster display. The API is straightforward REST/JSON with header-based auth (Api-Key + SiteId + staff user token). No official SDK exists for any language; community npm packages are unmaintained. Direct axios calls are the standard approach.

Key findings: Token lasts 7 days unused, `GET /class/classes` returns today's schedule, `GET /class/classvisits` returns per-class roster with a `SignedIn` boolean for check-in status. Rate limit is 1,000 calls/day free. Timestamps lack timezone info — this is a known pain point requiring hardcoded site timezone. Sandbox available at SiteId `-99`.

**Primary recommendation:** Build a thin axios-based MindBody client with proactive token refresh, poll class schedule every 15-30 min, poll active class roster every 60s, display first name + last initial for privacy.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| axios | latest | HTTP client for MindBody API | Already in project, reliable, interceptors for auth |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none needed) | — | — | MindBody API is simple REST; no additional dependencies required |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| axios | node-fetch | Either works; axios already in project for consistency |
| Custom client | mindbody-sdk (npm) | Community packages are unmaintained (~1 download/week), don't use |
| Custom client | SplitPass/mindbody-api | TypeScript-focused, adds dependency for simple REST calls |

**No official MindBody SDK exists.** All community npm packages (mindbody-sdk, mindbody-node-client, mindbody-api-v6) are effectively abandoned. Direct axios is the standard approach — the API is simple enough that a wrapper adds no value.

**Installation:**
```bash
# No new packages needed — axios already in project
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Module Structure
```
src/
├── services/
│   └── mindbody.js          # MindBody API client (auth, classes, roster)
├── routes/
│   └── roster.js            # GET /api/roster endpoint for frontend
└── (existing zone controller, config, etc.)
```

### Pattern 1: Thin API Client with Token Cache
**What:** Single module that handles auth, token caching, and all MindBody API calls
**When to use:** Always — this is the standard pattern for MindBody integrations
**Example:**
```javascript
// Source: MindBody API docs + community patterns
const axios = require('axios');

const BASE_URL = 'https://api.mindbodyonline.com/public/v6';

class MindBodyClient {
  constructor(apiKey, siteId, username, password) {
    this.apiKey = apiKey;
    this.siteId = siteId;
    this.username = username;
    this.password = password;
    this.token = null;
    this.tokenIssuedAt = null;
  }

  async getToken() {
    // Token lasts 7 days unused; refresh proactively at 6 days
    const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
    if (this.token && this.tokenIssuedAt && (Date.now() - this.tokenIssuedAt < SIX_DAYS_MS)) {
      return this.token;
    }

    const response = await axios.post(`${BASE_URL}/usertoken/issue`, {
      Username: this.username,
      Password: this.password
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': this.apiKey,
        'SiteId': this.siteId
      }
    });

    this.token = response.data.AccessToken;
    this.tokenIssuedAt = Date.now();
    return this.token;
  }

  async get(path, params = {}) {
    const token = await this.getToken();
    const response = await axios.get(`${BASE_URL}${path}`, {
      params,
      headers: {
        'Api-Key': this.apiKey,
        'SiteId': this.siteId,
        'Authorization': token
      }
    });
    return response.data;
  }
}
```

### Pattern 2: Two-Tier Polling with Smart Scheduling
**What:** Poll class schedule infrequently, poll active class roster frequently
**When to use:** For any live display that needs current roster data within API rate limits
**Example:**
```javascript
// Schedule poll: every 15-30 minutes
// Roster poll: every 60 seconds, only for classes currently active or starting soon

async function pollSchedule() {
  const today = new Date().toISOString().split('T')[0];
  const data = await client.get('/class/classes', { StartDate: today, EndDate: today });
  cachedSchedule = data.Classes.filter(c => !c.IsCancelled);
}

async function pollActiveRoster() {
  const now = new Date();
  const activeClass = cachedSchedule.find(c => {
    const start = new Date(c.StartDateTime);
    const end = new Date(c.EndDateTime);
    return now >= start && now <= end;
  });

  if (activeClass) {
    const data = await client.get('/class/classvisits', { ClassId: activeClass.Id });
    cachedRoster = data.Class?.Visits || [];
  }
}
```

### Pattern 3: Class-Aware Zone Boosting
**What:** Increase roster zone frequency when a class is active or about to start
**When to use:** During class windows to show roster more often in the rotation
**Example:**
```javascript
// Boost logic: 15 min before class start through class end
function shouldBoostRoster(schedule) {
  const now = new Date();
  const BOOST_LEAD_MIN = 15;
  return schedule.some(c => {
    const start = new Date(c.StartDateTime);
    const end = new Date(c.EndDateTime);
    const boostStart = new Date(start.getTime() - BOOST_LEAD_MIN * 60000);
    return now >= boostStart && now <= end;
  });
}
```

### Anti-Patterns to Avoid
- **Polling all class rosters at once:** Only poll the currently active class — saves API calls, stays within rate limits
- **Relying on API for timezone:** Timestamps lack timezone info; hardcode site timezone in config
- **Using community npm packages:** All are unmaintained; you'll own more bugs than you solve
- **Storing tokens to disk:** Tokens in memory only — writing to config.yaml triggers hot-reload loop (per project decision)
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client | Custom fetch wrapper | axios (already in project) | Interceptors, error handling, timeout support built in |
| Date/time parsing | Manual string parsing | `new Date()` with configured timezone offset | MindBody timestamps are ISO-ish but timezone-naive |

**Key insight:** The MindBody API is simple REST — there's very little to hand-roll OR to use libraries for. The complexity is in the polling strategy and display logic, not the API calls themselves. Don't over-engineer the API client; a thin wrapper with token caching is all you need.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Timezone-Naive Timestamps
**What goes wrong:** Class times display incorrectly or class-active detection is off by hours
**Why it happens:** MindBody API returns timestamps WITHOUT timezone offset information. Timestamps may be in the site's local timezone, Pacific Time, or UTC depending on the endpoint.
**How to avoid:** Hardcode the gym's timezone in config.yaml. During development with sandbox (SiteId -99), test against known class times to determine the timestamp timezone. Apply consistent timezone handling throughout.
**Warning signs:** Classes showing as "active" when they shouldn't be, or roster not updating during actual class times.

### Pitfall 2: Rate Limit Budget Exceeded
**What goes wrong:** API calls start costing money or getting throttled (HTTP 429)
**Why it happens:** 1,000 free calls/day seems like a lot, but polling every 30 seconds for 12 hours = 1,440 calls for roster alone
**How to avoid:** Budget carefully. Poll roster at 60s intervals (not 30s). Only poll active classes. Cache schedule data for 15-30 min. Calculate: (schedule_polls/day) + (roster_polls/day) < 1000.
**Warning signs:** Overage charges on MindBody billing, 429 HTTP responses.

### Pitfall 3: Inconsistent API Field Types
**What goes wrong:** Code breaks on unexpected null values or type mismatches
**Why it happens:** MindBody API has inconsistent patterns — IDs are sometimes strings, sometimes numbers. Fields that should be required are sometimes null. SplitPass library maintainers explicitly warn about this.
**How to avoid:** Defensive coding with optional chaining and fallbacks. Don't assume response shapes — validate key fields exist before using them.
**Warning signs:** TypeError crashes, undefined property access on roster data.

### Pitfall 4: Duplicate Client Records
**What goes wrong:** Same person appears twice in the roster display
**Why it happens:** MindBody has known issues with duplicate client accounts (same name, different ClientId)
**How to avoid:** Deduplicate by ClientId, not by name. If duplicates persist, consider deduplicating by (FirstName + LastName) combination for display purposes.
**Warning signs:** Athlete names appearing twice on the roster board.

### Pitfall 5: Authorization Header Format Ambiguity
**What goes wrong:** Auth requests fail with 401
**Why it happens:** Conflicting documentation on whether the Authorization header should be the raw token or prefixed with "Bearer "
**How to avoid:** Test both formats against sandbox during development. Try raw token first (most sources indicate this is correct), fall back to "Bearer {token}" if that fails.
**Warning signs:** Consistent 401 responses despite valid credentials.

### Pitfall 6: Pagination Not Handled
**What goes wrong:** Only first page of classes or visits returned, missing data
**Why it happens:** API paginates results. Known bug: `TotalResults` field previously echoed the `Limit` value instead of actual total.
**How to avoid:** Implement pagination defensively — keep fetching while result count equals limit, don't rely solely on TotalResults. For a single gym's daily schedule, pagination is unlikely to matter (typically <20 classes/day), but handle it correctly for roster data.
**Warning signs:** Roster appears incomplete, missing athletes who are checked in.
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources and cross-referenced community implementations:

### Authentication — Token Acquisition
```javascript
// Source: MindBody API docs, POST /usertoken/issue
async function issueToken(apiKey, siteId, username, password) {
  const response = await axios.post(
    'https://api.mindbodyonline.com/public/v6/usertoken/issue',
    { Username: username, Password: password },
    {
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': apiKey,
        'SiteId': siteId
      }
    }
  );
  return response.data.AccessToken;
}
```

### Get Today's Classes
```javascript
// Source: MindBody API docs, GET /class/classes
async function getTodaysClasses(client) {
  const today = new Date().toISOString().split('T')[0]; // "2026-02-21"
  const data = await client.get('/class/classes', {
    StartDate: today,
    EndDate: today
  });
  return (data.Classes || []).filter(c => !c.IsCancelled);
}
```

### Get Class Roster with Check-in Status
```javascript
// Source: MindBody API docs, GET /class/classvisits
// Requires staff-level token
async function getClassRoster(client, classId) {
  const data = await client.get('/class/classvisits', { ClassId: classId });
  const visits = data.Class?.Visits || [];

  return {
    checkedIn: visits.filter(v => v.SignedIn === true),
    registered: visits.filter(v => !v.SignedIn && !v.LateCancelled),
    total: visits.filter(v => !v.LateCancelled).length
  };
}
```

### Display Name Formatting (Privacy)
```javascript
// Display first name + last initial for privacy
function formatDisplayName(visit) {
  const name = visit.Client?.DisplayName || visit.Name || 'Unknown';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[parts.length - 1][0]}.`;
  }
  return parts[0];
}
```

### Sandbox Testing Setup
```javascript
// Source: MindBody Developer Portal
// Sandbox credentials — resets nightly
const SANDBOX_CONFIG = {
  apiKey: 'YOUR_API_KEY',     // From developer portal registration
  siteId: '-99',              // Official sandbox site
  username: 'Siteowner',      // Sandbox staff username
  password: 'apitest1234'     // Sandbox staff password
};
// Same base URL for sandbox and production:
// https://api.mindbodyonline.com/public/v6
// Difference is only the SiteId header value
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SOAP API (v5) | REST API (v6) | 2018+ | V6 is the current standard; SOAP is legacy |
| Community npm SDKs | Direct axios/fetch | Ongoing | All npm packages effectively abandoned |
| Polling only | Webhooks + polling | 2023+ | Webhooks available for schedule changes |

**New tools/patterns to consider:**
- **Webhooks API:** Can subscribe to `classSchedule.created/updated/cancelled` and `class.updated` events. However, there's no confirmed webhook for "client checked in" — polling `classvisits` is still needed for live roster.
- **OAuth 2.0 flow:** Available for partner integrations, but overkill for a single-site display. Staff user tokens via `/usertoken/issue` are simpler and sufficient.

**Deprecated/outdated:**
- **SOAP API (v5):** Still technically available but should not be used for new integrations
- **Community npm packages:** mindbody-sdk, mindbody-node-client — abandoned, don't use
</sota_updates>

<open_questions>
## Open Questions

1. **Authorization header format — raw token or "Bearer " prefix?**
   - What we know: Most sources show the raw token value. Some show "Bearer " prefix.
   - What's unclear: Official docs are behind JS-rendered Swagger UI that can't be scraped.
   - Recommendation: Test both against sandbox during Phase 4 implementation. Try raw token first.

2. **Exact classvisits response field names in V6**
   - What we know: Visit objects have `SignedIn`, `LateCancelled`, `Client.DisplayName` etc. based on SOAP v5 schema and community libraries.
   - What's unclear: Exact field casing and nesting in V6 REST response (Swagger UI is JS-rendered).
   - Recommendation: Make a sandbox call early in implementation to capture actual response shape. Build types from real data.

3. **Webhook support for check-in events**
   - What we know: Webhooks exist for schedule changes. `class.updated` may fire on roster changes.
   - What's unclear: Whether check-in specifically triggers a webhook event.
   - Recommendation: Start with polling (simpler, proven). Webhooks are a future optimization if needed.

4. **Timestamp timezone for SiteId -99 sandbox**
   - What we know: Timestamps lack timezone info. Could be site local time, Pacific, or UTC.
   - What's unclear: What timezone the sandbox uses.
   - Recommendation: Test against sandbox with known class times. Hardcode timezone in config.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [MindBody Developer Portal](https://developers.mindbodyonline.com/) — API overview, authentication flow
- [MindBody Public API V6.0 Docs](https://developers.mindbodyonline.com/PublicDocumentation/V6) — endpoint reference
- [MindBody API FAQ](https://support.mindbodyonline.com/s/article/API-FAQ?language=en_US) — token expiry (7 days), rate limits
- [MindBody Webhooks Docs](https://developers.mindbodyonline.com/WebhooksDocumentation) — webhook event types
- [MindBody API Release Notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes) — classvisits, DisplayName fixes

### Secondary (MEDIUM confidence)
- [SplitPass/mindbody-api (GitHub)](https://github.com/SplitPass/mindbody-api) — TypeScript types for request/response shapes, API inconsistency warnings
- [justwillgreene/mindbody (GitHub)](https://github.com/justwillgreene/mindbody) — Node.js client patterns, endpoint usage examples
- [dbt-labs/tap-mind-body (GitHub)](https://github.com/dbt-labs/tap-mind-body) — complete list of extractable resources including ClassVisits
- [Cyclr MindBody Setup Guide](https://docs.cyclr.com/connector-guides/mindbody) — sandbox credentials confirmed

### Tertiary (LOW confidence — needs validation)
- Per-second rate limit (~5 req/s) — single third-party source, not officially documented
- Exact V6 REST field casing for classvisits response — inferred from SOAP v5 + TypeScript libraries
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: MindBody Public API v6 (REST/JSON)
- Ecosystem: No viable npm packages; direct axios is standard
- Patterns: Token caching, two-tier polling, class-aware boosting
- Pitfalls: Timezone-naive timestamps, rate limits, field inconsistencies, auth header format

**Confidence breakdown:**
- Standard stack: HIGH — no dependencies needed beyond axios (already in project)
- Architecture: HIGH — API is simple REST; patterns are straightforward polling
- Pitfalls: HIGH — timezone issues and rate limits well-documented across multiple sources
- Code examples: MEDIUM-HIGH — patterns verified against docs/community, but exact V6 field names need sandbox validation

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (30 days — MindBody API v6 is stable, infrequent breaking changes)
</metadata>

---

*Phase: 04-mindbody-integration*
*Research completed: 2026-02-21*
*Ready for planning: yes*
