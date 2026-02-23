const axios = require('axios');
const configLoader = require('./config-loader');

const BASE_URL = 'https://api.mindbodyonline.com/public/v6';
const TOKEN_MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000; // 6 days

class MindBodyClient {
  constructor() {
    this._loadCredentials();

    this.token = null;
    this.tokenIssuedAt = null;
    this.cachedSchedule = [];
    this.cachedRoster = {
      classInfo: null,
      athletes: [],
      count: 0,
      lastUpdated: null
    };
    this.lastSchedulePoll = null;
    this.lastRosterPoll = null;
    this.polling = false;
    this._scheduleInterval = null;
    this._rosterInterval = null;

    // Update credentials on config change
    configLoader.onConfigChange(() => {
      this._loadCredentials();
    });
  }

  _loadCredentials() {
    const config = configLoader.getConfig();
    const mb = (config && config.mindbody) || {};
    this.apiKey = mb.api_key || '';
    this.siteId = mb.site_id || '';
    this.username = mb.username || '';
    this.password = mb.password || '';
    this.pollIntervalMinutes = mb.poll_interval_minutes || 5;
    this.timezone = (config && config.system && config.system.timezone) || 'America/Denver';
  }

  _isConfigured() {
    return !!(this.apiKey && this.apiKey !== 'your_api_key' && this.siteId && this.siteId !== 'your_site_id');
  }

  async getToken() {
    // Return cached token if still valid (less than 6 days old)
    if (this.token && this.tokenIssuedAt && (Date.now() - this.tokenIssuedAt) < TOKEN_MAX_AGE_MS) {
      return this.token;
    }

    try {
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
      console.log('[MindBody] Token acquired');
      return this.token;
    } catch (err) {
      console.warn(`[MindBody] Token request failed: ${err.message}`);
      if (err.response) {
        console.warn(`[MindBody] Status: ${err.response.status}, Body: ${JSON.stringify(err.response.data)}`);
      }
      return null;
    }
  }

  async apiGet(urlPath, params) {
    const token = await this.getToken();
    if (!token) return null;

    try {
      const response = await axios.get(`${BASE_URL}${urlPath}`, {
        params,
        headers: {
          'Api-Key': this.apiKey,
          'SiteId': this.siteId,
          'Authorization': token
        }
      });
      return response.data;
    } catch (err) {
      if (err.response && err.response.status === 401) {
        console.warn('[MindBody] 401 — clearing token for refresh');
        this.token = null;
        this.tokenIssuedAt = null;
      } else {
        console.warn(`[MindBody] API GET ${urlPath} failed: ${err.message}`);
      }
      return null;
    }
  }

  async pollSchedule() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: this.timezone });
    const data = await this.apiGet('/class/classes', {
      StartDate: today,
      EndDate: today
    });

    if (data && data.Classes) {
      this.cachedSchedule = data.Classes.filter(c => c.IsCancelled !== true);
      this.lastSchedulePoll = Date.now();
      console.log(`[MindBody] Schedule polled: ${this.cachedSchedule.length} classes today`);
    }
  }

  getActiveClass() {
    const now = new Date();
    // Get current time in the configured timezone
    const nowStr = now.toLocaleString('en-US', { timeZone: this.timezone });
    const nowLocal = new Date(nowStr);

    for (const cls of this.cachedSchedule) {
      // Parse MindBody timestamps as local time
      const start = new Date(cls.StartDateTime);
      const end = new Date(cls.EndDateTime);
      if (nowLocal >= start && nowLocal <= end) {
        return cls;
      }
    }
    return null;
  }

  async pollActiveRoster() {
    const activeClass = this.getActiveClass();

    if (!activeClass) {
      this.cachedRoster = {
        classInfo: null,
        athletes: [],
        count: 0,
        lastUpdated: Date.now()
      };
      this.lastRosterPoll = Date.now();
      return;
    }

    const data = await this.apiGet('/class/classvisits', {
      ClassId: activeClass.Id
    });

    if (!data) {
      this.lastRosterPoll = Date.now();
      return;
    }

    const visits = (data.Class && data.Class.Visits) || [];
    const signedIn = visits.filter(v => v.SignedIn === true);

    // Format display names: first name + last initial
    const seen = new Set();
    const athletes = [];

    for (const v of signedIn) {
      const clientId = v.ClientId || (v.Client && v.Client.Id);
      if (clientId && seen.has(clientId)) continue; // deduplicate
      if (clientId) seen.add(clientId);

      let displayName;
      const firstName = v.Client && v.Client.FirstName;
      const lastName = v.Client && v.Client.LastName;

      if (firstName && lastName) {
        displayName = `${firstName} ${lastName.charAt(0)}.`;
      } else if (firstName) {
        displayName = firstName;
      } else {
        displayName = (v.Client && v.Client.DisplayName) || v.DisplayName || 'Unknown';
      }

      athletes.push(displayName);
    }

    this.cachedRoster = {
      classInfo: {
        name: (activeClass.ClassDescription && activeClass.ClassDescription.Name) || 'Class',
        startTime: activeClass.StartDateTime,
        endTime: activeClass.EndDateTime,
        coach: (activeClass.Staff && activeClass.Staff.Name) || 'Coach'
      },
      athletes,
      count: athletes.length,
      lastUpdated: Date.now()
    };
    this.lastRosterPoll = Date.now();
  }

  startPolling() {
    if (!this._isConfigured()) {
      console.warn('[MindBody] Not configured (placeholder credentials) — skipping polling');
      return;
    }

    this.polling = true;

    // Schedule polling — immediate then interval
    this.pollSchedule().catch(err => console.warn(`[MindBody] Schedule poll error: ${err.message}`));
    this._scheduleInterval = setInterval(() => {
      this.pollSchedule().catch(err => console.warn(`[MindBody] Schedule poll error: ${err.message}`));
    }, this.pollIntervalMinutes * 60 * 1000);

    // Roster polling — immediate then every 60s
    this.pollActiveRoster().catch(err => console.warn(`[MindBody] Roster poll error: ${err.message}`));
    this._rosterInterval = setInterval(() => {
      this.pollActiveRoster().catch(err => console.warn(`[MindBody] Roster poll error: ${err.message}`));
    }, 60 * 1000);

    console.log(`[MindBody] Polling started (schedule: every ${this.pollIntervalMinutes}min, roster: every 60s)`);
  }

  stopPolling() {
    if (this._scheduleInterval) {
      clearInterval(this._scheduleInterval);
      this._scheduleInterval = null;
    }
    if (this._rosterInterval) {
      clearInterval(this._rosterInterval);
      this._rosterInterval = null;
    }
    this.polling = false;
  }

  getSchedule() {
    return this.cachedSchedule;
  }

  getRoster() {
    return this.cachedRoster;
  }

  getStatus() {
    return {
      configured: this._isConfigured(),
      polling: this.polling,
      lastSchedulePoll: this.lastSchedulePoll,
      lastRosterPoll: this.lastRosterPoll,
      activeClass: this.getActiveClass() !== null
    };
  }
}

// Singleton instance
const mindbodyClient = new MindBodyClient();

module.exports = mindbodyClient;
