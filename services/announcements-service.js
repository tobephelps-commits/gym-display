const sheetsClient = require('./sheets-client');
const configLoader = require('./config-loader');

class AnnouncementsService {
  constructor() {
    this._data = {
      active: false,
      announcements: [],
      count: 0,
      lastUpdated: null
    };

    this._refreshInterval = null;

    // Initial refresh
    this._refreshFromSheets();

    // Refresh every 60 seconds
    this._refreshInterval = setInterval(() => {
      this._refreshFromSheets();
    }, 60 * 1000);

    // Re-evaluate on config changes
    configLoader.onConfigChange(() => {
      this._refreshFromSheets();
    });
  }

  /**
   * Read Sheets "Announcements" tab data, filter active rows, sort by priority.
   */
  _refreshFromSheets() {
    const rows = sheetsClient.getTabData('Announcements');

    // If no data (Sheets not configured or tab empty/missing), mark inactive
    if (!rows || rows.length === 0) {
      this._data = {
        active: false,
        announcements: [],
        count: 0,
        lastUpdated: null
      };
      return;
    }

    const announcements = [];

    for (const row of rows) {
      const activeVal = row.Active ? String(row.Active).trim().toLowerCase() : '';
      const isActive = ['true', 'yes', '1'].includes(activeVal);

      if (!isActive) {
        continue;
      }

      const title = row.Title ? String(row.Title).trim() : '';
      const body = row.Body ? String(row.Body).trim() : '';

      // Skip rows with missing Title AND Body
      if (!title && !body) {
        console.warn(`[Announcements] Skipping row with missing Title and Body: ${JSON.stringify(row)}`);
        continue;
      }

      const priority = row.Priority ? String(row.Priority).trim().toLowerCase() : 'normal';

      announcements.push({
        title,
        body,
        priority: priority === 'urgent' ? 'urgent' : 'normal'
      });
    }

    // Sort by priority: urgent first, then normal
    announcements.sort((a, b) => {
      if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
      if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
      return 0;
    });

    this._data = {
      active: announcements.length > 0,
      announcements,
      count: announcements.length,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Returns the current announcements data structure.
   * @returns {{ active: boolean, announcements: Array, count: number, lastUpdated: string|null }}
   */
  getAnnouncements() {
    return this._data;
  }

  /**
   * Convenience method returning whether there are active announcements.
   * @returns {boolean}
   */
  isActive() {
    return this._data.active;
  }
}

// Singleton instance
module.exports = new AnnouncementsService();
