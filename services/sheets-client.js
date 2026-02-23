const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const configLoader = require('./config-loader');

class SheetsClient {
  constructor() {
    this._loadCredentials();

    this.cachedData = {};
    this.lastPoll = null;
    this.polling = false;
    this._interval = null;
    this._doc = null;
    this._parsedCreds = null;

    // Update credentials on config change
    configLoader.onConfigChange(() => {
      this._loadCredentials();
    });
  }

  _loadCredentials() {
    const config = configLoader.getConfig();
    const sheets = (config && config.sheets) || {};
    this.spreadsheetId = sheets.spreadsheet_id || '';
    this.serviceAccountEmail = sheets.service_account_email || '';
    this.credentialsFile = sheets.credentials_file || '';
    this.pollIntervalMinutes = sheets.poll_interval_minutes || 5;
    // Reset cached creds when config changes so they get re-read
    this._parsedCreds = null;
  }

  _isConfigured() {
    return !!(
      this.spreadsheetId &&
      this.spreadsheetId !== 'your_spreadsheet_id' &&
      this.credentialsFile &&
      this.credentialsFile !== '/home/BigBarn/secrets/google-credentials.json'
    );
  }

  _createAuth() {
    if (!this._parsedCreds) {
      const raw = fs.readFileSync(this.credentialsFile, 'utf8');
      this._parsedCreds = JSON.parse(raw);
    }

    return new JWT({
      email: this._parsedCreds.client_email,
      key: this._parsedCreds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
  }

  async poll() {
    if (!this._isConfigured()) return;

    try {
      const auth = this._createAuth();
      const doc = new GoogleSpreadsheet(this.spreadsheetId, auth);
      await doc.loadInfo();

      const newData = {};
      for (const sheet of doc.sheetsByIndex) {
        const rows = await sheet.getRows();
        newData[sheet.title] = rows.map(row => row.toObject());
      }

      this.cachedData = newData;
      this.lastPoll = Date.now();
      console.log(`[Sheets] Poll complete: ${Object.keys(newData).length} tab(s) — ${Object.keys(newData).join(', ')}`);
    } catch (err) {
      console.warn(`[Sheets] Poll failed (keeping stale cache): ${err.message}`);
    }
  }

  startPolling() {
    if (!this._isConfigured()) {
      console.log('[Sheets] Not configured, skipping');
      return;
    }

    // Delay initial poll by 5 seconds to avoid cold-start quota spike
    setTimeout(() => {
      this.poll().catch(err => console.warn(`[Sheets] Poll error: ${err.message}`));
    }, 5000);

    this._interval = setInterval(() => {
      this.poll().catch(err => console.warn(`[Sheets] Poll error: ${err.message}`));
    }, this.pollIntervalMinutes * 60 * 1000);

    this.polling = true;
    console.log(`[Sheets] Polling started (every ${this.pollIntervalMinutes}min)`);
  }

  stopPolling() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this.polling = false;
  }

  getTabData(tabName) {
    return this.cachedData[tabName] || [];
  }

  getTabNames() {
    return Object.keys(this.cachedData);
  }

  getStatus() {
    return {
      configured: this._isConfigured(),
      polling: this.polling,
      lastPoll: this.lastPoll,
      tabs: this.getTabNames()
    };
  }
}

// Singleton instance
module.exports = new SheetsClient();
