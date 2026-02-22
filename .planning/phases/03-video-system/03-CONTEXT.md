# Phase 3: Video System - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<vision>
## How This Should Work

The video zone serves two types of content in a clear priority order. When the rotation lands on the video zone, it starts by playing YouTube videos — these are educational and instructional content (technique demos, movement breakdowns, etc.) and they play **with audio** so people can actually learn from them.

Once all YouTube videos have played through, the zone transitions to the gym's Instagram Reels feed, which plays silently as visual background content. If there are no YouTube videos configured at all, the Reels play on loop as the sole content.

Each time the rotation comes back to the video zone, YouTube starts from the beginning again. The zone should never be blank — there's always something playing, whether it's curated YouTube content or the gym's own Instagram presence.

</vision>

<essential>
## What Must Be Nailed

- **YouTube with reliable audio** — Educational videos must play with sound, no buffering issues, looking great on the TV
- **Seamless YouTube-to-Reels transition** — When YouTube playlist finishes, automatically hand off to Instagram Reels without awkward gaps
- **Always-on content** — The zone must never show a blank screen; Reels serve as the ever-present fallback

</essential>

<specifics>
## Specific Ideas

- YouTube videos are educational/instructional — they restart from the beginning each time the rotation hits the video zone
- Instagram Reels come from the gym's own account feed, not curated URLs
- YouTube plays with volume; Reels play muted (visual filler, not audio content)
- When no YouTube videos are listed in config, Reels loop continuously
- Config hot-reload so videos can be updated without restarting

</specifics>

<notes>
## Additional Context

This phase represents a shift from the original roadmap concept — Instagram Reels as fallback content is new scope beyond just YouTube/Vimeo. The Reels integration will need research into how to pull and display Instagram content on a kiosk display.

Priority order: YouTube (educational, with audio) > Instagram Reels (visual filler, muted)

</notes>

---

*Phase: 03-video-system*
*Context gathered: 2026-02-21*
