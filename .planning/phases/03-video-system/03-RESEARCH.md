# Phase 3: Video System - Research

**Researched:** 2026-02-21
**Domain:** YouTube iframe embedding + Instagram Reels integration for kiosk display
**Confidence:** HIGH

<research_summary>
## Summary

Researched the two content systems needed for the video zone: YouTube iframe embedding with audio for educational content, and Instagram Reels as silent visual fallback. YouTube is straightforward via the IFrame Player API with manual queue management. Instagram Reels is the harder problem — embeds don't support autoplay, the Basic Display API is dead (December 2024), and scraping is fragile. The only viable approach for Reels is the Instagram Graph API to download .mp4 files locally, then play them via HTML `<video>` tags.

Key finding: Autoplay with audio on Chromium kiosk requires both the `--autoplay-policy=no-user-gesture-required` launch flag AND a managed policy JSON file as belt-and-suspenders. Chrome 120+ may not honor the flag alone, but the managed policy approach remains reliable.

**Primary recommendation:** YouTube via IFrame Player API with manual queue management (not YouTube playlists). Instagram Reels via Graph API + local .mp4 download + HTML `<video muted autoplay>`. The Chromium kiosk launch command in Phase 5 must include autoplay policy flags.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| YouTube IFrame Player API | N/A (CDN) | YouTube video embedding and control | Official Google API, no alternative |
| Instagram Graph API | v21.0 | Fetch reel video URLs from gym's account | Only viable official API for Instagram media |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node-fetch / built-in fetch | N/A | Download .mp4 files from Instagram CDN | Reel video download cron job |
| fs (Node.js built-in) | N/A | Local video file management | Store/rotate downloaded reel .mp4 files |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| YouTube IFrame API | Direct `<video>` with youtube-dl URLs | Violates YouTube ToS, URLs expire, no API events |
| Instagram Graph API | Instagram oEmbed/embeds | Embeds do NOT autoplay — dealbreaker for kiosk |
| Instagram Graph API | Web scraping | Extremely fragile, Instagram changes frequently, account ban risk |
| Instagram Graph API | EmbedSocial/digital signage service | Monthly cost ($29+/mo), vendor dependency |
| Local .mp4 playback | Instagram embed iframe | No autoplay, login walls, Instagram UI chrome visible |

### No Additional Dependencies Needed
The YouTube IFrame API loads via CDN script tag — no npm package. Instagram Graph API is called via HTTP (existing Express server can make fetch calls). No new npm dependencies required for this phase.
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Architecture

```
Backend (server.js)
├── services/
│   ├── video-manager.js       # YouTube playlist state, URL parsing, hot-reload
│   └── reels-fetcher.js       # Instagram Graph API client, .mp4 download, token refresh
├── routes/
│   └── /api/videos             # Current video list + reels list endpoints

Frontend (public/)
├── app.js                      # Existing zone rotation — video zone integration
└── (YouTube IFrame API)        # Loaded via CDN script tag, no local file
```

### Pattern 1: YouTube Manual Queue Management
**What:** Manage video queue in JavaScript, use `loadVideoById()` for advancement instead of YouTube's built-in playlist feature.
**When to use:** Always — gives full control over queue, error handling, and integration with zone rotation.
**Example:**
```javascript
// Source: YouTube IFrame Player API reference
var videoQueue = ['VIDEO_ID_1', 'VIDEO_ID_2', 'VIDEO_ID_3'];
var currentIndex = 0;
var player;

function onYouTubeIframeAPIReady() {
  player = new YT.Player('yt-player', {
    width: '100%',
    height: '100%',
    videoId: videoQueue[currentIndex],
    playerVars: {
      autoplay: 1,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      fs: 0,
      iv_load_policy: 3,
      disablekb: 1,
      playsinline: 1,
      enablejsapi: 1
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
      onAutoplayBlocked: onAutoplayBlocked
    }
  });
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.ENDED) {
    currentIndex++;
    if (currentIndex < videoQueue.length) {
      player.loadVideoById(videoQueue[currentIndex]);
    } else {
      // All YouTube videos played — signal transition to Reels
      signalYouTubeComplete();
    }
  }
}
```

### Pattern 2: Instagram Reels via Local Video Playback
**What:** Download reel .mp4 files to local storage, play them via HTML `<video>` element with muted autoplay.
**When to use:** Always for Instagram content — embeds don't autoplay, this is the only reliable approach.
**Example:**
```javascript
// Backend: Download reels periodically
// Source: Instagram Graph API documentation
async function fetchReels(accessToken, igUserId) {
  const url = `https://graph.instagram.com/v21.0/${igUserId}/media?fields=id,media_type,media_url,timestamp&access_token=${accessToken}`;
  const response = await fetch(url);
  const data = await response.json();
  // Filter for reels only, download .mp4 files
  const reels = data.data.filter(m => m.media_type === 'VIDEO');
  for (const reel of reels) {
    await downloadToLocal(reel.media_url, `reels/${reel.id}.mp4`);
  }
}

// Frontend: Cycle through local video files
// <video id="reels-player" muted autoplay style="width:100%;height:100%;object-fit:cover">
function playNextReel() {
  currentReelIndex = (currentReelIndex + 1) % reelsList.length;
  var video = document.getElementById('reels-player');
  video.src = '/api/reels/' + reelsList[currentReelIndex].id + '.mp4';
  video.play();
}
```

### Pattern 3: Two-Phase Video Zone (YouTube then Reels)
**What:** Video zone plays YouTube playlist first (with audio), then transitions to Reels loop (muted) when YouTube is exhausted.
**When to use:** Every rotation cycle — YouTube restarts from beginning each time zone activates.
**Example:**
```javascript
// Zone activation handler
function activateVideoZone() {
  currentYouTubeIndex = 0;
  youtubeComplete = false;
  if (youtubeVideos.length > 0) {
    showYouTubePlayer();
    player.loadVideoById(youtubeVideos[0].videoId);
  } else {
    // No YouTube videos configured — go straight to Reels
    showReelsPlayer();
    playNextReel();
  }
}

function signalYouTubeComplete() {
  youtubeComplete = true;
  hideYouTubePlayer();
  showReelsPlayer();
  playNextReel();
}
```

### Anti-Patterns to Avoid
- **Using YouTube's built-in playlist feature:** Less control over advancement, error handling, and integration with zone rotation.
- **Storing Instagram media_url CDN links:** They expire after 1-3 hours. Always download to local storage.
- **Instagram oEmbed/embed iframes for Reels:** They do NOT autoplay. Period. No workaround exists.
- **Playing YouTube muted with programmatic unmute:** Some browsers detect and block this. Use Chromium policy instead.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YouTube URL parsing | Custom regex for all URL formats | Simple regex for video ID extraction | YouTube URLs have limited formats: `watch?v=`, `youtu.be/`, `/embed/` — a simple regex covers them all |
| YouTube playback control | Custom video element with YouTube URLs | YouTube IFrame Player API | Direct video URLs require youtube-dl (ToS violation), expire, and have no events |
| Video completion detection | Polling video currentTime | YT.PlayerState.ENDED event | API events are reliable; polling is wasteful and racy |
| Instagram auth token refresh | Manual token management | Automated 60-day refresh cycle | Long-lived tokens expire after 60 days; automate the refresh or the display breaks silently |
| Autoplay policy handling | User-click workarounds | Chromium managed policy JSON file | Policy file is the official, reliable mechanism for kiosk autoplay |

**Key insight:** The YouTube IFrame Player API handles all the hard parts (DRM, adaptive streaming, codec selection, buffering). For Instagram, the hard part is getting video URLs — once you have .mp4 files locally, HTML `<video>` handles everything.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Autoplay With Audio Blocked
**What goes wrong:** YouTube videos play muted or don't play at all on the kiosk.
**Why it happens:** Chrome 120+ may not honor `--autoplay-policy=no-user-gesture-required` flag alone. Default browser policy blocks unmuted autoplay without user gesture.
**How to avoid:** Use BOTH the Chromium launch flag AND a managed policy JSON file:
```json
// /etc/chromium/policies/managed/kiosk.json
{
  "AutoplayAllowed": true,
  "AutoplayAllowlist": ["https://www.youtube.com", "http://localhost:3000"]
}
```
Also implement `onAutoplayBlocked` event handler for runtime detection.
**Warning signs:** Videos start but have no audio, or `onAutoplayBlocked` event fires in console.

### Pitfall 2: Instagram media_url Expiration
**What goes wrong:** Reels stop playing after a few hours — broken video sources.
**Why it happens:** Instagram Graph API `media_url` CDN links expire after ~1-3 hours. If you store the URL and try to use it later, it returns 403.
**How to avoid:** Download .mp4 files to local storage immediately after fetching. Re-fetch the API periodically (every 30-60 min) to discover new reels and refresh URLs for any that failed to download.
**Warning signs:** Reels work initially but show errors after a few hours.

### Pitfall 3: Instagram Token Expiration
**What goes wrong:** Reels stop updating after 60 days — the display silently falls back to stale local files.
**Why it happens:** Instagram long-lived access tokens expire after 60 days. If not refreshed, API calls fail.
**How to avoid:** Implement automatic token refresh. The refresh endpoint is:
```
GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token={token}
```
Call this every 30-50 days (well before expiry). Store the new token. Log warnings if refresh fails.
**Warning signs:** API calls return 401/403, no new reels appearing, token age > 45 days without refresh.

### Pitfall 4: YouTube Video Embedding Disabled
**What goes wrong:** Specific YouTube videos show error instead of playing.
**Why it happens:** Video owner has disabled iframe embedding. YouTube error codes 101 and 150 indicate this.
**How to avoid:** Handle `onError` event — skip unplayable videos and advance to next in queue. Log the error so the gym owner knows which videos need replacing.
**Warning signs:** Error code 101 or 150 in onPlayerError callback.

### Pitfall 5: Zone Rotation Timing vs Video Duration
**What goes wrong:** Video gets cut off mid-playback when zone rotation timer fires, or the video zone holds for too long.
**Why it happens:** Fixed rotation timer doesn't account for video duration. The existing `fallback_seconds: 180` is a static timeout.
**How to avoid:** When video zone is active with `play_full: true`, let the YouTube ENDED event or Reels completion drive the transition — don't use a fixed timer. Signal the zone controller that video zone is "done" when all YouTube videos have played AND either a minimum Reels display time has elapsed or the zone controller requests a transition.
**Warning signs:** Videos cut off at exactly 180 seconds regardless of actual length.

### Pitfall 6: Chromium Policy File Path Confusion on Raspberry Pi
**What goes wrong:** Autoplay policy doesn't take effect despite correct JSON content.
**Why it happens:** Different Chromium packages on Pi use different policy paths: `/etc/chromium/policies/managed/` vs `/etc/chromium-browser/policies/managed/`. Wrong path = policy ignored.
**How to avoid:** Check which path your Chromium version uses via `chrome://policy` in the browser. Create policy in both paths to be safe. Phase 5 deployment script should handle this.
**Warning signs:** `chrome://policy` shows empty policy list despite file existing.
</common_pitfalls>

<code_examples>
## Code Examples

### YouTube URL to Video ID Parsing
```javascript
// Source: YouTube IFrame API documentation + standard patterns
function extractYouTubeId(url) {
  var match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Examples:
// "https://youtube.com/watch?v=dQw4w9WgXcQ" → "dQw4w9WgXcQ"
// "https://youtu.be/dQw4w9WgXcQ"             → "dQw4w9WgXcQ"
// "https://youtube.com/embed/dQw4w9WgXcQ"     → "dQw4w9WgXcQ"
```

### YouTube IFrame Player Setup (Kiosk Optimized)
```javascript
// Source: YouTube IFrame Player API reference
// https://developers.google.com/youtube/iframe_api_reference
function onYouTubeIframeAPIReady() {
  player = new YT.Player('yt-player', {
    width: '100%',
    height: '100%',
    videoId: videoQueue[0].videoId,
    playerVars: {
      autoplay: 1,       // Start immediately
      controls: 0,       // Hide controls (kiosk)
      modestbranding: 1,  // Reduce YouTube branding
      rel: 0,            // Don't show related videos
      fs: 0,             // Hide fullscreen button
      iv_load_policy: 3, // Hide annotations
      disablekb: 1,      // Disable keyboard controls
      playsinline: 1,    // Inline playback
      enablejsapi: 1     // Required for JS control
    },
    events: {
      onReady: function(event) {
        event.target.setVolume(80);
        event.target.playVideo();
      },
      onStateChange: function(event) {
        if (event.data === YT.PlayerState.ENDED) {
          playNextYouTube();
        }
      },
      onError: function(event) {
        console.error('YouTube error:', event.data);
        playNextYouTube(); // Skip broken video
      },
      onAutoplayBlocked: function() {
        console.error('Autoplay blocked — check Chromium policies');
      }
    }
  });
}
```

### Instagram Graph API Token Refresh
```javascript
// Source: Instagram Graph API documentation
// https://developers.facebook.com/docs/instagram-basic-display-api/reference/refresh_access_token
async function refreshInstagramToken(currentToken) {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`;
  const response = await fetch(url);
  const data = await response.json();
  // data.access_token = new long-lived token (60 days)
  // data.expires_in = seconds until expiry
  return data.access_token;
}
```

### Local Video Cycling (for Reels)
```javascript
// Source: Standard HTML5 video API
function setupReelsPlayer(reelFiles) {
  var video = document.getElementById('reels-player');
  var index = 0;

  video.muted = true;
  video.style.objectFit = 'cover';

  function playNext() {
    if (reelFiles.length === 0) return;
    index = (index + 1) % reelFiles.length;
    video.src = '/api/reels/files/' + reelFiles[index];
    video.play();
  }

  video.addEventListener('ended', playNext);
  // Start first reel
  video.src = '/api/reels/files/' + reelFiles[0];
  video.play();
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Instagram Basic Display API | Instagram Graph API (with Instagram Login) | December 2024 | Basic Display API fully shut down. Must use Graph API with Business/Creator account |
| `--autoplay-policy` flag alone | Flag + managed policy JSON | Chrome 120+ (late 2023) | Flag may be ignored; policy file is the reliable mechanism |
| YouTube `listType: 'search'` | Manual video ID management | November 2020 | Search-based playlists deprecated; manage queue explicitly |
| Wayfire compositor on Pi | Labwc compositor | Late 2024 | Labwc drops 1/3 as many frames; default on Pi OS Trixie |

**New tools/patterns to consider:**
- **`onAutoplayBlocked` event:** New addition to YouTube IFrame API (2025). Fires when browser blocks autoplay. Essential for kiosk runtime diagnostics.
- **Raspberry Pi OS Trixie (Debian 13):** Released October 2025. Default Labwc compositor, improved Chromium video performance. Target this for deployment.

**Deprecated/outdated:**
- **Instagram Basic Display API:** Fully dead since December 2024. Do not attempt.
- **YouTube `listType: 'search'`:** Deprecated since November 2020.
- **Vimeo in original roadmap:** CONTEXT.md replaces Vimeo with Instagram Reels. Drop Vimeo URL parsing from scope.
</sota_updates>

<open_questions>
## Open Questions

1. **Instagram Business Account Setup**
   - What we know: Graph API requires Business or Creator account linked to a Facebook Page. The gym may or may not already have this configured.
   - What's unclear: Whether the gym currently has a Business account, or if conversion is needed.
   - Recommendation: Document setup requirements. If no Business account exists, include setup instructions in Phase 5 deployment guide. The video system should gracefully handle "no Instagram configured" — just skip Reels and loop YouTube.

2. **Meta App Review for Instagram Permissions**
   - What we know: `instagram_basic` permission requires Meta App Review for production use. Development mode allows testing with the app owner's own account.
   - What's unclear: Whether Meta App Review is needed if only reading the gym's own account (the account that owns the app).
   - Recommendation: Start in Development Mode (no review needed for own account). Only pursue App Review if the gym wants to read other accounts' content. For a single gym's own reels, Development Mode should suffice.

3. **Reel Download Storage and Rotation**
   - What we know: Downloaded .mp4 files need local storage. Pi SD card has limited space.
   - What's unclear: How many reels to keep, how large they are, when to prune old ones.
   - Recommendation: Keep last 20 reels (~500MB estimate). Prune on download cycle. Make the count configurable in YAML.

4. **Zone Rotation Integration**
   - What we know: Current zone controller uses `fallback_seconds` for video zone duration. Phase 3 needs `play_full: true` behavior where YouTube completion drives the transition.
   - What's unclear: Exact protocol for video zone to signal "I'm done" to zone controller.
   - Recommendation: Video zone emits a custom event or calls a zone controller method when all YouTube videos have played. For Reels phase, use a configurable minimum display time before allowing rotation to proceed.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference) — embedding, events, playerVars, state constants
- [YouTube Player Parameters](https://developers.google.com/youtube/player_parameters) — autoplay, controls, rel, modestbranding
- [Chrome Autoplay Policy](https://developer.chrome.com/blog/autoplay) — browser autoplay restrictions
- [Chrome Enterprise Policy: AutoplayAllowed](https://chromeenterprise.google/policies/) — managed policy for kiosk autoplay
- [Instagram Graph API](https://developers.facebook.com/docs/instagram-api/) — media endpoints, token management
- [Instagram Basic Display API Deprecation](https://www.instagram.com/p/DBMRmcjuB4r/) — confirmed shutdown December 2024

### Secondary (MEDIUM confidence)
- [Raspberry Pi OS Trixie video performance](https://www.tomshardware.com/raspberry-pi/tested-os-update-solves-raspberry-pis-age-old-youtube-frame-rate-problem) — Labwc compositor improvements, verified against Pi Foundation announcements
- [Chromium kiosk on Raspberry Pi guide](https://gist.github.com/lellky/673d84260dfa26fa9b57287e0f67d09e) — launch flags, verified against Chromium docs
- [Chrome autoplay flag deprecation](https://support.google.com/chrome/thread/207847413/) — Chrome 120+ flag behavior, verified with managed policy workaround

### Tertiary (LOW confidence - needs validation)
- Instagram media_url expiration timing (~1-3 hours) — reported across multiple community sources, exact timing varies. Validate during implementation by testing URL lifespan.
- Pi 5 Chromium memory usage with YouTube iframes — reported as significant but manageable with 4GB+. Validate during Phase 5 hardware testing.
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: YouTube IFrame Player API, Instagram Graph API
- Ecosystem: Chromium kiosk autoplay policies, HTML5 video element
- Patterns: Manual video queue, local .mp4 download and playback, two-phase content (YouTube then Reels)
- Pitfalls: Autoplay blocking, token expiration, CDN URL expiration, embedding restrictions

**Confidence breakdown:**
- Standard stack: HIGH — YouTube API is stable and well-documented; Instagram Graph API is the only viable option
- Architecture: HIGH — patterns verified against official documentation
- Pitfalls: HIGH — autoplay policy issues well-documented across multiple sources; Instagram token expiry documented in API docs
- Code examples: HIGH — from official YouTube/Instagram API references

**Research date:** 2026-02-21
**Valid until:** 2026-03-23 (30 days — YouTube API is stable, Instagram API may change with Meta platform updates)
</metadata>

---

*Phase: 03-video-system*
*Research completed: 2026-02-21*
*Ready for planning: yes*
