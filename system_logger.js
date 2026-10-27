/**
 * ANDROPRINT SYSTEM LOGGER & AUDIT ENGINE
 * Developed By : MSA MODS x WhatYouWantKerala
 *
 * Real-time ring-buffered in-memory logger + persistent file logger
 * with SSE broadcast support and live log filtering/download.
 */

const fs = require('fs');
const path = require('path');

class SystemLogger {
  constructor(baseDir = __dirname, maxEntries = 1000) {
    this.baseDir = baseDir;
    this.logFile = path.join(baseDir, 'androprint.log');
    this.maxEntries = maxEntries;
    this.logs = [];
    this.sseBroadcaster = null;
    this.init();
  }

  init() {
    // Read tail of existing log file if available
    try {
      if (fs.existsSync(this.logFile)) {
        const lines = fs.readFileSync(this.logFile, 'utf8').trim().split('\n').filter(Boolean);
        const recent = lines.slice(-100);
        for (const line of recent) {
          try {
            const parsed = JSON.parse(line);
            this.logs.push(parsed);
          } catch {
            this.logs.push({
              id: 'log-' + Math.random().toString(36).substring(2, 9),
              timestamp: new Date().toISOString(),
              level: 'INFO',
              category: 'SYSTEM',
              message: line
            });
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  setBroadcaster(fn) {
    this.sseBroadcaster = fn;
  }

  log(level, category, message, meta = null) {
    const entry = {
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      level: (level || 'INFO').toUpperCase(),
      category: (category || 'GENERAL').toUpperCase(),
      message: typeof message === 'object' ? JSON.stringify(message) : String(message),
      meta: meta || undefined
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxEntries) {
      this.logs.shift();
    }

    // Append to file asynchronously
    const line = JSON.stringify(entry) + '\n';
    fs.appendFile(this.logFile, line, () => {});

    // Broadcast live event via SSE
    if (typeof this.sseBroadcaster === 'function') {
      try {
        this.sseBroadcaster({ type: 'log_event', log: entry });
      } catch {}
    }

    return entry;
  }

  info(category, message, meta) {
    return this.log('INFO', category, message, meta);
  }

  warn(category, message, meta) {
    return this.log('WARN', category, message, meta);
  }

  error(category, message, meta) {
    return this.log('ERROR', category, message, meta);
  }

  success(category, message, meta) {
    return this.log('SUCCESS', category, message, meta);
  }

  print(category, message, meta) {
    return this.log('PRINT', category, message, meta);
  }

  getLogs(options = {}) {
    let result = [...this.logs];
    const { level, category, search, limit = 200 } = options;

    if (level && level !== 'ALL') {
      result = result.filter(l => l.level === level.toUpperCase());
    }
    if (category && category !== 'ALL') {
      result = result.filter(l => l.category.toLowerCase().includes(category.toLowerCase()));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l => l.message.toLowerCase().includes(q) || (l.category && l.category.toLowerCase().includes(q)));
    }

    return result.slice(-parseInt(limit, 10));
  }

  clear() {
    this.logs = [];
    try {
      fs.writeFileSync(this.logFile, '');
    } catch {}
    this.info('SYSTEM', 'System logs cleared by administrator');
    return true;
  }

  getLogFilePath() {
    return this.logFile;
  }

  exportFormattedText() {
    return this.logs.map(l => `[${l.timestamp}] [${l.level.padEnd(7)}] [${l.category}] ${l.message}`).join('\n');
  }
}

module.exports = SystemLogger;
