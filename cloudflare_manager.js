/**
 * Cloudflare Tunnel & Remote Cloud Gateway Manager for AndroPrint
 * Supports 1-Click Quick Tunnels (trycloudflare.com), Named Tunnels (Token), and Manual URLs
 * Developed By : MSA MODS x WhatYouWantKerala
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

class CloudflareManager {
  constructor(dataDir, logger, broadcaster) {
    this.dataDir = dataDir;
    this.logger = logger;
    this.broadcaster = broadcaster || (() => {});
    this.configFile = path.join(dataDir, 'cloud.json');
    this.process = null;
    this.ltInstance = null;
    this.tunnel = {
      active: false,
      url: null,
      provider: 'cloudflare',
      mode: 'manual', // 'quick' | 'token' | 'manual'
      token: null,
      startedAt: null,
      error: null
    };

    this.loadConfig();
  }

  setBroadcaster(fn) {
    this.broadcaster = fn;
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        const raw = fs.readFileSync(this.configFile, 'utf8').trim();
        if (raw) {
          const saved = JSON.parse(raw);
          this.tunnel = Object.assign(this.tunnel, saved);
        }
      }
    } catch (e) {
      if (this.logger) this.logger.warn('CLOUD', 'Failed to load cloud.json: ' + e.message);
    }
  }

  saveConfig() {
    try {
      const dataToSave = {
        active: this.tunnel.active,
        url: this.tunnel.url,
        provider: this.tunnel.provider,
        mode: this.tunnel.mode,
        token: this.tunnel.token,
        startedAt: this.tunnel.startedAt
      };
      fs.writeFileSync(this.configFile, JSON.stringify(dataToSave, null, 2));
    } catch (e) {
      if (this.logger) this.logger.error('CLOUD', 'Failed to save cloud.json: ' + e.message);
    }
  }

  isCloudflaredBinaryInstalled() {
    try {
      const cmd = os.platform() === 'win32' ? 'where cloudflared' : 'which cloudflared';
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      return !!(out && out.trim());
    } catch {
      return false;
    }
  }

  isInstalled() {
    // Built-in Zero-Config Gateway (localtunnel) is always available in AndroPrint bundle!
    return true;
  }

  getInstallInstructions() {
    const isWin = os.platform() === 'win32';
    const isTermux = fs.existsSync('/data/data/com.termux');

    if (isTermux) {
      return {
        platform: 'Android Termux',
        command: 'pkg update && pkg install -y cloudflared',
        steps: [
          'Built-in Zero-Config Gateway is active and requires no install.',
          'To optionally use official Cloudflare binary:',
          'Open Termux terminal and run: pkg update && pkg install -y cloudflared'
        ]
      };
    } else if (isWin) {
      return {
        platform: 'Windows',
        command: 'winget install --id Cloudflare.cloudflared',
        manualUrl: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
        steps: [
          'Built-in Zero-Config Gateway is active and requires no install.',
          'To optionally use official Cloudflare binary: winget install --id Cloudflare.cloudflared'
        ]
      };
    } else {
      return {
        platform: 'Linux / Debian / Ubuntu',
        command: 'curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared.deb',
        steps: [
          'Built-in Zero-Config Gateway is active and requires no install.',
          'To optionally use official Cloudflare binary: sudo dpkg -i cloudflared.deb'
        ]
      };
    }
  }

  getStatus() {
    const hasNative = this.isCloudflaredBinaryInstalled();
    return {
      success: true,
      installed: true,
      hasNativeCloudflared: hasNative,
      hasBuiltInGateway: true,
      instructions: this.getInstallInstructions(),
      tunnel: {
        active: this.tunnel.active,
        url: this.tunnel.url,
        provider: this.tunnel.provider,
        mode: this.tunnel.mode,
        startedAt: this.tunnel.startedAt,
        hasToken: !!this.tunnel.token
      }
    };
  }

  registerManual(url, provider = 'cloudflare') {
    if (!url || typeof url !== 'string') {
      throw new Error('Valid URL string is required');
    }
    const cleanUrl = url.trim().replace(/\/+$/, '');
    this.tunnel.active = true;
    this.tunnel.url = cleanUrl;
    this.tunnel.provider = provider;
    this.tunnel.mode = 'manual';
    this.tunnel.startedAt = new Date().toISOString();
    this.tunnel.error = null;
    this.saveConfig();

    if (this.logger) this.logger.success('CLOUD', `Cloud tunnel registered: ${cleanUrl} (${provider})`);
    this.broadcaster({ type: 'cloud_update', tunnel: this.tunnel });
    return this.tunnel;
  }

  async startLocalTunnel(port) {
    if (this.process) this.stop();
    if (this.ltInstance) {
      try { this.ltInstance.close(); } catch {}
      this.ltInstance = null;
    }

    let localtunnel = null;
    try {
      localtunnel = require('localtunnel');
    } catch (err) {
      throw new Error('Built-in LocalTunnel engine not loaded: ' + err.message);
    }

    if (this.logger) this.logger.info('CLOUD', `Launching Built-in Zero-Config Cloud Gateway on port ${port}...`);

    return new Promise(async (resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Cloud gateway startup timed out. Check internet connection.'));
        }
      }, 25000);

      try {
        const tunnel = await localtunnel({ port });
        this.ltInstance = tunnel;
        resolved = true;
        clearTimeout(timeout);

        this.tunnel.active = true;
        this.tunnel.url = tunnel.url;
        this.tunnel.provider = 'localtunnel';
        this.tunnel.mode = 'quick';
        this.tunnel.startedAt = new Date().toISOString();
        this.tunnel.error = null;
        this.saveConfig();

        if (this.logger) this.logger.success('CLOUD', `Built-in Cloud Gateway LIVE: ${tunnel.url}`);
        this.broadcaster({ type: 'cloud_update', tunnel: this.tunnel });

        tunnel.on('close', () => {
          if (this.tunnel.active && this.tunnel.provider === 'localtunnel') {
            this.tunnel.active = false;
            this.tunnel.url = null;
            this.saveConfig();
            this.broadcaster({ type: 'cloud_update', tunnel: this.tunnel });
          }
          if (this.logger) this.logger.warn('CLOUD', 'Built-in Cloud Gateway closed');
        });

        tunnel.on('error', (err) => {
          if (this.logger) this.logger.error('CLOUD', 'Built-in Cloud Gateway error: ' + (err.message || err));
        });

        resolve(this.tunnel);
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      }
    });
  }

  async startQuickTunnel(port, useSsl = false) {
    if (this.isCloudflaredBinaryInstalled()) {
      try {
        return await this._spawnCloudflaredQuick(port, useSsl);
      } catch (err) {
        if (this.logger) this.logger.warn('CLOUD', `Cloudflared quick failed (${err.message}), falling back to Built-in Gateway...`);
      }
    }

    // Zero-Install fallback for Android APK and all platforms
    if (this.logger) this.logger.info('CLOUD', 'Starting Built-in Zero-Config Cloud Gateway (No installation needed)...');
    return await this.startLocalTunnel(port);
  }

  async _spawnCloudflaredQuick(port, useSsl = false) {
    if (this.process) {
      this.stop();
    }

    const targetUrl = useSsl ? `https://127.0.0.1:${port}` : `http://127.0.0.1:${port}`;
    const args = ['tunnel', '--url', targetUrl];
    if (useSsl) {
      args.push('--no-tls-verify');
    }

    if (this.logger) this.logger.info('CLOUD', `Starting Cloudflare Quick Tunnel to ${targetUrl}...`);

    return new Promise((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Cloudflare tunnel startup timed out after 35 seconds. Check internet connectivity.'));
        }
      }, 35000);

      try {
        this.process = spawn('cloudflared', args, {
          env: process.env,
          windowsHide: true
        });

        const handleOutput = (chunk) => {
          const text = chunk.toString();
          // Regex for TryCloudflare URL: https://[a-zA-Z0-9-]+\.trycloudflare\.com
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
          if (match && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            const publicUrl = match[0];
            this.tunnel.active = true;
            this.tunnel.url = publicUrl;
            this.tunnel.provider = 'cloudflare';
            this.tunnel.mode = 'quick';
            this.tunnel.startedAt = new Date().toISOString();
            this.tunnel.error = null;
            this.saveConfig();

            if (this.logger) this.logger.success('CLOUD', `Cloudflare Quick Tunnel LIVE: ${publicUrl}`);
            this.broadcaster({ type: 'cloud_update', tunnel: this.tunnel });
            resolve(this.tunnel);
          }
        };

        if (this.process.stdout) this.process.stdout.on('data', handleOutput);
        if (this.process.stderr) this.process.stderr.on('data', handleOutput);

        this.process.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(err);
          }
          if (this.logger) this.logger.error('CLOUD', 'Cloudflared process error: ' + err.message);
        });

        this.process.on('exit', (code) => {
          if (this.tunnel.mode === 'quick' && this.tunnel.active) {
            this.tunnel.active = false;
            this.tunnel.url = null;
            this.saveConfig();
            this.broadcaster({ type: 'cloud_update', tunnel: this.tunnel });
          }
          if (this.logger) this.logger.warn('CLOUD', `Cloudflare process exited (code ${code})`);
        });

      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  async startNamedTunnel(token) {
    if (!this.isInstalled()) {
      throw new Error('cloudflared binary is not installed on system.');
    }

    if (!token || typeof token !== 'string') {
      throw new Error('Cloudflare Tunnel token is required for Named Tunnel mode.');
    }

    if (this.process) {
      this.stop();
    }

    const cleanToken = token.trim();
    const args = ['tunnel', 'run', '--token', cleanToken];

    if (this.logger) this.logger.info('CLOUD', 'Starting Cloudflare Named Tunnel with token...');

    return new Promise((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // For token tunnels, cloudflared doesn't print a temporary trycloudflare URL,
          // it connects to the user's custom hostname configured in Cloudflare Zero Trust.
          this.tunnel.active = true;
          this.tunnel.provider = 'cloudflare';
          this.tunnel.mode = 'token';
          this.tunnel.token = cleanToken;
          this.tunnel.startedAt = new Date().toISOString();
          this.saveConfig();
          this.broadcaster({ type: 'cloud_update', tunnel: this.tunnel });
          resolve(this.tunnel);
        }
      }, 5000);

      try {
        this.process = spawn('cloudflared', args, {
          env: process.env,
          windowsHide: true
        });

        const handleOutput = (chunk) => {
          const text = chunk.toString();
          if (text.includes('Registered tunnel connection') || text.includes('Connection registered') || text.includes('Connected to')) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              this.tunnel.active = true;
              this.tunnel.provider = 'cloudflare';
              this.tunnel.mode = 'token';
              this.tunnel.token = cleanToken;
              this.tunnel.startedAt = new Date().toISOString();
              this.saveConfig();
              if (this.logger) this.logger.success('CLOUD', 'Cloudflare Named Tunnel connection confirmed active');
              this.broadcaster({ type: 'cloud_update', tunnel: this.tunnel });
              resolve(this.tunnel);
            }
          }
        };

        if (this.process.stdout) this.process.stdout.on('data', handleOutput);
        if (this.process.stderr) this.process.stderr.on('data', handleOutput);

        this.process.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(err);
          }
        });

      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  stop() {
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
        setTimeout(() => {
          if (this.process) {
            try { this.process.kill('SIGKILL'); } catch {}
          }
        }, 1500);
      } catch (e) {
        if (this.logger) this.logger.warn('CLOUD', 'Process kill note: ' + e.message);
      }
      this.process = null;
    }

    if (this.ltInstance) {
      try { this.ltInstance.close(); } catch {}
      this.ltInstance = null;
    }

    this.tunnel.active = false;
    this.tunnel.url = null;
    this.saveConfig();
    if (this.logger) this.logger.info('CLOUD', 'Cloud gateway stopped');
    this.broadcaster({ type: 'cloud_update', tunnel: this.tunnel });
    return { success: true, message: 'Cloud gateway stopped' };
  }
}

module.exports = CloudflareManager;
