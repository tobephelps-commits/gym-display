const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const chokidar = require('chokidar');
const EventEmitter = require('events');

const CONFIG_PATH = path.join(__dirname, '..', 'config.yaml');

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
   * Deep-merge updates into current config and write back to config.yaml.
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
    const yamlStr = yaml.dump(merged, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
    return merged;
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
