/**
 * LiveEventService — polls Google Sheets "LiveEvent" tab for scheduled YouTube Live events.
 * When an enabled event's time window includes now, rotation is overridden with fullscreen YouTube Live.
 *
 * Pattern follows AnnouncementsService: constructor takes dependencies, start()/stop() lifecycle,
 * _refresh() polls on interval, getActiveEvent()/isActive()/getStatus() for consumers.
 */

/**
 * Extract YouTube video ID from various URL formats.
 * Supports: youtube.com/watch?v=, youtu.be/, youtube.com/live/, youtube.com/embed/, youtube.com/v/
 * @param {string} url - YouTube URL
 * @returns {string|null} Video ID or null if not a valid YouTube URL
 */
function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|live\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

class LiveEventService {
  constructor(sheetsClient, configLoader) {
    this.sheetsClient = sheetsClient;
    this.configLoader = configLoader;
    this._activeEvent = null;
    this._events = [];
    this._pollTimer = null;
    this._lastRefresh = null;
  }

  /**
   * Start polling. Refreshes immediately, then every 60 seconds.
   * @returns {LiveEventService} this — for chaining
   */
  start() {
    this._refresh();
    this._pollTimer = setInterval(() => this._refresh(), 60 * 1000);
    return this;
  }

  /**
   * Stop polling.
   */
  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Refresh event data from Sheets "LiveEvent" tab.
   * Finds first enabled event whose time window includes now.
   * Never throws — logs errors and keeps previous state.
   */
  _refresh() {
    try {
      const rows = this.sheetsClient.getTabData('LiveEvent');

      if (!rows || rows.length === 0) {
        this._events = [];
        this._activeEvent = null;
        this._lastRefresh = new Date().toISOString();
        return;
      }

      const now = new Date();
      const events = [];

      for (const row of rows) {
        // Check enabled field (case-insensitive truthy)
        const enabledVal = row.Enabled ? String(row.Enabled).trim().toLowerCase() : '';
        const isEnabled = ['true', 'yes', '1'].includes(enabledVal);
        if (!isEnabled) continue;

        const title = row.Title ? String(row.Title).trim() : '';
        const url = row.URL ? String(row.URL).trim() : '';
        const startStr = row.Start ? String(row.Start).trim() : '';
        const endStr = row.End ? String(row.End).trim() : '';

        if (!url || !startStr || !endStr) continue;

        const start = this._parseDate(startStr);
        const end = this._parseDate(endStr);

        if (!start || !end) {
          console.warn(`[LiveEvent] Skipping row with invalid dates: start="${startStr}", end="${endStr}"`);
          continue;
        }

        const videoId = extractYouTubeId(url);

        events.push({
          title,
          url,
          videoId,
          start,
          end,
          enabled: true
        });
      }

      this._events = events;

      // Find first event where now >= start && now < end
      const active = events.find(e => now >= e.start && now < e.end);
      this._activeEvent = active || null;
      this._lastRefresh = new Date().toISOString();
    } catch (err) {
      console.error(`[LiveEvent] Refresh failed: ${err.message}`);
      this._lastRefresh = new Date().toISOString();
    }
  }

  /**
   * Parse a date string. Supports ISO format and "YYYY-MM-DD HH:MM" format.
   * Interprets in system timezone via configLoader.
   * @param {string} str - Date string
   * @returns {Date|null}
   */
  _parseDate(str) {
    if (!str) return null;

    // Try ISO format first (includes timezone info)
    const isoDate = new Date(str);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }

    // Try "YYYY-MM-DD HH:MM" manual parse
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (match) {
      const [, year, month, day, hour, minute] = match;

      // Get timezone from config for constructing a date in local time
      const timezone = this.configLoader.get
        ? this.configLoader.get('system.timezone')
        : (this.configLoader.getConfig() && this.configLoader.getConfig().system && this.configLoader.getConfig().system.timezone);

      if (timezone) {
        // Use Intl to create a date in the specified timezone
        // Build an ISO-ish string and use Date, then adjust for timezone offset
        const localStr = `${year}-${month}-${day}T${hour}:${minute}:00`;
        try {
          // Create a date formatter for the target timezone
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
          });

          // We need to find what UTC time corresponds to the given local time.
          // Start with a rough guess (treating the string as UTC)
          let guess = new Date(localStr + 'Z');

          // Format the guess in the target timezone and compare
          for (let i = 0; i < 2; i++) {
            const parts = formatter.formatToParts(guess);
            const p = {};
            for (const part of parts) {
              p[part.type] = part.value;
            }
            const guessLocal = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
            const diffMs = guessLocal.getTime() - guess.getTime();
            // diffMs is the offset: UTC + offset = local, so UTC = local - offset
            // Adjust guess: we want guess such that formatInTZ(guess) = target
            // guessLocal = guess + offset => target = guess + offset => guess = target - offset
            guess = new Date(new Date(localStr + 'Z').getTime() - diffMs);
          }

          return guess;
        } catch (e) {
          // Fallback: treat as local system time
          return new Date(localStr);
        }
      }

      // No timezone configured — treat as local
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
    }

    return null;
  }

  /**
   * Returns the currently active event, or null.
   * Shape: { title, url, videoId, start, end }
   */
  getActiveEvent() {
    if (!this._activeEvent) return null;
    return {
      title: this._activeEvent.title,
      url: this._activeEvent.url,
      videoId: this._activeEvent.videoId,
      start: this._activeEvent.start,
      end: this._activeEvent.end
    };
  }

  /**
   * Returns whether a live event is currently active.
   * @returns {boolean}
   */
  isActive() {
    return !!this._activeEvent;
  }

  /**
   * Returns status object for API consumers.
   */
  getStatus() {
    return {
      configured: !!this.sheetsClient,
      active: this.isActive(),
      event: this.getActiveEvent(),
      eventCount: this._events.length,
      lastRefresh: this._lastRefresh
    };
  }
}

module.exports = {
  create(sheetsClient, configLoader) {
    return new LiveEventService(sheetsClient, configLoader);
  }
};
