/**
 * Notification Service
 *
 * Handles notification delivery through two channels:
 * - Pushover: Critical alerts with emergency priority (wake-up capable)
 * - Email: Warning alerts via Gmail SMTP (nodemailer)
 *
 * Both channels gracefully handle unconfigured state — log warning once and skip.
 * Never throws on send failure — notifications are best-effort.
 *
 * Part of v1.3 Resilience — Phase 14 (Tiered Alert System).
 */

const Push = require('pushover-notifications');
const nodemailer = require('nodemailer');

class NotificationService {
  /**
   * @param {Object} config - Notification configuration
   * @param {Object} [config.pushover] - Pushover settings
   * @param {string} [config.pushover.user_key] - Pushover user key
   * @param {string} [config.pushover.app_token] - Pushover application token
   * @param {Object} [config.email] - Email settings
   * @param {string} [config.email.gmail_user] - Gmail address
   * @param {string} [config.email.gmail_app_password] - Gmail App Password (16-char)
   * @param {string[]} [config.email.recipients] - Email recipient addresses
   */
  constructor(config) {
    this._config = config || {};

    // Pushover channel
    this._pushoverConfigured = false;
    this._pushoverClient = null;
    this._pushoverWarningLogged = false;
    this._pushoverLastSend = null;
    this._pushoverLastError = null;

    // Email channel
    this._emailConfigured = false;
    this._emailTransporter = null;
    this._emailWarningLogged = false;
    this._emailLastSend = null;
    this._emailLastError = null;

    this._initPushover();
    this._initEmail();
  }

  /**
   * Initialize Pushover client if configured.
   */
  _initPushover() {
    const po = this._config.pushover || {};
    if (po.user_key && po.app_token) {
      this._pushoverClient = new Push({
        user: po.user_key,
        token: po.app_token
      });
      this._pushoverConfigured = true;
      console.log('[Notifications] Pushover configured');
    }
  }

  /**
   * Initialize email transporter if configured.
   */
  _initEmail() {
    const email = this._config.email || {};
    if (email.gmail_user && email.gmail_app_password && email.recipients && email.recipients.length > 0) {
      this._emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: email.gmail_user,
          pass: email.gmail_app_password
        }
      });
      this._emailConfigured = true;
      this._emailRecipients = email.recipients;
      this._emailFrom = email.gmail_user;
      console.log('[Notifications] Email configured (Gmail SMTP)');
    }
  }

  /**
   * Send a Pushover push notification.
   * @param {string} title - Notification title
   * @param {string} message - Notification body
   * @param {number} [priority=0] - Pushover priority (0=normal, 1=high, 2=emergency)
   * @returns {Promise<Object|null>} Pushover response or null if unconfigured/failed
   */
  async sendPushover(title, message, priority = 0) {
    if (!this._pushoverConfigured) {
      if (!this._pushoverWarningLogged) {
        console.log('[Notifications] Pushover not configured — skipping push notifications');
        this._pushoverWarningLogged = true;
      }
      return null;
    }

    const msg = {
      title,
      message,
      priority,
      sound: priority >= 2 ? 'siren' : 'pushover'
    };

    // Emergency priority: retry every 60s, expire after 1 hour
    if (priority >= 2) {
      msg.retry = 60;
      msg.expire = 3600;
    }

    return new Promise((resolve) => {
      console.log(`[Notifications] Sending Pushover: "${title}" (priority=${priority})`);
      this._pushoverClient.send(msg, (err, result) => {
        if (err) {
          this._pushoverLastError = { message: err.message || String(err), timestamp: new Date().toISOString() };
          console.error(`[Notifications] Pushover send failed: ${err.message || err}`);
          resolve(null);
        } else {
          this._pushoverLastSend = new Date().toISOString();
          this._pushoverLastError = null;
          console.log(`[Notifications] Pushover sent successfully`);
          resolve(result);
        }
      });
    });
  }

  /**
   * Send an email notification.
   * @param {string} subject - Email subject line
   * @param {string} body - Email body (plain text)
   * @returns {Promise<Object|null>} Nodemailer info or null if unconfigured/failed
   */
  async sendEmail(subject, body) {
    if (!this._emailConfigured) {
      if (!this._emailWarningLogged) {
        console.log('[Notifications] Email not configured — skipping email notifications');
        this._emailWarningLogged = true;
      }
      return null;
    }

    try {
      console.log(`[Notifications] Sending email: "${subject}" to ${this._emailRecipients.length} recipient(s)`);
      const info = await this._emailTransporter.sendMail({
        from: this._emailFrom,
        to: this._emailRecipients.join(','),
        subject,
        text: body
      });
      this._emailLastSend = new Date().toISOString();
      this._emailLastError = null;
      console.log(`[Notifications] Email sent successfully (messageId: ${info.messageId})`);
      return info;
    } catch (err) {
      this._emailLastError = { message: err.message || String(err), timestamp: new Date().toISOString() };
      console.error(`[Notifications] Email send failed: ${err.message || err}`);
      return null;
    }
  }

  /**
   * Get notification service status.
   * @returns {{ pushover: Object, email: Object }}
   */
  getStatus() {
    return {
      pushover: {
        configured: this._pushoverConfigured,
        lastSend: this._pushoverLastSend,
        lastError: this._pushoverLastError
      },
      email: {
        configured: this._emailConfigured,
        lastSend: this._emailLastSend,
        lastError: this._emailLastError
      }
    };
  }
}

/**
 * Factory function to create a NotificationService instance.
 * @param {Object} config - Notification configuration
 * @returns {NotificationService}
 */
function create(config) {
  return new NotificationService(config);
}

module.exports = { create, NotificationService };
