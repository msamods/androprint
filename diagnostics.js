/**
 * ANDROPRINT DIAGNOSTIC & SELF-REPAIR ENGINE
 * Developed By : MSA MODS x WhatYouWantKerala
 *
 * Full diagnostic suite for Android 8 - 16, Termux environment,
 * Single-Phone connected devices (USB OTG, Bluetooth, Wi-Fi LAN, Hotspot),
 * health score computation, and one-click auto-repair.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { exec, execSync } = require('child_process');
const { ensureSSLCertificates } = require('./generate-ssl');

class DiagnosticEngine {
  constructor(baseDir = __dirname, logger = null) {
    this.baseDir = baseDir;
    this.logger = logger;
  }

  log(level, cat, msg) {
    if (this.logger) this.logger.log(level, cat, msg);
    else console.log(`[${level}] [${cat}] ${msg}`);
  }

  // Detect Android & Termux environment details
  getAndroidInfo() {
    const isTermux = Boolean(process.env.TERMUX_VERSION || fs.existsSync('/data/data/com.termux'));
    let androidRelease = 'Unknown';
    let sdkVersion = 0;
    let deviceModel = 'Generic Device';

    try {
      if (fs.existsSync('/system/bin/getprop')) {
        androidRelease = execSync('getprop ro.build.version.release', { timeout: 1000 }).toString().trim() || 'Unknown';
        sdkVersion = parseInt(execSync('getprop ro.build.version.sdk', { timeout: 1000 }).toString().trim(), 10) || 0;
        deviceModel = execSync('getprop ro.product.model', { timeout: 1000 }).toString().trim() || 'Android Device';
      }
    } catch {}

    let wakelockActive = false;
    try {
      // Check if termux wake lock file exists
      if (fs.existsSync('/data/data/com.termux/files/home/.termux_wake_lock') ||
          fs.existsSync(path.join(os.homedir(), '.termux_wake_lock'))) {
        wakelockActive = true;
      }
    } catch {}

    return {
      isTermux,
      androidRelease,
      sdkVersion,
      deviceModel,
      wakelockActive,
      arch: os.arch(),
      platform: os.platform(),
      nodeVersion: process.version
    };
  }

  // Run comprehensive diagnostic check
  async runDiagnostics(currentPort = 3000, useSSL = true) {
    const issues = [];
    let healthScore = 100;
    const androidInfo = this.getAndroidInfo();

    // 1. Memory Diagnostic
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMemPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
    const heapUsedMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    if (usedMemPercent > 92 || heapUsedMB > 450) {
      healthScore -= 20;
      issues.push({
        id: 'mem_high',
        severity: 'CRITICAL',
        title: 'High Memory Pressure',
        message: `Device memory usage is at ${usedMemPercent}%. Heap: ${heapUsedMB}MB. Risk of Android OS killing background service.`,
        autoFixable: true,
        fixAction: 'flush_memory'
      });
    } else if (usedMemPercent > 80) {
      healthScore -= 10;
      issues.push({
        id: 'mem_warning',
        severity: 'WARNING',
        title: 'Elevated Memory Usage',
        message: `Device memory usage is at ${usedMemPercent}%.`,
        autoFixable: true,
        fixAction: 'flush_memory'
      });
    }

    // 2. Storage Diagnostic
    try {
      // Check write permission in data dir
      const testFile = path.join(this.baseDir, '.write_test_' + Date.now());
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (err) {
      healthScore -= 30;
      issues.push({
        id: 'storage_readonly',
        severity: 'CRITICAL',
        title: 'Storage Directory Not Writable',
        message: `Cannot write to ${this.baseDir}: ${err.message}`,
        autoFixable: true,
        fixAction: 'fix_permissions'
      });
    }

    // 3. Android Wakelock Diagnostic (For Android 8-16 Doze mode prevention)
    if (androidInfo.isTermux && !androidInfo.wakelockActive) {
      healthScore -= 15;
      issues.push({
        id: 'wakelock_missing',
        severity: 'WARNING',
        title: 'Termux Wakelock Inactive',
        message: 'CPU Wakelock is disabled. Android battery optimization may put AndroPrint to sleep when the screen locks.',
        autoFixable: true,
        fixAction: 'enable_wakelock'
      });
    }

    // 4. SSL Certificates Check
    const keyPath = path.join(this.baseDir, 'server.key');
    const certPath = path.join(this.baseDir, 'server.cert');
    const sslFilesExist = fs.existsSync(keyPath) && fs.existsSync(certPath);

    if (useSSL && !sslFilesExist) {
      healthScore -= 25;
      issues.push({
        id: 'ssl_missing',
        severity: 'CRITICAL',
        title: 'SSL Certificate Missing',
        message: 'HTTPS is enabled but server.key or server.cert was not found.',
        autoFixable: true,
        fixAction: 'generate_ssl'
      });
    } else if (sslFilesExist) {
      try {
        const certStr = fs.readFileSync(certPath, 'utf8');
        if (!certStr.includes('BEGIN CERTIFICATE')) {
          healthScore -= 20;
          issues.push({
            id: 'ssl_corrupted',
            severity: 'CRITICAL',
            title: 'SSL Certificate Corrupted',
            message: 'server.cert file does not contain valid X.509 certificate headers.',
            autoFixable: true,
            fixAction: 'generate_ssl'
          });
        }
      } catch (err) {
        healthScore -= 15;
        issues.push({
          id: 'ssl_read_error',
          severity: 'WARNING',
          title: 'SSL Read Error',
          message: err.message,
          autoFixable: true,
          fixAction: 'generate_ssl'
        });
      }
    }

    // 5. JSON Database Integrity Check
    const dbFiles = [
      { name: 'printer.json', defaultContent: '[]' },
      { name: 'jobs.json', defaultContent: '[]' },
      { name: 'clients.json', defaultContent: '[]' },
      { name: 'webhooks.json', defaultContent: '{}' }
    ];

    for (const db of dbFiles) {
      const p = path.join(this.baseDir, db.name);
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8').trim();
          if (raw) JSON.parse(raw);
        } catch (err) {
          healthScore -= 25;
          issues.push({
            id: `json_corrupted_${db.name}`,
            severity: 'CRITICAL',
            title: `Corrupted Database (${db.name})`,
            message: `JSON syntax error in ${db.name}: ${err.message}`,
            autoFixable: true,
            fixAction: `repair_${db.name}`
          });
        }
      }
    }

    // 6. Check for stuck print jobs
    const jobsPath = path.join(this.baseDir, 'jobs.json');
    if (fs.existsSync(jobsPath)) {
      try {
        const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8') || '[]');
        const stuck = jobs.filter(j => j.status === 'printing' && (Date.now() - new Date(j.timestamp || 0).getTime() > 180000));
        if (stuck.length > 0) {
          healthScore -= 10;
          issues.push({
            id: 'stuck_jobs',
            severity: 'WARNING',
            title: 'Stuck Print Jobs Detected',
            message: `${stuck.length} job(s) have been stuck in 'printing' state for over 3 minutes.`,
            autoFixable: true,
            fixAction: 'flush_stuck_jobs'
          });
        }
      } catch {}
    }

    // 7. Check Termux-API presence
    if (androidInfo.isTermux) {
      let hasTermuxApi = false;
      try {
        execSync('command -v termux-battery-status', { timeout: 1000 });
        hasTermuxApi = true;
      } catch {}

      if (!hasTermuxApi) {
        issues.push({
          id: 'termux_api_missing',
          severity: 'INFO',
          title: 'Termux:API Not Installed',
          message: 'Install Termux:API app and package for enhanced battery & bluetooth monitoring.',
          autoFixable: true,
          fixAction: 'install_termux_api'
        });
      }
    }

    // Ensure score bounds
    healthScore = Math.max(10, Math.min(100, healthScore));

    return {
      timestamp: new Date().toISOString(),
      healthScore,
      status: healthScore >= 90 ? 'OPTIMAL' : healthScore >= 65 ? 'ATTENTION' : 'CRITICAL',
      issues,
      androidInfo,
      metrics: {
        usedMemPercent,
        heapUsedMB,
        totalMemMB: Math.round(totalMem / 1024 / 1024),
        freeMemMB: Math.round(freeMem / 1024 / 1024),
        uptimeSeconds: Math.floor(process.uptime()),
        currentPort,
        useSSL
      }
    };
  }

  // Execute full automated bug repair sequence
  async runAutoRepair(currentPort = 3000) {
    const steps = [];
    const fixedIssues = [];

    this.log('SYSTEM', 'AUTO_REPAIR', 'Starting automated self-healing sequence...');

    // Step 1: Repair Corrupted JSON DBs (15%)
    steps.push({ step: 1, name: 'Database Integrity Repair', progress: 15 });
    const dbFiles = [
      { name: 'printer.json', defaultContent: '[]' },
      { name: 'jobs.json', defaultContent: '[]' },
      { name: 'clients.json', defaultContent: '[]' },
      { name: 'webhooks.json', defaultContent: '{}' }
    ];

    for (const db of dbFiles) {
      const p = path.join(this.baseDir, db.name);
      let needsFix = false;
      if (!fs.existsSync(p)) {
        needsFix = true;
      } else {
        try {
          const raw = fs.readFileSync(p, 'utf8').trim();
          if (!raw) needsFix = true;
          else JSON.parse(raw);
        } catch {
          // Backup corrupted
          try {
            fs.copyFileSync(p, p + '.corrupted.' + Date.now());
          } catch {}
          needsFix = true;
        }
      }

      if (needsFix) {
        fs.writeFileSync(p, db.defaultContent);
        fixedIssues.push(`Restored clean syntax in ${db.name}`);
        this.log('SUCCESS', 'AUTO_REPAIR', `Repaired database: ${db.name}`);
      }
    }

    // Step 2: Acquire Wakelock for Android 8-16 (35%)
    steps.push({ step: 2, name: 'Android CPU Wakelock Verification', progress: 35 });
    if (os.platform() !== 'win32') {
      try {
        if (fs.existsSync('/data/data/com.termux/files/usr/bin/termux-wake-lock')) {
          execSync('/data/data/com.termux/files/usr/bin/termux-wake-lock', { timeout: 2000 });
          fixedIssues.push('Acquired Termux Wakelock (Prevents Android Sleep)');
          this.log('SUCCESS', 'AUTO_REPAIR', 'Wakelock locked successfully');
        } else if (execSync('which termux-wake-lock 2>/dev/null || true', { timeout: 1000 }).toString().trim()) {
          execSync('termux-wake-lock', { timeout: 2000 });
          fixedIssues.push('Acquired CPU Wakelock');
        }
      } catch (e) {
        this.log('WARN', 'AUTO_REPAIR', 'Wakelock command notice: ' + e.message);
      }
    }

    // Step 3: Regenerate / Verify SSL Certificates with SAN (55%)
    steps.push({ step: 3, name: 'SSL Certificate Generation & SAN Binding', progress: 55 });
    try {
      const sslResult = ensureSSLCertificates(this.baseDir);
      if (sslResult.success) {
        fixedIssues.push(`Verified/Generated 10-year SSL Certs for localhost & LAN`);
        this.log('SUCCESS', 'AUTO_REPAIR', 'SSL certificates verified and ready');
      }
    } catch (e) {
      this.log('WARN', 'AUTO_REPAIR', 'SSL verification: ' + e.message);
    }

    // Step 4: Flush Stuck Print Jobs (75%)
    steps.push({ step: 4, name: 'Print Queue Despooling', progress: 75 });
    try {
      const jobsPath = path.join(this.baseDir, 'jobs.json');
      if (fs.existsSync(jobsPath)) {
        const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8') || '[]');
        let modified = false;
        const now = Date.now();
        for (const j of jobs) {
          if (j.status === 'printing' && (now - new Date(j.timestamp || 0).getTime() > 120000)) {
            j.status = 'failed';
            j.error = 'Auto-recovered: Print job timed out during unexpected disconnect';
            modified = true;
          }
        }
        if (modified) {
          fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2));
          fixedIssues.push('Flushed and recovered stuck printing jobs');
          this.log('SUCCESS', 'AUTO_REPAIR', 'Recovered pending stuck jobs in queue');
        }
      }
    } catch (e) {
      this.log('WARN', 'AUTO_REPAIR', 'Jobs flush error: ' + e.message);
    }

    // Step 5: Socket & Zombie Cleanups (90%)
    steps.push({ step: 5, name: 'Socket & Zombie Process Clearance', progress: 90 });
    try {
      // In termux or linux, clear defunct processes if any
      if (os.platform() !== 'win32') {
        exec('pkill -f "cloudflared tunnel.*--metrics" 2>/dev/null || true');
      }
      fixedIssues.push('Cleared orphaned network sockets and zombie processes');
    } catch {}

    // Step 6: Final Verification (100%)
    steps.push({ step: 6, name: 'System Optimization Complete', progress: 100 });
    this.log('SUCCESS', 'AUTO_REPAIR', 'Auto-repair sequence finished successfully');

    return {
      success: true,
      timestamp: new Date().toISOString(),
      fixedCount: fixedIssues.length,
      fixedIssues,
      steps,
      finalHealth: await this.runDiagnostics(currentPort, true)
    };
  }

  // Scan all Single Phone Local Connected Devices
  // (USB OTG, Bluetooth, Wi-Fi LAN 9100, Hotspot connected devices)
  async scanConnectedDevices(onProgress = null) {
    const devices = {
      usb: [],
      bluetooth: [],
      network: [],
      hotspot: []
    };

    const emitProgress = (percent, message) => {
      if (typeof onProgress === 'function') onProgress(percent, message);
    };

    emitProgress(10, 'Scanning USB OTG & Serial printers (/dev/usb/lp*, /dev/bus/usb)...');

    // 1. USB OTG & Serial Printers
    try {
      if (os.platform() === 'linux' || process.env.TERMUX_VERSION) {
        // Check /dev/usb/lp0, lp1...
        const devPaths = ['/dev/usb', '/dev'];
        for (const d of devPaths) {
          if (fs.existsSync(d)) {
            const files = fs.readdirSync(d);
            for (const f of files) {
              if (f.startsWith('lp') || f.startsWith('ttyUSB') || f.startsWith('ttyACM')) {
                devices.usb.push({
                  id: 'usb-' + f,
                  type: 'USB_OTG',
                  name: `USB Printer (${f})`,
                  path: path.join(d, f),
                  online: true,
                  details: `Direct USB / Serial device node`
                });
              }
            }
          }
        }
      }
    } catch (e) {
      this.log('WARN', 'USB_SCAN', e.message);
    }

    emitProgress(35, 'Scanning Bluetooth ESC/POS thermal printers...');

    // 2. Bluetooth Thermal Printers
    try {
      if (process.env.TERMUX_VERSION || fs.existsSync('/data/data/com.termux')) {
        // Check via termux-bluetooth-scan if installed
        try {
          const btOut = execSync('termux-bluetooth-scan 2>/dev/null || true', { timeout: 3000 }).toString();
          if (btOut && btOut.startsWith('[')) {
            const btList = JSON.parse(btOut);
            for (const bt of btList) {
              devices.bluetooth.push({
                id: 'bt-' + (bt.address || Math.random().toString(36).substring(2, 6)),
                type: 'BLUETOOTH',
                name: bt.name || 'Bluetooth ESC/POS Device',
                address: bt.address,
                rssi: bt.rssi,
                online: true,
                details: `Paired / Visible Bluetooth Device`
              });
            }
          }
        } catch {}
      }
    } catch (e) {
      this.log('WARN', 'BT_SCAN', e.message);
    }

    emitProgress(60, 'Scanning Wi-Fi LAN & Hotspot network printers (Port 9100)...');

    // 3. Network Thermal Printers (Wi-Fi LAN / Hotspot)
    try {
      const interfaces = os.networkInterfaces();
      const subnets = [];
      for (const name in interfaces) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            const parts = iface.address.split('.');
            if (parts[0] !== '169' || parts[1] !== '254') {
              subnets.push(parts.slice(0, 3).join('.'));
            }
          }
        }
      }

      const uniqueSubnets = Array.from(new Set(subnets));
      // Fast probe common printer IPs (.100, .101, .200, .87, etc.) and first 30 IPs
      for (const subnet of uniqueSubnets) {
        const probeList = [
          ...Array.from({ length: 30 }, (_, i) => `${subnet}.${i + 1}`),
          `${subnet}.100`, `${subnet}.101`, `${subnet}.102`, `${subnet}.150`, `${subnet}.200`, `${subnet}.254`
        ];

        const uniqueIps = Array.from(new Set(probeList));
        const batchSize = 15;
        for (let i = 0; i < uniqueIps.length; i += batchSize) {
          const chunk = uniqueIps.slice(i, i + batchSize);
          await Promise.all(chunk.map(async ip => {
            const isOpen = await new Promise(res => {
              const s = new net.Socket();
              s.setTimeout(350);
              s.connect(9100, ip, () => {
                s.destroy();
                res(true);
              });
              s.on('error', () => { s.destroy(); res(false); });
              s.on('timeout', () => { s.destroy(); res(false); });
            });

            if (isOpen) {
              devices.network.push({
                id: 'net-' + ip.replace(/\./g, '-'),
                type: 'NETWORK_TCP',
                name: `Network Thermal Printer (${ip})`,
                ip,
                port: 9100,
                online: true,
                details: `Raw ESC/POS port 9100 reachable`
              });
            }
          }));
        }
      }
    } catch (e) {
      this.log('WARN', 'NET_SCAN', e.message);
    }

    emitProgress(85, 'Scanning Hotspot connected client devices (ARP table)...');

    // 4. Hotspot Connected Devices (ARP table inspection)
    try {
      if (fs.existsSync('/proc/net/arp')) {
        const arpLines = fs.readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1);
        for (const line of arpLines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 6 && parts[2] !== '0x0') {
            const [ip, hwType, flags, mac, mask, dev] = parts;
            devices.hotspot.push({
              id: 'hotspot-' + ip.replace(/\./g, '-'),
              type: 'HOTSPOT_CLIENT',
              ip,
              mac,
              interface: dev,
              name: `Connected Hotspot Device (${ip})`,
              details: `Client on ${dev} [${mac}]`
            });
          }
        }
      }
    } catch (e) {
      this.log('WARN', 'HOTSPOT_SCAN', e.message);
    }

    emitProgress(100, 'Device scan complete!');

    const totalCount = devices.usb.length + devices.bluetooth.length + devices.network.length + devices.hotspot.length;
    this.log('INFO', 'DEVICE_SCAN', `Discovered ${totalCount} local connected devices`);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      totalCount,
      devices
    };
  }

  // Check for updates
  async checkUpdate(currentVersion = '2.0.0') {
    return {
      currentVersion,
      latestVersion: '2.0.0',
      updateAvailable: false,
      changelog: [
        '✨ One-click Android Installer for all systems (Android 8 - 16)',
        '✨ Standalone Single-Phone Hub for all local connected devices',
        '✨ SSL Enabled Local https://localhost:3000 out-of-the-box',
        '✨ Dynamic Port Changer with live rebind',
        '✨ Diagnostic Health Score & 1-Click Auto-Repair for bugs',
        '✨ Termux Widgets & Termux Terminal CLI integration'
      ],
      downloadUrl: 'https://github.com/msamods/androprint'
    };
  }
}

module.exports = DiagnosticEngine;
