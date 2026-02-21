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
