const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const chokidar = require('chokidar');
const EventEmitter = require('events');

const CONFIG_PATH = path.join(__dirname, '..', 'config.yaml');
const BACKUP_PATH = CONFIG_PATH + '.bak';

const VALID_ZONE_NAMES = ['wod', 'video', 'roster', 'leaderboard', 'announcements', 'live-event'];

class ConfigLoader extends EventEmitter {
  constructor() {
    super();
    this._config = null;
    this._watcher = null;
  }

  /**
   * Load config from YAML file. Exits process if file not found on initial load.
   */
  loadConfig() {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = yaml.load(raw);
      this._config = parsed;
      return parsed;
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.error(`Config file not found: ${CONFIG_PATH}`);
        process.exit(1);
      }
      // YAML parse error on initial load — fatal
      if (!this._config) {
        console.error(`Failed to parse config.yaml: ${err.message}`);
        process.exit(1);
      }
      // Parse error on reload — keep previous config
      console.error(`Config reload failed (keeping previous config): ${err.message}`);
      return this._config;
    }
  }

  /**
   * Start watching config.yaml for changes. Re-parses on change and emits 'config-changed'.
   */
  startWatching() {
    this._watcher = chokidar.watch(CONFIG_PATH, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    this._watcher.on('change', () => {
      try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = yaml.load(raw);
        this._config = parsed;
        this.emit('config-changed', parsed);
      } catch (err) {
        console.error(`Config reload failed (keeping previous config): ${err.message}`);
      }
    });
  }

  /**
   * Returns the current parsed config object.
   */
  getConfig() {
    return this._config;
  }

  /**
   * Register a callback for config change events.
   */
  onConfigChange(callback) {
    this.on('config-changed', callback);
  }

  /**
   * Validate config values before saving.
   * @param {object} merged - The full merged config to validate
   * @throws {Error} if validation fails
   */
  _validateConfig(merged) {
    const errors = [];

    // Validate rotation_order
    if (merged.zones && merged.zones.rotation_order) {
      const order = merged.zones.rotation_order;
      if (!Array.isArray(order)) {
        errors.push('zones.rotation_order must be an array');
      } else {
        for (const z of order) {
          if (!VALID_ZONE_NAMES.includes(z)) {
            errors.push(`Invalid zone name in rotation_order: "${z}". Valid: ${VALID_ZONE_NAMES.join(', ')}`);
          }
        }
      }
    }

    // Validate duration values
    if (merged.zones) {
      for (const zone of VALID_ZONE_NAMES) {
        if (zone === 'video') continue; // video uses fallback_seconds + play_full
        const zoneConf = merged.zones[zone];
        if (zoneConf && zoneConf.duration_seconds !== undefined) {
          if (typeof zoneConf.duration_seconds !== 'number' || zoneConf.duration_seconds <= 0) {
            errors.push(`zones.${zone}.duration_seconds must be a positive number`);
          }
        }
      }
      // Video fallback
      if (merged.zones.video && merged.zones.video.fallback_seconds !== undefined) {
        if (typeof merged.zones.video.fallback_seconds !== 'number' || merged.zones.video.fallback_seconds <= 0) {
          errors.push('zones.video.fallback_seconds must be a positive number');
        }
      }
    }

    // Validate system.port
    if (merged.system && merged.system.port !== undefined) {
      const port = merged.system.port;
      if (typeof port !== 'number' || port < 1 || port > 65535 || !Number.isInteger(port)) {
        errors.push('system.port must be an integer between 1 and 65535');
      }
    }

    if (errors.length > 0) {
      throw new Error('Config validation failed: ' + errors.join('; '));
    }
  }

  /**
   * Deep-merge updates into current config and write back to config.yaml.
   * Creates a backup before saving. Validates before writing.
   * The chokidar watcher will auto-detect the change and trigger reload.
   * @param {object} updates - Top-level keys to merge into config
   * @returns {object} The new merged config
   */
  saveConfig(updates) {
    const current = this._config || {};
    // Deep-merge: top-level keys in updates overwrite
    const merged = Object.assign({}, current);
    for (const key of Object.keys(updates)) {
      if (
        typeof updates[key] === 'object' &&
        updates[key] !== null &&
        !Array.isArray(updates[key]) &&
        typeof merged[key] === 'object' &&
        merged[key] !== null &&
        !Array.isArray(merged[key])
      ) {
        merged[key] = Object.assign({}, merged[key], updates[key]);
      } else {
        merged[key] = updates[key];
      }
    }

    // Validate before saving
    this._validateConfig(merged);

    // Backup current config before writing
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
        console.log('[ConfigLoader] Config backed up to config.yaml.bak');
      }
    } catch (backupErr) {
      console.error(`[ConfigLoader] Backup failed (proceeding with save): ${backupErr.message}`);
    }

    const yamlStr = yaml.dump(merged, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
    return merged;
  }

  /**
   * Returns the path to the config file.
   * @returns {string}
   */
  getConfigPath() {
    return CONFIG_PATH;
  }

  /**
   * Restore config from backup (config.yaml.bak).
   * The chokidar watcher will auto-detect the change and trigger reload.
   * @returns {boolean} true if restored, false if no backup exists
   */
  restoreBackup() {
    if (!fs.existsSync(BACKUP_PATH)) {
      return false;
    }
    fs.copyFileSync(BACKUP_PATH, CONFIG_PATH);
    console.log('[ConfigLoader] Config restored from config.yaml.bak');
    return true;
  }

  /**
   * Stop watching config file.
   */
  stopWatching() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }
}

// Singleton instance
const loader = new ConfigLoader();

module.exports = loader;
