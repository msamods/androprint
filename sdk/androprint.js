/**
 * AndroPrint Client SDK
 * =====================
 * Official Developer SDK for AndroPrint ESC/POS Cloud & Local Print Server
 * 
 * Developed By : MSA MODS x WhatYouWantKerala
 * Website      : https://github.com/msamods/androprint
 * 
 * Supports:
 * - ⚡ Cloud Pub/Sub via MQTT (Zero Tunnels / Pair Code)
 * - 🔑 Local LAN & Cloudflare Tunnel REST API
 * - 🍳 Multi-Printer Smart Order Routing (KOT, BOT, Bill)
 * - 📄 HTML and PDF to Thermal Receipt conversion
 * - 🧾 Visual Designer Template Rendering
 * - 💵 Hardware triggers (Cash Drawer Kick & Kitchen Buzzer)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AndroPrint = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  class AndroPrint {
    /**
     * Initialize AndroPrint Client
     * @param {Object} config
     * @param {string} [config.baseUrl] Local IP (e.g. 'http://192.168.1.100:3000') or Cloudflare URL
     * @param {string} [config.clientId] POS Client ID (from clients.html)
     * @param {string} [config.printKey] 4-digit Device PIN / Print Key
     * @param {string} [config.pairCode] Device Pair Code / Server ID (e.g. 'srv-0f6fecb2')
     * @param {string} [config.serverId] Alias for pairCode
     * @param {string} [config.broker] MQTT Broker URL (default: 'mqtt://broker.hivemq.com:1883')
     * @param {string} [config.topicPrefix] MQTT Topic prefix (default: 'androprint')
     * @param {string} [config.mode] 'http' | 'mqtt' | 'auto' (default: 'auto')
     * @param {number} [config.timeout] HTTP Request timeout in ms (default: 10000)
     */
    constructor(config = {}) {
      this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
      this.clientId = config.clientId || 'default';
      this.printKey = config.printKey || config.pin || '';
      this.pairCode = config.pairCode || config.serverId || '';
      this.broker = config.broker || 'mqtt://broker.hivemq.com:1883';
      this.topicPrefix = config.topicPrefix || 'androprint';
      this.timeout = config.timeout || 10000;
      this.mqttClient = null;

      // Determine communication mode
      if (config.mode) {
        this.mode = config.mode;
      } else if (this.pairCode && !this.baseUrl) {
        this.mode = 'mqtt';
      } else {
        this.mode = 'http';
      }
    }

    /* ================= HTTP REQUEST ENGINE ================= */

    async _request(endpoint, body = null, method = 'POST') {
      if (!this.baseUrl) {
        throw new Error('AndroPrint: baseUrl is required for HTTP mode (e.g. http://192.168.1.100:3000)');
      }

      const headers = {
        'Content-Type': 'application/json',
        'x-client-id': this.clientId,
        'x-print-key': this.printKey
      };

      const options = {
        method,
        headers
      };

      if (body && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(body);
      }

      const url = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

      // Universal fetch (works in browser & Node.js 18+)
      const response = await fetch(url, options);
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        const errorMsg = data.error || data.message || `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(`AndroPrint Error: ${errorMsg}`);
      }

      return data;
    }

    /* ================= MQTT CLIENT ENGINE ================= */

    async _getMqttClient() {
      if (this.mqttClient && this.mqttClient.connected) {
        return this.mqttClient;
      }

      let mqttLib;
      if (typeof window !== 'undefined' && window.mqtt) {
        mqttLib = window.mqtt;
      } else if (typeof require === 'function') {
        try {
          mqttLib = require('mqtt');
        } catch (e) {
          throw new Error("AndroPrint: 'mqtt' package is required for MQTT mode. Run: npm install mqtt");
        }
      } else {
        throw new Error('AndroPrint: MQTT library not found.');
      }

      return new Promise((resolve, reject) => {
        const client = mqttLib.connect(this.broker, {
          clientId: `androprint_client_${Math.random().toString(16).substring(2, 8)}`,
          clean: true,
          connectTimeout: 8000
        });

        client.on('connect', () => {
          this.mqttClient = client;
          resolve(client);
        });

        client.on('error', (err) => {
          reject(new Error(`AndroPrint MQTT Connect Error: ${err.message}`));
        });
      });
    }

    async _publishMqtt(subTopic, payload) {
      if (!this.pairCode) {
        throw new Error('AndroPrint: pairCode (or serverId) is required for MQTT mode.');
      }

      const client = await this._getMqttClient();
      const topic = `${this.topicPrefix}/${this.pairCode}/${subTopic}`;
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

      return new Promise((resolve, reject) => {
        client.publish(topic, payloadStr, { qos: 1 }, (err) => {
          if (err) return reject(err);
          resolve({ success: true, mode: 'mqtt', topic });
        });
      });
    }

    /* ================= CORE PRINTING METHODS ================= */

    /**
     * Dispatch Receipt Print
     * @param {Object} options
     * @param {string} [options.text] Receipt text
     * @param {string} [options.printerId] Target printer ID (or 'auto')
     * @param {string} [options.role] Printer role ('CASHIER', 'KITCHEN', 'BAR')
     * @param {Object|string} [options.qr] UPI details { upi: { pa, am, pn } } or raw QR string
     * @param {Object|string} [options.barcode] Barcode data or { data, type }
     * @param {boolean} [options.drawerKick] Kick cash drawer on print
     * @param {boolean} [options.buzzer] Kitchen buzzer acoustic alarm
     * @param {boolean} [options.cut] Auto-cut paper after receipt
     * @param {string} [options.cutMode] 'full' or 'partial'
     * @param {number} [options.feedLines] Line feed count before cutting (default 2)
     */
    async print(options = {}) {
      if (this.mode === 'mqtt') {
        return this._publishMqtt('print', options);
      }
      return this._request('/print', options);
    }

    /**
     * Smart Multi-Printer Order Routing
     * Automatically splits items:
     * - Food -> KITCHEN printer (KOT with buzzer and notes)
     * - Drinks -> BAR printer (BOT)
     * - Final Bill -> CASHIER printer (with UPI QR, drawer kick, and full cut)
     * - Automatic failover to Cashier if kitchen printer is offline!
     * @param {Object} order
     */
    async routeOrder(order = {}) {
      if (this.mode === 'mqtt') {
        return this._publishMqtt('route', order);
      }
      return this._request('/api/print/route', order);
    }

    /**
     * HTML-to-Receipt Auto-Converter
     * Parses HTML tables, headers, and bullet points directly into ESC/POS format
     * @param {string} html HTML string
     * @param {Object} [options]
     */
    async printHtml(html, options = {}) {
      return this._request('/api/print/html', { html, ...options });
    }

    /**
     * PDF-to-Receipt Auto-Converter
     * Parses PDF documents into thermal receipt format with word wrap & auto-cut
     * @param {string} pdfBase64 Base64-encoded PDF string
     * @param {Object} [options]
     */
    async printPdf(pdfBase64, options = {}) {
      return this._request('/api/print/pdf', { pdfBase64, ...options });
    }

    /**
     * Print Visual Designer Template
     * @param {string|Object} templateIdOrObject Template ID string or full template object
     * @param {Object} [variables] Key-value variables to interpolate ({ ORDER_ID: '101' })
     * @param {Object} [options]
     */
    async printTemplate(templateIdOrObject, variables = {}, options = {}) {
      const payload = {
        variables,
        ...options
      };
      if (typeof templateIdOrObject === 'string') {
        payload.templateId = templateIdOrObject;
      } else {
        payload.template = templateIdOrObject;
      }
      return this._request('/api/template/render-and-print', payload);
    }

    /* ================= HARDWARE ACTIONS ================= */

    /**
     * Kick Cash Drawer (Pulse RJ11/RJ12 Pin 2 / Pin 5)
     * @param {string} [printerId]
     */
    async kickDrawer(printerId = null) {
      if (this.mode === 'mqtt') {
        return this._publishMqtt('print', { printerId, drawerKick: true, cut: false });
      }
      return this._request('/api/printer/drawer-kick', { printerId });
    }

    /**
     * Sound Kitchen Acoustic Alarm Beep
     * @param {string} [printerId]
     * @param {number} [count=2]
     */
    async soundBuzzer(printerId = null, count = 2) {
      if (this.mode === 'mqtt') {
        return this._publishMqtt('print', { printerId, buzzer: true, count, cut: false });
      }
      return this._request('/api/printer/buzzer', { printerId, count });
    }

    /**
     * Dynamic UPI Payment QR Print
     * @param {string} printerId
     * @param {Object} upiDetails { pa: 'merchant@upi', pn: 'Store', am: '250.00' }
     * @param {Object} [options]
     */
    async printUpi(printerId, upiDetails, options = {}) {
      return this._request('/api/printer/qr', {
        printerId,
        qr: { upi: upiDetails },
        ...options
      });
    }

    /**
     * Cut Paper
     * @param {string} printerId
     * @param {string} [mode='full'] 'full' or 'partial'
     * @param {number} [feed=3]
     */
    async cut(printerId, mode = 'full', feed = 3) {
      return this._request('/api/printer/cut', { printerId, mode, feed });
    }

    /* ================= TELEMETRY & MANAGEMENT ================= */

    /**
     * Get All Configured Printers and Online Status
     */
    async getPrinters() {
      return this._request('/api/printers', null, 'GET');
    }

    /**
     * Auto-Discover Thermal Printers on Local LAN Subnet
     * @param {string} [subnet] Optional subnet prefix (e.g. '192.168.1')
     */
    async discoverPrinters(subnet = null) {
      return this._request('/api/printers/discover', { subnet });
    }

    /**
     * Get Server Health, Uptime, and Stats
     */
    async getStatus() {
      return this._request('/api/server', null, 'GET');
    }

    /**
     * Get Recent Print Job History
     * @param {number} [limit=50]
     */
    async getJobs(limit = 50) {
      return this._request(`/api/jobs?limit=${limit}`, null, 'GET');
    }

    /**
     * Close MQTT connection if open
     */
    disconnect() {
      if (this.mqttClient) {
        try { this.mqttClient.end(true); } catch (e) {}
        this.mqttClient = null;
      }
    }
  }

  return AndroPrint;
}));
