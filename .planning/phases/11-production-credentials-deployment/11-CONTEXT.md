# Phase 11: Production Credentials & Deployment - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<vision>
## How This Should Work

A guided walkthrough — tackle each credential swap one at a time, verify it works on the actual gym TV, then move to the next. MindBody production credentials first (highest value — real class rosters), then yt-dlp install for Instagram reels.

Google Sheets is already configured, deployed, and verified on the Pi. No work needed there.

Each step: swap the credential/install the tool → restart the service → visually confirm on the TV that real data appears correctly.

</vision>

<essential>
## What Must Be Nailed

- **MindBody production credentials** — Replace sandbox API key with production key, verify real class roster data shows on the TV
- **Visual verification on the TV** — Each change confirmed by seeing real data on the actual gym display, not just logs
- **yt-dlp installed and working** — Sheets-based Instagram reel downloading works end-to-end

</essential>

<specifics>
## Specific Ideas

- MindBody is the top priority — real roster data is the most visible zone for gym members
- Step-by-step approach: one credential at a time, verify before moving on
- Google Sheets setup is already complete and verified — skip that entirely

</specifics>

<notes>
## Additional Context

Scope is narrower than originally planned in MILESTONE-CONTEXT.md:
- Google Sheets service account: DONE (already configured and verified)
- MindBody production swap: TODO
- yt-dlp installation: TODO

Two items remaining instead of three. All work happens on the Pi via Tailscale SSH.

</notes>

---

*Phase: 11-production-credentials-deployment*
*Context gathered: 2026-02-23*
