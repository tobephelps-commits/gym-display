const sheetsClient = require('./sheets-client');
const configLoader = require('./config-loader');

// Hardcoded team colors matching CONTEXT.md
const TEAM_COLORS = {
  green: '#38a169',
  blue: '#3182ce',
  red: '#e53e3e'
};

class LeaderboardService {
  constructor() {
    this._leaderboard = {
      active: false,
      teams: [],
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
   * Normalize team name: trim whitespace, capitalize first letter, lowercase rest.
   * @param {string} name - Raw team name from Sheets
   * @returns {string} Normalized team name
   */
  _normalizeTeamName(name) {
    if (!name || typeof name !== 'string') return '';
    const trimmed = name.trim();
    if (trimmed.length === 0) return '';
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }

  /**
   * Read Sheets "Leaderboard" tab data, group by team, compute totals and rankings.
   */
  _refreshFromSheets() {
    const rows = sheetsClient.getTabData('Leaderboard');

    // If no data (Sheets not configured or tab empty/missing), mark inactive
    if (!rows || rows.length === 0) {
      this._leaderboard = {
        active: false,
        teams: [],
        lastUpdated: null
      };
      return;
    }

    // Group rows by team
    const teamMap = {};

    for (const row of rows) {
      const name = row.Name ? String(row.Name).trim() : '';
      const team = row.Team ? this._normalizeTeamName(row.Team) : '';

      // Skip rows with missing Name or Team
      if (!name || !team) {
        console.warn(`[Leaderboard] Skipping row with missing Name or Team: ${JSON.stringify(row)}`);
        continue;
      }

      const points = parseInt(row.Points, 10);
      const parsedPoints = isNaN(points) ? 0 : points;

      if (!teamMap[team]) {
        teamMap[team] = {
          name: team,
          color: TEAM_COLORS[team.toLowerCase()] || '#888888',
          total: 0,
          members: []
        };
      }

      teamMap[team].members.push({ name, points: parsedPoints });
      teamMap[team].total += parsedPoints;
    }

    // Convert to array and sort
    const teams = Object.values(teamMap);

    // Sort teams by total descending
    teams.sort((a, b) => b.total - a.total);

    // Sort members within each team by points descending, assign rank
    teams.forEach((team, index) => {
      team.rank = index + 1;
      team.members.sort((a, b) => b.points - a.points);
    });

    this._leaderboard = {
      active: true,
      teams,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Returns the current leaderboard data structure.
   * @returns {{ active: boolean, teams: Array, lastUpdated: string|null }}
   */
  getLeaderboard() {
    return this._leaderboard;
  }

  /**
   * Convenience method returning whether the leaderboard has active data.
   * @returns {boolean}
   */
  isActive() {
    return this._leaderboard.active;
  }
}

// Singleton instance
module.exports = new LeaderboardService();
