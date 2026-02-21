# Phase 2: WOD Display - Context

**Gathered:** 2026-02-21
**Status:** Ready for research

<vision>
## How This Should Work

When the WOD zone rotates into view, members see the actual live WodScreen page — the same daily workout view they'd see if they opened WodScreen themselves. It's not a screenshot or a reformatted version; it's the real page, running live.

The system handles the navigation automatically: it goes to wodscreen.com/launch/index.html, logs in with credentials, clicks the daily WOD launch button, and then keeps that live view running in a webview. If the gym updates the WOD during the day, the TV reflects it automatically because it's the live page.

The WOD fills the entire zone — no borders, no headers, no chrome. Just the workout, full-screen and readable from across the gym.

</vision>

<essential>
## What Must Be Nailed

- **Always shows today's WOD** — The system must reliably navigate to the correct daily workout every single day. No showing yesterday's WOD.
- **Never shows a broken screen** — If login expires, the site goes down, or navigation fails, handle it gracefully. A blank white screen on the TV is unacceptable.
- Both freshness and reliability are equally non-negotiable.

</essential>

<specifics>
## Specific Ideas

- WodScreen requires login credentials — the system must authenticate automatically
- The launch page is wodscreen.com/launch/index.html with a daily WOD button that must be clicked (no direct URL to the daily view)
- Live webview, not screenshots — keeps the page current if updated during the day
- WOD must fill the entire zone with no surrounding UI or indicators

</specifics>

<notes>
## Additional Context

The original roadmap assumed a Puppeteer screenshot approach, but the user's vision is clearer: embed the live WodScreen page directly via automated browser navigation. This shifts the approach from "scrape and serve an image" to "automate browser login/navigation and display the live page." Research phase should investigate the best way to handle this (Puppeteer for navigation + keeping a live session, iframe embedding challenges, session persistence across days).

</notes>

---

*Phase: 02-wod-display*
*Context gathered: 2026-02-21*
