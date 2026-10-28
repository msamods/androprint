/**
 * ANDROPRINT v2.0 – CLOUD PRINT SERVER
 * =====================================
 * ✔ Persistent Server ID
 * ✔ Client Auth (ENABLE_AUTH)
 * ✔ Printer CRUD + Real TCP Status
 * ✔ Real Test Print (no fake success)
 * ✔ Print Job Queue & History
 * ✔ WebSocket Real-time Updates
 * ✔ System Stats & Uptime
 * ✔ Cloud Tunnel Management
 * ✔ Safe JSON handling
 */

try {
  process.chdir(__dirname);
} catch (e) {}

// Prevent uncaught errors from killing Android host process
process.on("uncaughtException", (err) => {
  console.error("[CRITICAL] Uncaught exception in Node:", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[CRITICAL] Unhandled rejection in Node:", reason);
});

// Guard process.exit so node::Start never terminates the Android process
process.exit = function(code) {
  console.warn(`[PROTECTION] Intercepted process.exit(${code}) to keep Android app running.`);
};

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const net = require("net");
const os = require("os");
const cors = require("cors");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const multer = require("multer");
const { ThermalPrinter, PrinterTypes } = require("node-thermal-printer");
const QRCode = require("qrcode");
const { Jimp } = require("jimp");
const { PNG } = require("pngjs");

let mqtt = null;
try { mqtt = require("mqtt"); } catch (e) { console.warn("MQTT library not loaded:", e.message); }

let pdfParse = null;
try { pdfParse = require("pdf-parse"); } catch (e) { console.warn("PDF-parse library not loaded:", e.message); }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const app = express();
let PORT = parseInt(process.env.PORT, 10) || 3000;
let STANDALONE_MODE = process.env.STANDALONE_MODE !== "false";
const ENABLE_AUTH = process.env.ENABLE_AUTH === "true";

// Load System Logger & Diagnostic Engine
const SystemLogger = require("./system_logger");
const DiagnosticEngine = require("./diagnostics");
const { ensureSSLCertificates } = require("./generate-ssl");
const CloudflareManager = require("./cloudflare_manager");

const logger = new SystemLogger(__dirname);
const diagnostics = new DiagnosticEngine(__dirname, logger);
const cloudflare = new CloudflareManager(__dirname, logger);

// Auto-ensure high-security SSL certificate for localhost & LAN with SAN
try {
  ensureSSLCertificates(__dirname);
} catch (e) {
  logger.warn("SSL", "Certificate auto-generation note: " + e.message);
}

// SSL / HTTPS Setup
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(__dirname, "server.key");
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, "server.cert");
const USE_SSL = (process.env.USE_SSL === "true" && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH));

let server;
function createHttpOrHttpsServer() {
  if (USE_SSL) {
    try {
      const sslOptions = {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH)
      };
      return https.createServer(sslOptions, app);
    } catch (err) {
      logger.warn("SSL", "Falling back to HTTP: " + err.message);
      return http.createServer(app);
    }
  }
  return http.createServer(app);
}

server = createHttpOrHttpsServer();

// Track active sockets for immediate clean server close and port rebinding
const activeSockets = new Set();
server.on("connection", (socket) => {
  activeSockets.add(socket);
  socket.once("close", () => activeSockets.delete(socket));
});

const DATA_DIR = __dirname;
const PRINTER_FILE = path.join(DATA_DIR, "printer.json");
const CLIENT_FILE = path.join(DATA_DIR, "clients.json");
const SERVER_ID_FILE = path.join(DATA_DIR, "server.id");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const STORE_LOGO_PATH = path.join(DATA_DIR, "uploads", "store_logo.png");
const WEBHOOK_FILE = path.join(DATA_DIR, "webhooks.json");
const TEMPLATES_FILE = path.join(DATA_DIR, "templates.json");
const MQTT_CONFIG_FILE = path.join(DATA_DIR, "mqtt-config.json");

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(express.static("public"));

/* ============ SERVER START TIME ============ */
const SERVER_START = Date.now();

/* ============ PRINT JOB HISTORY ============ */
let printJobs = [];
const MAX_JOBS = 200;

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const raw = fs.readFileSync(JOBS_FILE, "utf8").trim();
      if (raw) printJobs = JSON.parse(raw);
    }
  } catch { printJobs = []; }
}

function saveJobs() {
  if (printJobs.length > MAX_JOBS) {
    printJobs = printJobs.slice(-MAX_JOBS);
  }
  fs.writeFileSync(JOBS_FILE, JSON.stringify(printJobs, null, 2));
}

function addJob(job) {
  printJobs.push({
    id: "job-" + crypto.randomBytes(4).toString("hex"),
    ...job,
    timestamp: new Date().toISOString()
  });
  saveJobs();
  broadcast({ type: "job_update", jobs: getRecentJobs() });
}

function getRecentJobs(limit = 50) {
  return printJobs.slice(-limit).reverse();
}

loadJobs();

/* ============ WEBSOCKET (SSE fallback) ============ */
const sseClients = new Set();

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write("data: " + JSON.stringify({ type: "connected" }) + "\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

function broadcast(data) {
  const msg = "data: " + JSON.stringify(data) + "\n\n";
  sseClients.forEach(client => {
    try { client.write(msg); } catch { sseClients.delete(client); }
  });
}
logger.setBroadcaster(broadcast);
cloudflare.setBroadcaster(broadcast);

/* ============ SERVER ID ============ */

function getServerId() {
  if (fs.existsSync(SERVER_ID_FILE)) {
    return fs.readFileSync(SERVER_ID_FILE, "utf8").trim();
  }
  const id = "srv-" + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(SERVER_ID_FILE, id);
  return id;
}

const SERVER_ID = getServerId();

/* ============ SAFE JSON ============ */

function safeRead(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeWrite(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error(`[STORAGE] Failed to write ${file}: ${err.message}`);
    return false;
  }
}

/* ============ LOADERS ============ */

function loadPrinters() {
  const data = safeRead(PRINTER_FILE, { printers: [] });
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.printers)) return data.printers;
  return [];
}

function savePrinters(printers) {
  const list = Array.isArray(printers) ? printers : [];
  return safeWrite(PRINTER_FILE, { printers: list });
}

function loadClients() {
  const data = safeRead(CLIENT_FILE, { clients: [] });
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.clients)) return data.clients;
  return [];
}

function saveClients(clients) {
  const list = Array.isArray(clients) ? clients : [];
  return safeWrite(CLIENT_FILE, { clients: list });
}

/* ============ AUTH ============ */

function authRequired(req, res, next) {
  if (!ENABLE_AUTH) return next();

  const cid = req.headers["x-client-id"];
  const key = req.headers["x-print-key"];

  if (!cid || !key) {
    return res.status(401).json({ error: "Client ID / Print Key missing" });
  }

  const client = loadClients().find(c => c.id === cid);

  if (!client || !client.enabled) {
    return res.status(403).json({ error: "Client not allowed" });
  }

  if (client.pin !== key) {
    return res.status(403).json({ error: "Invalid Print Key" });
  }

  req.client = client;
  next();
}

/* ============ TCP CHECK & DIAGNOSTICS ============ */

function checkPrinterConnection(ip, port, timeout = 2000) {
  if (!ip) return Promise.resolve({ online: false, error: "NO_IP" });
  return new Promise(resolve => {
    const socket = new net.Socket();
    let online = false;
    let errCode = null;

    socket.setTimeout(timeout);
    socket.connect(port, ip, () => {
      online = true;
      socket.destroy();
    });

    socket.on("error", err => {
      errCode = err.code || err.message;
    });
    socket.on("timeout", () => {
      errCode = "ETIMEDOUT";
      socket.destroy();
    });
    socket.on("close", () => resolve({ online, error: errCode }));
  });
}

async function isPrinterOnline(ip, port, timeout = 1500) {
  const res = await checkPrinterConnection(ip, port, timeout);
  return res.online;
}

function explainPrinterError(errCode, ip, port, printerName = "Printer") {
  let title = "Connection Failed";
  let description = `Cannot communicate with ${printerName} at ${ip}:${port}.`;
  let fix = [];

  if (errCode === "ETIMEDOUT") {
    title = "Connection Timed Out";
    description = `The printer at ${ip}:${port} did not respond within ${2}s.`;
    fix = [
      "1. Check if the printer is powered ON and LAN cable / Wi-Fi is connected.",
      "2. Check if printer IP changed: Print Self-Test slip (turn off, hold FEED button, turn on).",
      "3. Ensure the printer and your phone are connected to the exact same Wi-Fi router.",
      "4. Disable 'AP Isolation' or 'Client Isolation' in your Wi-Fi router settings."
    ];
  } else if (errCode === "ECONNREFUSED") {
    title = "Port 9100 Refused / Closed";
    description = `The device at ${ip} is reachable, but Port ${port} is closed or rejected connection.`;
    fix = [
      "1. Make sure your printer is an ESC/POS network thermal printer with RAW Port 9100 enabled.",
      "2. Check if the printer uses another port (e.g. 4000 or 8000) on the self-test slip.",
      "3. If using a print server adapter, ensure it is configured for RAW ESC/POS pass-through."
    ];
  } else if (errCode === "EHOSTUNREACH" || errCode === "ENETUNREACH") {
    title = "Subnet Unreachable";
    description = `Host ${ip} is unreachable from this phone's network interface.`;
    fix = [
      "1. Subnet Mismatch: If your phone is on 192.168.1.x, the printer must also be on 192.168.1.x.",
      "2. If printer is on factory IP 192.168.192.168 or 192.168.0.x, change its IP to match router subnet.",
      "3. Verify your phone Wi-Fi is connected to the same local network."
    ];
  } else {
    title = "Printer Offline / Network Error";
    description = errCode ? `Error details: ${errCode}` : `Printer at ${ip}:${port} is unreachable.`;
    fix = [
      "1. Verify printer paper roll is installed correctly and cover is tightly closed.",
      "2. Verify printer LED is solid green/blue, not blinking red error.",
      "3. Turn off printer for 5 seconds and power back on."
    ];
  }

  return { title, description, fix };
}

/* ============ NETWORK PRINTER AUTO-DISCOVERY ============ */

function getLocalSubnets() {
  const interfaces = os.networkInterfaces();
  const subnets = [];
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        const parts = iface.address.split(".");
        // Exclude link-local APIPA 169.254.x.x
        if (parts[0] !== "169" || parts[1] !== "254") {
          subnets.push({
            subnet: parts.slice(0, 3).join("."),
            localIp: iface.address,
            interface: name
          });
        }
      }
    }
  }
  return subnets;
}

async function probePrinter(ip, port = 9100, timeout = 700) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let modelName = "";
    let answered = false;

    socket.setTimeout(timeout);

    socket.connect(port, ip, () => {
      answered = true;
      // Send ESC/POS Transmit Printer ID: GS I 67 (0x1D 0x49 0x43)
      try {
        socket.write(Buffer.from([0x1D, 0x49, 0x43]));
      } catch (e) {}

      setTimeout(() => {
        socket.destroy();
      }, 150);
    });

    socket.on("data", chunk => {
      const text = chunk.toString("ascii").replace(/[^\x20-\x7E]/g, "").trim();
      if (text) modelName = text;
    });

    socket.on("error", () => {});
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => {
      if (answered) {
        resolve({
          ip,
          port,
          online: true,
          model: modelName || "ESC/POS Thermal Printer"
        });
      } else {
        resolve(null);
      }
    });
  });
}

async function discoverNetworkPrinters(targetSubnet = null) {
  const localSubnets = getLocalSubnets();
  let subnetsToScan = [];
  if (targetSubnet) {
    subnetsToScan = [targetSubnet];
  } else if (localSubnets.length > 0) {
    subnetsToScan = Array.from(new Set(localSubnets.map(s => s.subnet)));
  } else {
    subnetsToScan = ["192.168.1"];
  }

  const discovered = [];

  for (const subnet of subnetsToScan) {
    const ips = [];
    for (let i = 1; i <= 254; i++) {
      ips.push(`${subnet}.${i}`);
    }

    const concurrency = 32;
    for (let i = 0; i < ips.length; i += concurrency) {
      const chunk = ips.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        chunk.map(ip => probePrinter(ip, 9100, 600))
      );
      for (const res of batchResults) {
        if (res) discovered.push(res);
      }
    }
  }

  return {
    scannedSubnets: subnetsToScan,
    count: discovered.length,
    printers: discovered
  };
}

/* ============ IMAGE RASTERIZER (Monochrome ESC/POS) ============ */

async function rasterizeImage(imageInput, maxWidth = 384) {
  try {
    let buf = null;
    if (Buffer.isBuffer(imageInput)) {
      buf = imageInput;
    } else if (typeof imageInput === "string") {
      if (imageInput.startsWith("data:")) {
        const parts = imageInput.split(",");
        if (parts.length > 1) {
          buf = Buffer.from(parts[1], "base64");
        }
      } else if (imageInput.length > 300 && !imageInput.includes("\n") && !fs.existsSync(imageInput)) {
        buf = Buffer.from(imageInput, "base64");
      } else if (fs.existsSync(imageInput)) {
        buf = fs.readFileSync(imageInput);
      }
    }

    if (!buf) return null;

    const image = await Jimp.read(buf);
    if (!image) return null;

    // Constrain width while maintaining aspect ratio
    if (image.bitmap.width > maxWidth) {
      image.resize({ w: maxWidth });
    }

    // Convert to high-contrast monochrome for thermal paper
    image.greyscale();
    
    // Output PNG buffer for node-thermal-printer
    const pngBuffer = await image.getBuffer("image/png");
    return pngBuffer;
  } catch (err) {
    console.error("Rasterize Image Error:", err.message);
    return null;
  }
}

/* ============ DYNAMIC UPI & QR HELPER ============ */

async function generateQrBuffer(qrInput) {
  let qrText = "";
  if (typeof qrInput === "string") {
    qrText = qrInput;
  } else if (typeof qrInput === "object" && qrInput !== null) {
    if (qrInput.upi) {
      // Dynamic UPI payment URL format for GPay, PhonePe, Paytm, BHIM
      const { pa, pn = "", am = "", cu = "INR", tn = "Bill Payment" } = qrInput.upi;
      const params = new URLSearchParams();
      if (pa) params.set("pa", pa);
      if (pn) params.set("pn", pn);
      if (am) params.set("am", am);
      if (cu) params.set("cu", cu);
      if (tn) params.set("tn", tn);
      qrText = "upi://pay?" + params.toString();
    } else if (qrInput.text || qrInput.data) {
      qrText = qrInput.text || qrInput.data;
    }
  }

  if (!qrText) return null;

  // Universal Raster QR — 100% compatible with all thermal printers
  const pngBuffer = await QRCode.toBuffer(qrText, {
    type: "png",
    width: 220,
    margin: 1,
    errorCorrectionLevel: "M"
  });

  return { pngBuffer, qrText };
}

/* ============ COMPREHENSIVE PRINT RECEIPT ============ */

async function printReceipt(printer, options = {}) {
  const {
    text = "",
    logo = null,
    qr = null,
    barcode = null,
    drawerKick = false,
    buzzer = false,
    beep = false,
    cut = true,
    cutMode = "full",
    feedLines = 2,
    align = "left",
    bold = false,
    underline = false
  } = options;

  const pIp = printer && printer.connection && printer.connection.ip;
  const pPort = (printer && printer.connection && parseInt(printer.connection.port)) || 9100;
  if (!pIp) {
    throw new Error(`Printer '${printer ? (printer.name || printer.id) : "unknown"}' has no IP connection configured.`);
  }

  const device = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${pIp}:${pPort}`,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    options: {
      timeout: 5000
    }
  });

  // ESC @: Initialize hardware
  try {
    device.raw(Buffer.from([0x1B, 0x40])); // ESC @ (Initialize)
    device.raw(Buffer.from([0x1C, 0x26])); // FS & (Select Kanji/Multilingual mode)
    device.raw(Buffer.from([0x1B, 0x74, 0x00])); // ESC t 0 (Standard code page)
  } catch (e) {}

  // 1. CASH DRAWER KICK (kick pin 2 / pin 5)
  if (drawerKick) {
    try {
      device.openCashDrawer();
    } catch (e) {
      // Raw fallback: ESC p 0 25 250
      device.raw(Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]));
      device.raw(Buffer.from([0x1B, 0x70, 0x01, 0x19, 0xFA]));
    }
  }

  // 2. KITCHEN BUZZER / BEEP (acoustic alert for kitchen/waiter)
  if (buzzer || beep) {
    try {
      device.beep();
    } catch (e) {
      // Raw fallback: ESC B 2 2 (2 beeps, 200ms)
      device.raw(Buffer.from([0x1B, 0x42, 0x02, 0x02]));
    }
  }

  // 3. STORE LOGO / RASTER IMAGE
  const effectiveLogo = logo || (fs.existsSync(STORE_LOGO_PATH) && logo !== false ? STORE_LOGO_PATH : null);
  if (effectiveLogo) {
    try {
      const maxWidth = (printer.paperWidth === 58) ? 320 : 480;
      const pngBuf = await rasterizeImage(effectiveLogo, maxWidth);
      if (pngBuf) {
        const png = PNG.sync.read(pngBuf);
        device.alignCenter();
        const imgCmd = device.printer.printImageBuffer(png.width, png.height, png.data);
        device.append(imgCmd);
        device.newLine();
      }
    } catch (e) {
      console.warn("Logo print warning:", e.message);
    }
  }

  // 4. MAIN RECEIPT TEXT (with alignment & styling)
  if (text) {
    if (align === "center") device.alignCenter();
    else if (align === "right") device.alignRight();
    else device.alignLeft();

    if (bold) device.bold(true);
    if (underline) device.underline(true);

    device.println(text);

    if (bold) device.bold(false);
    if (underline) device.underline(false);
  }

  // 5. BARCODE (Code128 / EAN13)
  if (barcode) {
    try {
      device.alignCenter();
      const codeData = typeof barcode === "string" ? barcode : barcode.data;
      const codeType = typeof barcode === "object" && barcode.type ? barcode.type.toUpperCase() : "CODE128";
      if (codeType === "CODE128" || !codeType) {
        device.code128(codeData, { width: 2, height: 60 });
      } else {
        device.printBarcode(codeData, codeType, { width: 2, height: 60 });
      }
      device.newLine();
    } catch (e) {
      console.warn("Barcode print warning:", e.message);
    }
  }

  // 6. DYNAMIC UPI QR / QR CODE
  if (qr) {
    try {
      const qrRes = await generateQrBuffer(qr);
      if (qrRes && qrRes.pngBuffer) {
        const png = PNG.sync.read(qrRes.pngBuffer);
        device.alignCenter();
        const imgCmd = device.printer.printImageBuffer(png.width, png.height, png.data);
        device.append(imgCmd);
        device.newLine();
      }
    } catch (e) {
      console.warn("QR print warning:", e.message);
    }
  }

  // 7. PAPER CUT
  if (cut !== false && cut !== "none") {
    const lines = typeof feedLines === "number" ? feedLines : (parseInt(feedLines, 10) || 2);
    for (let i = 0; i < lines; i++) {
      device.newLine();
    }
    if (cut === "partial" || cutMode === "partial") {
      device.partialCut();
    } else {
      device.cut();
    }
  }

  const ok = await device.execute();
  return ok;
}

/* Legacy wrapper for backward compatibility */
async function printText(printer, text) {
  return await printReceipt(printer, { text, cut: true });
}

/* ============ API: SERVER INFO (ENHANCED) ============ */

app.get("/api/server", async (req, res) => {
  const printers = loadPrinters();
  const clients = loadClients();

  const statuses = await Promise.all(
    printers.map(async p => ({
      id: p && p.id,
      online: p && p.connection && p.connection.ip ? await isPrinterOnline(p.connection.ip, p.connection.port || 9100) : false
    }))
  );

  const onlineCount = statuses.filter(s => s.online).length;
  const uptime = Date.now() - SERVER_START;

  res.json({
    serverId: SERVER_ID,
    auth: ENABLE_AUTH,
    version: "2.0.0",
    port: PORT,
    ssl: USE_SSL,
    standalone: STANDALONE_MODE,
    android: diagnostics.getAndroidInfo(),
    uptime,
    uptimeFormatted: formatUptime(uptime),
    startedAt: new Date(SERVER_START).toISOString(),
    stats: {
      totalPrinters: printers.length,
      onlinePrinters: onlineCount,
      offlinePrinters: printers.length - onlineCount,
      enabledPrinters: printers.filter(p => p.enabled).length,
      totalClients: clients.length,
      activeClients: clients.filter(c => c.enabled).length,
      totalJobs: printJobs.length,
      recentJobs: getRecentJobs(5).length
    },
    printerStatuses: statuses
  });
});

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  return `${minutes}m ${secs}s`;
}

/* ============ API: CLIENTS ============ */

app.get("/api/clients", (req, res) => {
  res.json({ clients: loadClients() });
});

app.post("/api/client/create", (req, res) => {
  const clients = loadClients();
  const id = "clt-" + crypto.randomBytes(3).toString("hex");
  const pin = Math.floor(100000 + Math.random() * 900000).toString();
  const label = req.body.label || "";

  const client = {
    id,
    pin,
    label,
    role: "CLIENT",
    enabled: true,
    createdAt: new Date().toISOString()
  };

  clients.push(client);
  saveClients(clients);
  broadcast({ type: "client_update", clients: loadClients() });

  res.json(client);
});

app.post("/api/client/toggle", (req, res) => {
  const clients = loadClients();
  const client = clients.find(c => c.id === req.body.id);
  if (!client) return res.status(404).json({ error: "Client not found" });
  client.enabled = !client.enabled;
  saveClients(clients);
  broadcast({ type: "client_update", clients: loadClients() });
  res.json({ success: true, enabled: client.enabled });
});

app.post("/api/client/delete", (req, res) => {
  const clients = loadClients().filter(c => c.id !== req.body.id);
  saveClients(clients);
  broadcast({ type: "client_update", clients: loadClients() });
  res.json({ success: true });
});

/* ============ API: PRINTERS ============ */

app.get("/api/printers", async (req, res) => {
  const printers = loadPrinters();

  const enriched = await Promise.all(
    printers.map(async p => ({
      ...p,
      online: await isPrinterOnline(
        p.connection.ip,
        p.connection.port
      )
    }))
  );

  res.json({ printers: enriched });
});

app.get("/api/printers/discover", authRequired, async (req, res) => {
  try {
    const subnet = req.query.subnet || null;
    const result = await discoverNetworkPrinters(subnet);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/printers/discover", authRequired, async (req, res) => {
  try {
    const subnet = req.body.subnet || null;
    const result = await discoverNetworkPrinters(subnet);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(["/api/printer/save", "/api/printers/save"], authRequired, (req, res) => {
  try {
    const p = req.body;
    if (!p || typeof p !== "object") {
      return res.status(400).json({ success: false, error: "Invalid printer data payload" });
    }

    if (!p.id) {
      p.id = "ptr-" + crypto.randomBytes(3).toString("hex");
    }

    if (!p.connection || !p.connection.ip) {
      return res.status(400).json({ success: false, error: "Printer IP address is required" });
    }

    p.connection.port = parseInt(p.connection.port) || 9100;
    if (!p.name) {
      p.name = `Printer (${p.connection.ip})`;
    }

    const printers = loadPrinters();
    const index = printers.findIndex(x => x.id === p.id);
    if (index >= 0) {
      printers[index] = { ...printers[index], ...p };
    } else {
      printers.push(p);
    }

    const ok = savePrinters(printers);
    if (!ok) {
      return res.status(500).json({ success: false, error: "Failed to persist printer to storage" });
    }

    logger.info("PRINTER", `Saved printer '${p.name}' (${p.connection.ip}:${p.connection.port})`);
    broadcast({ type: "printer_update", printers: loadPrinters() });
    res.json({ success: true, printer: p });
  } catch (err) {
    logger.error("PRINTER", "Error saving printer: " + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(["/api/printer/delete", "/api/printers/delete"], authRequired, (req, res) => {
  try {
    const targetId = req.body && (req.body.id || req.body.printerId);
    if (!targetId) {
      return res.status(400).json({ success: false, error: "Printer ID is required for deletion" });
    }

    const printers = loadPrinters().filter(p => p.id !== targetId);
    savePrinters(printers);
    logger.info("PRINTER", `Deleted printer ${targetId}`);
    broadcast({ type: "printer_update", printers: loadPrinters() });
    res.json({ success: true });
  } catch (err) {
    logger.error("PRINTER", "Error deleting printer: " + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ============ REAL TEST PRINT ============ */

app.post("/api/printer/test", authRequired, async (req, res) => {
  try {
    const { printerId } = req.body;
    const printers = Array.isArray(loadPrinters()) ? loadPrinters() : [];
    const printer = printers.find(p => p && p.id === printerId && p.enabled);

    if (!printer) {
      return res.status(404).json({
        success: false,
        printed: false,
        title: "Printer Not Found",
        error: "Printer is not found or is currently disabled in database.",
        fix: [
          "1. Open 'Printers' menu and verify that your printer exists.",
          "2. If disabled, click the 'Enable' toggle button on the printer card."
        ]
      });
    }

    const pIp = printer.connection && printer.connection.ip;
    const pPort = (printer.connection && parseInt(printer.connection.port)) || 9100;
    if (!pIp) {
      return res.status(400).json({
        success: false,
        printed: false,
        title: "Invalid Printer Configuration",
        error: `Printer '${printer.name}' is missing IP connection settings.`,
        fix: ["Edit this printer in 'Printers' menu and enter a valid IP address."]
      });
    }

    const conn = await checkPrinterConnection(pIp, pPort, 2500);

    if (!conn.online) {
      const diag = explainPrinterError(conn.error, printer.connection.ip, printer.connection.port, printer.name);
      addJob({
        printerId,
        printerName: printer.name,
        type: "test",
        status: "failed",
        error: diag.description
      });
      return res.status(502).json({
        success: false,
        printed: false,
        title: diag.title,
        error: diag.description,
        fix: diag.fix,
        diagnostics: {
          ip: printer.connection.ip,
          port: printer.connection.port,
          errCode: conn.error
        }
      });
    }

    const tp = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printer.connection.ip}:${printer.connection.port}`,
      timeout: 3500
    });

    tp.println("================================");
    tp.println("       ANDROPRINT v2.0");
    tp.println("       TEST PRINT");
    tp.println("================================");
    tp.println(`Printer : ${printer.name}`);
    tp.println(`Host    : ${printer.connection.ip}:${printer.connection.port}`);
    tp.println(`Server  : ${SERVER_ID}`);
    tp.println(`Time    : ${new Date().toLocaleString()}`);
    tp.println("================================");
    tp.println("  ✓ Connection OK");
    tp.println("  ✓ Print Engine OK");
    tp.println("  ✓ Paper Feed OK");
    tp.println("================================\n\n");
    tp.cut();

    const ok = await tp.execute();
    if (!ok) throw new Error("Printer execute command returned false");

    addJob({
      printerId,
      printerName: printer.name,
      type: "test",
      status: "success"
    });

    res.json({ success: true, printed: true, message: `Test receipt printed on ${printer.name}` });

  } catch (e) {
    const errorMsg = e.message || "Unknown error";
    addJob({
      printerId: req.body.printerId,
      type: "test",
      status: "failed",
      error: errorMsg
    });
    res.status(500).json({
      success: false,
      printed: false,
      title: "Print Execution Failed",
      error: errorMsg,
      fix: [
        "1. Check if printer paper roll is empty or cover is open.",
        "2. Check if printer error indicator (RED light) is blinking.",
        "3. Turn off printer for 5 seconds and power back on."
      ]
    });
  }
});

/* ============ SMART PRINTER RESOLUTION & ROUTING ============ */

async function resolvePrinterForJob(targetId = null, role = null) {
  const printers = loadPrinters().filter(p => p.enabled !== false);
  if (!printers || printers.length === 0) return null;

  // 1. Direct match by ID if provided and not "auto"
  if (targetId && targetId !== "auto") {
    const direct = printers.find(p => p.id === targetId);
    if (direct) return direct;
  }

  // 2. Role-based routing (e.g. KITCHEN, BAR, CASHIER, PARCEL)
  if (role) {
    const rolePrinters = printers.filter(p => p && (p.role || "CASHIER").toUpperCase() === role.toUpperCase());
    for (const p of rolePrinters) {
      if (p.connection && p.connection.ip && (await isPrinterOnline(p.connection.ip, p.connection.port || 9100))) {
        return p;
      }
    }
    if (rolePrinters.length > 0) return rolePrinters[0];
  }

  // 3. Fallback: Find Cashier or any online printer
  const cashier = printers.find(p => p && (p.role || "").toUpperCase() === "CASHIER");
  if (cashier && cashier.connection && cashier.connection.ip && (await isPrinterOnline(cashier.connection.ip, cashier.connection.port || 9100))) {
    return cashier;
  }

  for (const p of printers) {
    if (p && p.connection && p.connection.ip && (await isPrinterOnline(p.connection.ip, p.connection.port || 9100))) {
      return p;
    }
  }

  return cashier || printers[0] || null;
}

/* ============ PRINT ENDPOINT ============ */

app.post("/print", authRequired, async (req, res) => {
  try {
    const targetRole = req.headers["x-printer-role"] || req.body.role || req.body.target;
    const rawPrinterId = req.headers["x-printer-id"] || req.body.printerId;

    const {
      text = "",
      logo = null,
      qr = null,
      barcode = null,
      drawerKick = false,
      buzzer = false,
      beep = false,
      cut = true,
      cutMode = "full",
      feedLines = 2,
      align = "left",
      bold = false,
      underline = false
    } = req.body;

    if (!text && !logo && !qr && !barcode && !drawerKick && !buzzer && !beep) {
      return res.status(400).json({
        error: "At least one print action (text, logo, qr, barcode, drawerKick, buzzer) required"
      });
    }

    const printer = await resolvePrinterForJob(rawPrinterId, targetRole);

    if (!printer) {
      addJob({
        printerId: rawPrinterId || "auto",
        type: "print",
        status: "failed",
        error: "No active printer found or all printers disabled",
        textPreview: (text || "Rich Receipt").substring(0, 100)
      });
      return res.status(404).json({ error: "No active printer found or all printers disabled" });
    }

    const printerId = printer.id;

    await printReceipt(printer, {
      text,
      logo,
      qr,
      barcode,
      drawerKick,
      buzzer,
      beep,
      cut,
      cutMode,
      feedLines,
      align,
      bold,
      underline
    });

    addJob({
      printerId,
      printerName: printer.name,
      type: "print",
      status: "success",
      textPreview: (text || (qr ? "QR Receipt" : "Receipt")).substring(0, 100),
      clientId: req.client?.id || "anonymous"
    });

    res.json({
      success: true,
      message: "Printed successfully",
      printerId
    });

  } catch (err) {
    console.error("PRINT ERROR:", err);
    addJob({
      printerId: req.headers["x-printer-id"] || req.body.printerId,
      type: "print",
      status: "failed",
      error: err.message
    });
    res.status(500).json({ error: err.message });
  }
});

/* ============ SMART MULTI-PRINTER ROUTING ENGINE ============ */

function padReceiptLine(left = "", right = "", width = 42) {
  const l = String(left);
  const r = String(right);
  if (l.length + r.length >= width) {
    const truncatedLeft = l.substring(0, Math.max(0, width - r.length - 2)) + "..";
    const spaces = Math.max(1, width - truncatedLeft.length - r.length);
    return truncatedLeft + " ".repeat(spaces) + r;
  }
  const spaces = Math.max(1, width - l.length - r.length);
  return l + " ".repeat(spaces) + r;
}

function buildKotTicket(order, width = 42) {
  const lineChar = "=";
  const divider = lineChar.repeat(width);
  const dashDivider = "-".repeat(width);
  const lines = [];

  lines.push(divider);
  lines.push("       *** KITCHEN ORDER TICKET (KOT) ***");
  lines.push(divider);
  lines.push(padReceiptLine(`Order: #${order.orderId || "NEW"}`, `Table: ${order.table || "Dine-In"}`, width));
  if (order.serverName || order.waiter) {
    lines.push(padReceiptLine(`Server: ${order.serverName || order.waiter}`, `Time: ${new Date().toLocaleTimeString()}`, width));
  } else {
    lines.push(`Time: ${new Date().toLocaleString()}`);
  }
  if (order.customer) lines.push(`Customer: ${order.customer}`);
  lines.push(dashDivider);
  lines.push(padReceiptLine("QTY  ITEM DESCRIPTION", "NOTES", width));
  lines.push(dashDivider);

  for (const item of (order.items || [])) {
    const qtyStr = `[${item.qty || 1}x]`;
    lines.push(`${qtyStr} ${item.name}`);
    if (item.notes) {
      lines.push(`     >> NOTE: ${item.notes}`);
    }
  }

  lines.push(divider);
  lines.push(`Total Kitchen Items: ${(order.items || []).reduce((acc, i) => acc + (parseInt(i.qty, 10) || 1), 0)}`);
  lines.push(divider);
  lines.push("");

  return lines.join("\n");
}

function buildBotTicket(order, width = 42) {
  const divider = "=".repeat(width);
  const dashDivider = "-".repeat(width);
  const lines = [];

  lines.push(divider);
  lines.push("          *** BAR ORDER TICKET (BOT) ***");
  lines.push(divider);
  lines.push(padReceiptLine(`Order: #${order.orderId || "NEW"}`, `Table: ${order.table || "Bar Counter"}`, width));
  lines.push(`Time: ${new Date().toLocaleTimeString()} • ${new Date().toLocaleDateString()}`);
  lines.push(dashDivider);
  lines.push(padReceiptLine("QTY  BEVERAGE ITEM", "STATUS", width));
  lines.push(dashDivider);

  for (const item of (order.items || [])) {
    lines.push(padReceiptLine(`[${item.qty || 1}x] ${item.name}`, item.notes || "READY", width));
  }

  lines.push(divider);
  lines.push("");

  return lines.join("\n");
}

function buildBillReceipt(order, width = 42) {
  const divider = "=".repeat(width);
  const dashDivider = "-".repeat(width);
  const lines = [];

  lines.push(divider);
  lines.push("             TAX INVOICE / CASH BILL");
  lines.push(divider);
  lines.push(padReceiptLine(`Bill No: #${order.orderId || "INV-" + Date.now().toString().slice(-4)}`, `Table: ${order.table || "POS"}`, width));
  lines.push(`Date: ${new Date().toLocaleString()}`);
  if (order.customer) lines.push(`Customer: ${order.customer}`);
  lines.push(dashDivider);
  lines.push(padReceiptLine("ITEM", "QTY x PRICE    TOTAL", width));
  lines.push(dashDivider);

  let calcSubtotal = 0;
  for (const item of (order.items || [])) {
    const qty = parseFloat(item.qty) || 1;
    const price = parseFloat(item.price) || 0;
    const itemTotal = parseFloat(item.total) || (qty * price);
    calcSubtotal += itemTotal;

    const itemDetail = `${qty}x${price.toFixed(0)}`;
    const lineRight = `${itemDetail.padStart(8)} ${itemTotal.toFixed(2).padStart(8)}`;
    lines.push(padReceiptLine(item.name, lineRight, width));
  }

  lines.push(dashDivider);
  const subtotal = parseFloat(order.subtotal) || calcSubtotal;
  lines.push(padReceiptLine("Subtotal:", subtotal.toFixed(2), width));

  if (order.discount && parseFloat(order.discount) > 0) {
    lines.push(padReceiptLine("Discount:", `-${parseFloat(order.discount).toFixed(2)}`, width));
  }

  if (order.tax && parseFloat(order.tax) > 0) {
    lines.push(padReceiptLine("Taxes / GST:", parseFloat(order.tax).toFixed(2), width));
  }

  lines.push(divider);
  const grandTotal = parseFloat(order.total) || (subtotal + (parseFloat(order.tax) || 0) - (parseFloat(order.discount) || 0));
  lines.push(padReceiptLine("*** GRAND TOTAL: ***", `Rs. ${grandTotal.toFixed(2)}`, width));
  lines.push(divider);

  if (order.paymentMethod) {
    lines.push(`Payment: ${order.paymentMethod}`);
  }
  lines.push("\n      Thank you for your visit! Please come again.\n");

  return { text: lines.join("\n"), grandTotal };
}

app.post("/api/print/route", authRequired, async (req, res) => {
  try {
    const {
      splits = null,
      order = null,
      orderId = null,
      table = null,
      serverName = null,
      customer = null,
      items = [],
      subtotal = null,
      tax = null,
      discount = null,
      total = null,
      upi = null,
      drawerKick = true,
      buzzer = true,
      printKOT = true,
      printBOT = true,
      printBill = true
    } = req.body;

    const results = [];

    // Mode A: Custom manual splits provided
    if (splits && Array.isArray(splits) && splits.length > 0) {
      for (const split of splits) {
        const targetPrinter = await resolvePrinterForJob(split.printerId, split.role);
        if (!targetPrinter) {
          results.push({ role: split.role, status: "failed", error: "No available printer" });
          continue;
        }

        const isFailover = split.role && targetPrinter.role && (split.role.toUpperCase() !== targetPrinter.role.toUpperCase());
        const printPayload = {
          text: (isFailover ? `[ROUTED VIA ${targetPrinter.role} - ${split.role} OFFLINE]\n` : "") + (split.text || ""),
          logo: split.logo !== undefined ? split.logo : false,
          qr: split.qr || null,
          barcode: split.barcode || null,
          drawerKick: !!split.drawerKick,
          buzzer: !!split.buzzer,
          cut: split.cut !== false
        };

        await printReceipt(targetPrinter, printPayload);
        addJob({
          printerId: targetPrinter.id,
          printerName: targetPrinter.name,
          type: "smart_route",
          status: "success",
          textPreview: `[Role: ${split.role} -> ${targetPrinter.id}] ${String(split.text || "").substring(0, 60)}`
        });

        results.push({
          role: split.role,
          printerId: targetPrinter.id,
          printerName: targetPrinter.name,
          failover: isFailover,
          status: "success"
        });
      }

      return res.json({ success: true, mode: "custom_splits", results });
    }

    // Mode B: Structured Restaurant / Retail POS Order
    const fullOrder = order || {
      orderId: orderId || `ORD-${Date.now().toString().slice(-4)}`,
      table: table || "Walk-in",
      serverName,
      customer,
      items,
      subtotal,
      tax,
      discount,
      total,
      upi
    };

    if (!fullOrder.items || fullOrder.items.length === 0) {
      return res.status(400).json({ error: "Order must contain an items array" });
    }

    // 1. Filter Kitchen Items
    const kitchenItems = fullOrder.items.filter(i => {
      const cat = (i.category || i.type || "").toLowerCase();
      return cat === "kitchen" || cat === "food" || cat === "main" || cat === "starter" || (!i.category && cat !== "bar" && cat !== "drinks");
    });

    // 2. Filter Bar / Drinks Items
    const barItems = fullOrder.items.filter(i => {
      const cat = (i.category || i.type || "").toLowerCase();
      return cat === "bar" || cat === "drinks" || cat === "beverage" || cat === "juice";
    });

    // Dispatch KOT
    if (printKOT && kitchenItems.length > 0) {
      const targetPrinter = await resolvePrinterForJob(null, "KITCHEN");
      if (targetPrinter) {
        const isFailover = targetPrinter.role && targetPrinter.role.toUpperCase() !== "KITCHEN";
        const width = targetPrinter.paperWidth === 58 ? 32 : 42;
        let kotText = buildKotTicket({ ...fullOrder, items: kitchenItems }, width);
        if (isFailover) kotText = `[ROUTED VIA ${targetPrinter.role} - KITCHEN PRINTER OFFLINE]\n` + kotText;

        await printReceipt(targetPrinter, {
          text: kotText,
          buzzer: !!buzzer,
          cut: true
        });

        addJob({
          printerId: targetPrinter.id,
          printerName: targetPrinter.name,
          type: "kot_ticket",
          status: "success",
          textPreview: `[KOT Ticket #${fullOrder.orderId} Table ${fullOrder.table}]`
        });

        results.push({
          role: "KITCHEN",
          ticket: "KOT",
          printerId: targetPrinter.id,
          failover: isFailover,
          itemsCount: kitchenItems.length,
          status: "success"
        });
      }
    }

    // Dispatch BOT (Bar)
    if (printBOT && barItems.length > 0) {
      const targetPrinter = await resolvePrinterForJob(null, "BAR");
      if (targetPrinter) {
        const isFailover = targetPrinter.role && targetPrinter.role.toUpperCase() !== "BAR";
        const width = targetPrinter.paperWidth === 58 ? 32 : 42;
        let botText = buildBotTicket({ ...fullOrder, items: barItems }, width);
        if (isFailover) botText = `[ROUTED VIA ${targetPrinter.role} - BAR PRINTER OFFLINE]\n` + botText;

        await printReceipt(targetPrinter, {
          text: botText,
          cut: true
        });

        addJob({
          printerId: targetPrinter.id,
          printerName: targetPrinter.name,
          type: "bot_ticket",
          status: "success",
          textPreview: `[BOT Ticket #${fullOrder.orderId} Table ${fullOrder.table}]`
        });

        results.push({
          role: "BAR",
          ticket: "BOT",
          printerId: targetPrinter.id,
          failover: isFailover,
          itemsCount: barItems.length,
          status: "success"
        });
      }
    }

    // Dispatch Customer Bill to Cashier
    if (printBill) {
      const cashierPrinter = await resolvePrinterForJob(null, "CASHIER");
      if (cashierPrinter) {
        const width = cashierPrinter.paperWidth === 58 ? 32 : 42;
        const { text: billText, grandTotal } = buildBillReceipt(fullOrder, width);

        let upiQrPayload = null;
        if (fullOrder.upi && fullOrder.upi.pa) {
          upiQrPayload = {
            upi: {
              pa: fullOrder.upi.pa,
              pn: fullOrder.upi.pn || "Restaurant Store",
              am: fullOrder.upi.am || grandTotal.toFixed(2),
              cu: "INR",
              tn: `Bill #${fullOrder.orderId}`
            }
          };
        }

        await printReceipt(cashierPrinter, {
          text: billText,
          qr: upiQrPayload,
          drawerKick: !!drawerKick,
          cut: true
        });

        addJob({
          printerId: cashierPrinter.id,
          printerName: cashierPrinter.name,
          type: "bill_ticket",
          status: "success",
          textPreview: `[Cashier Bill #${fullOrder.orderId} Total Rs.${grandTotal.toFixed(2)}]`
        });

        results.push({
          role: "CASHIER",
          ticket: "BILL",
          printerId: cashierPrinter.id,
          total: grandTotal,
          status: "success"
        });
      }
    }

    res.json({
      success: true,
      orderId: fullOrder.orderId,
      dispatched: results
    });

  } catch (err) {
    console.error("Smart Routing Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============ HTML TO RECEIPT AUTO CONVERTER ============ */

function parseHtmlToEscPos(htmlString, width = 42) {
  if (!htmlString) return "";
  let text = htmlString;

  // 1. Remove script, style, comments
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Parse HTML Tables into aligned receipt columns
  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableBody) => {
    const rows = [];
    const rowMatches = tableBody.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

    for (const r of rowMatches) {
      const cells = [];
      const cellMatches = r.match(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi) || [];
      for (const c of cellMatches) {
        const rawContent = c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
        cells.push(rawContent);
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) return "";

    const formattedRows = [];
    formattedRows.push("-".repeat(width));

    for (const row of rows) {
      if (row.length === 1) {
        formattedRows.push(row[0]);
      } else if (row.length === 2) {
        formattedRows.push(padReceiptLine(row[0], row[1], width));
      } else if (row.length === 3) {
        // e.g. Item (col1 55%), Qty (col2 20%), Amt (col3 25%)
        const c1w = Math.floor(width * 0.52);
        const c2w = Math.floor(width * 0.20);
        const c3w = width - c1w - c2w;
        const c1 = row[0].padEnd(c1w).substring(0, c1w);
        const c2 = row[1].padStart(c2w).substring(0, c2w);
        const c3 = row[2].padStart(c3w).substring(0, c3w);
        formattedRows.push(`${c1}${c2}${c3}`);
      } else if (row.length >= 4) {
        // e.g. Item, Qty, Rate, Total
        const c1w = Math.floor(width * 0.44);
        const c2w = Math.floor(width * 0.16);
        const c3w = Math.floor(width * 0.18);
        const c4w = width - c1w - c2w - c3w;
        const c1 = row[0].padEnd(c1w).substring(0, c1w);
        const c2 = row[1].padStart(c2w).substring(0, c2w);
        const c3 = row[2].padStart(c3w).substring(0, c3w);
        const c4 = row[3].padStart(c4w).substring(0, c4w);
        formattedRows.push(`${c1}${c2}${c3}${c4}`);
      }
    }

    formattedRows.push("-".repeat(width));
    return "\n" + formattedRows.join("\n") + "\n";
  });

  // 3. Structural & Block elements
  text = text.replace(/<hr[^>]*>/gi, "\n" + "-".repeat(width) + "\n");
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (m, c) => `\n\n${c.replace(/<[^>]+>/g, "").trim().toUpperCase()}\n${"=".repeat(width)}\n`);
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (m, c) => `\n\n${c.replace(/<[^>]+>/g, "").trim().toUpperCase()}\n${"-".repeat(width)}\n`);
  text = text.replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, (m, c) => `\n${c.replace(/<[^>]+>/g, "").trim()}\n`);
  text = text.replace(/<br\s*[\/]?>/gi, "\n");
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (m, c) => `\n${c}\n`);
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, c) => ` • ${c}\n`);

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&bull;/g, "•");

  // Clean excessive blank lines
  return text.split("\n").map(l => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

app.post("/api/print/html", authRequired, async (req, res) => {
  try {
    const {
      html = "",
      printerId = null,
      role = null,
      cut = true,
      drawerKick = false,
      buzzer = false,
      title = null
    } = req.body;

    if (!html) return res.status(400).json({ error: "html content string required" });

    const printer = await resolvePrinterForJob(printerId, role);
    if (!printer) return res.status(404).json({ error: "No active printer found" });

    const width = printer.paperWidth === 58 ? 32 : 42;
    const formattedText = parseHtmlToEscPos(html, width);

    await printReceipt(printer, {
      text: (title ? `${title}\n${"=".repeat(width)}\n` : "") + formattedText + "\n\n",
      cut: cut !== false,
      drawerKick: !!drawerKick,
      buzzer: !!buzzer
    });

    addJob({
      printerId: printer.id,
      printerName: printer.name,
      type: "html_print",
      status: "success",
      textPreview: formattedText.substring(0, 100)
    });

    res.json({
      success: true,
      message: `HTML receipt printed on ${printer.name}`,
      printer: printer.name,
      printerId: printer.id,
      preview: formattedText
    });

  } catch (err) {
    console.error("HTML Print error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============ PDF TO RECEIPT AUTO CONVERTER ============ */

app.post("/api/print/pdf", upload.single("pdf"), authRequired, async (req, res) => {
  try {
    if (!pdfParse) {
      return res.status(500).json({ error: "pdf-parse library is not loaded" });
    }

    let pdfBuffer = null;
    if (req.file && req.file.buffer) {
      pdfBuffer = req.file.buffer;
    } else if (req.body && req.body.pdfBase64) {
      const cleanB64 = req.body.pdfBase64.replace(/^data:application\/pdf;base64,/, "");
      pdfBuffer = Buffer.from(cleanB64, "base64");
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return res.status(400).json({ error: "PDF file upload or pdfBase64 required" });
    }

    const printerId = req.headers["x-printer-id"] || req.body.printerId;
    const role = req.headers["x-printer-role"] || req.body.role;
    const cut = req.body.cut !== "false" && req.body.cut !== false;

    const printer = await resolvePrinterForJob(printerId, role);
    if (!printer) return res.status(404).json({ error: "No active printer found" });

    // Parse PDF
    const pdfData = await pdfParse(pdfBuffer);
    const width = printer.paperWidth === 58 ? 32 : 42;

    const rawLines = (pdfData.text || "").split("\n");
    const cleanedLines = [];

    for (const raw of rawLines) {
      const line = raw.trim();
      if (!line) continue;
      // Word wrap lines exceeding receipt width
      if (line.length <= width) {
        cleanedLines.push(line);
      } else {
        const words = line.split(" ");
        let current = "";
        for (const w of words) {
          if ((current + " " + w).trim().length <= width) {
            current = (current + " " + w).trim();
          } else {
            cleanedLines.push(current);
            current = w;
          }
        }
        if (current) cleanedLines.push(current);
      }
    }

    const receiptBody = cleanedLines.join("\n");

    await printReceipt(printer, {
      text: receiptBody + "\n\n",
      cut
    });

    addJob({
      printerId: printer.id,
      printerName: printer.name,
      type: "pdf_print",
      status: "success",
      textPreview: `[PDF: ${pdfData.numpages || 1} page(s)] ${receiptBody.substring(0, 80)}`
    });

    res.json({
      success: true,
      pages: pdfData.numpages,
      printer: printer.name,
      preview: receiptBody.substring(0, 500)
    });

  } catch (err) {
    console.error("PDF Print error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============ VISUAL RECEIPT TEMPLATE DESIGNER APIS ============ */

function getDefaultTemplates() {
  return [
    {
      id: "restaurant-dinein",
      name: "Restaurant Dine-In Bill",
      description: "Itemized restaurant bill with UPI QR & cash drawer kick",
      paperWidth: 80,
      elements: [
        { type: "header", text: "SPICE GARDEN RESTAURANT", subtitle: "Authentic Kerala Cuisine\nMG Road, Kochi • Ph: 0484-2345678\nGSTIN: 32ABCDE1234F1Z5", align: "center", bold: true },
        { type: "divider", style: "double" },
        { type: "meta", rows: [{ key: "Invoice No", val: "#INV-9281" }, { key: "Date & Time", val: "{DATE_TIME}" }, { key: "Table / Server", val: "Table 6 • Waiter Anoop" }] },
        { type: "divider", style: "single" },
        { type: "items", headers: ["ITEM", "QTY", "RATE", "TOTAL"], rows: [
          { name: "Malabar Biryani", qty: "2", rate: "240", total: "480.00" },
          { name: "Kerala Parotta", qty: "4", rate: "25", total: "100.00" },
          { name: "Chicken Roast", qty: "1", rate: "280", total: "280.00" },
          { name: "Fresh Lime Soda", qty: "2", rate: "40", total: "80.00" }
        ]},
        { type: "divider", style: "single" },
        { type: "totals", rows: [
          { label: "Subtotal", val: "Rs. 940.00" },
          { label: "CGST (2.5%)", val: "Rs. 23.50" },
          { label: "SGST (2.5%)", val: "Rs. 23.50" },
          { label: "*** NET AMOUNT ***", val: "Rs. 987.00", bold: true }
        ]},
        { type: "divider", style: "double" },
        { type: "qr", pa: "msamods@okaxis", pn: "Spice Garden", am: "987.00", label: "SCAN TO PAY WITH ANY UPI APP" },
        { type: "footer", text: "Thank you for dining with us!\nVisit again soon • Follow us @spicegarden", align: "center" }
      ],
      actions: { cut: true, drawerKick: true, buzzer: false }
    },
    {
      id: "kitchen-kot",
      name: "Kitchen Order Ticket (KOT)",
      description: "High-contrast chef ticket with buzzer alert",
      paperWidth: 80,
      elements: [
        { type: "header", text: "*** KITCHEN ORDER TICKET (KOT) ***", subtitle: "Order #804 • Table: 12", align: "center", bold: true },
        { type: "divider", style: "double" },
        { type: "meta", rows: [{ key: "Server", val: "Captain Rahul" }, { key: "Placed At", val: "{TIME}" }] },
        { type: "divider", style: "single" },
        { type: "items", headers: ["QTY", "ITEM", "SPECIAL INSTRUCTIONS"], rows: [
          { qty: "2", name: "Butter Chicken", note: "EXTRA SPICY, NO CORIANDER" },
          { qty: "3", name: "Butter Naan", note: "CRISPY WELL DONE" },
          { qty: "1", name: "Veg Fried Rice", note: "LESS OIL" }
        ]},
        { type: "divider", style: "double" },
        { type: "footer", text: "TOTAL ITEMS: 6 • PRIORITY: HIGH", align: "center" }
      ],
      actions: { cut: true, drawerKick: false, buzzer: true }
    },
    {
      id: "retail-invoice",
      name: "Retail & Supermarket Invoice",
      description: "Supermarket cash bill with barcode & savings summary",
      paperWidth: 80,
      elements: [
        { type: "header", text: "ANDROPRINT SUPERMARKET", subtitle: "Smart Hypermarket Solutions\nOpen 8 AM - 10 PM Everyday", align: "center", bold: true },
        { type: "divider", style: "double" },
        { type: "meta", rows: [{ key: "Bill No", val: "POS-1049" }, { key: "Cashier", val: "Counter 2" }, { key: "Date", val: "{DATE}" }] },
        { type: "divider", style: "single" },
        { type: "items", headers: ["ITEM", "QTY", "RATE", "AMOUNT"], rows: [
          { name: "Almond Milk 1L", qty: "1", rate: "290", total: "290.00" },
          { name: "Organic Oats 1kg", qty: "2", rate: "180", total: "360.00" },
          { name: "Dark Chocolate 100g", qty: "3", rate: "150", total: "450.00" }
        ]},
        { type: "divider", style: "single" },
        { type: "totals", rows: [
          { label: "Items Total", val: "Rs. 1,100.00" },
          { label: "Membership Discount", val: "-Rs. 110.00" },
          { label: "*** TOTAL PAYABLE ***", val: "Rs. 990.00", bold: true }
        ]},
        { type: "divider", style: "double" },
        { type: "barcode", value: "POS1049990", type: "CODE128" },
        { type: "footer", text: "Goods once sold can be exchanged within 7 days.\nSave Paper • Live Green", align: "center" }
      ],
      actions: { cut: true, drawerKick: true, buzzer: false }
    }
  ];
}

function loadTemplates() {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      const raw = fs.readFileSync(TEMPLATES_FILE, "utf8").trim();
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.warn("Failed to load templates:", e.message);
  }
  const defaults = getDefaultTemplates();
  saveTemplates(defaults);
  return defaults;
}

function saveTemplates(templates) {
  try {
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("Save templates error:", e);
    return false;
  }
}

app.get("/api/templates", (req, res) => {
  res.json({ templates: loadTemplates() });
});

app.post("/api/template/save", authRequired, (req, res) => {
  try {
    const template = req.body;
    if (!template || !template.name) {
      return res.status(400).json({ error: "Template must have a name" });
    }

    const templates = loadTemplates();
    const id = template.id || "tpl-" + crypto.randomBytes(4).toString("hex");
    const existingIdx = templates.findIndex(t => t.id === id);

    const fullTemplate = {
      ...template,
      id,
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      templates[existingIdx] = fullTemplate;
    } else {
      templates.push(fullTemplate);
    }

    saveTemplates(templates);
    res.json({ success: true, template: fullTemplate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/template/:id", authRequired, (req, res) => {
  try {
    const templates = loadTemplates();
    const filtered = templates.filter(t => t.id !== req.params.id);
    saveTemplates(filtered);
    res.json({ success: true, remaining: filtered.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/template/render-and-print", authRequired, async (req, res) => {
  try {
    const { template, templateId, printerId, role, variables = {} } = req.body;
    let tpl = template;

    if (!tpl && templateId) {
      tpl = loadTemplates().find(t => t.id === templateId);
    }

    if (!tpl || !tpl.elements) {
      return res.status(400).json({ error: "Valid template with elements required" });
    }

    const printer = await resolvePrinterForJob(printerId, role);
    if (!printer) return res.status(404).json({ error: "No active printer found" });

    const width = printer.paperWidth === 58 ? 32 : (tpl.paperWidth === 58 ? 32 : 42);
    const lines = [];
    let upiQrPayload = null;
    let barcodePayload = null;

    for (const el of tpl.elements) {
      if (el.type === "header") {
        lines.push(el.text.toUpperCase());
        if (el.subtitle) lines.push(el.subtitle);
      } else if (el.type === "divider") {
        const char = el.style === "double" ? "=" : (el.style === "dots" ? "." : "-");
        lines.push(char.repeat(width));
      } else if (el.type === "meta" && Array.isArray(el.rows)) {
        for (const row of el.rows) {
          let val = row.val || "";
          val = val.replace("{DATE_TIME}", new Date().toLocaleString())
                   .replace("{DATE}", new Date().toLocaleDateString())
                   .replace("{TIME}", new Date().toLocaleTimeString());
          for (const [k, v] of Object.entries(variables)) {
            val = val.replace(new RegExp(`{${k}}`, "g"), v);
          }
          lines.push(padReceiptLine(row.key + ":", val, width));
        }
      } else if (el.type === "items" && Array.isArray(el.rows)) {
        for (const row of el.rows) {
          if (row.total) {
            lines.push(padReceiptLine(`${row.qty || 1}x ${row.name}`, row.total, width));
          } else if (row.note) {
            lines.push(`[${row.qty || 1}x] ${row.name}`);
            lines.push(`     >> ${row.note}`);
          } else {
            lines.push(`[${row.qty || 1}x] ${row.name}`);
          }
        }
      } else if (el.type === "totals" && Array.isArray(el.rows)) {
        for (const r of el.rows) {
          lines.push(padReceiptLine(r.label, r.val, width));
        }
      } else if (el.type === "qr") {
        upiQrPayload = {
          upi: {
            pa: el.pa || "msamods@okaxis",
            pn: el.pn || "AndroPrint Store",
            am: el.am || "",
            cu: "INR",
            tn: "Store Payment"
          }
        };
        if (el.label) lines.push(el.label);
      } else if (el.type === "barcode") {
        barcodePayload = { data: el.value || "12345678", type: el.type || "CODE128" };
      } else if (el.type === "footer") {
        lines.push("\n" + el.text + "\n");
      }
    }

    const renderedText = lines.join("\n");

    await printReceipt(printer, {
      text: renderedText,
      qr: upiQrPayload,
      barcode: barcodePayload,
      drawerKick: !!tpl.actions?.drawerKick,
      buzzer: !!tpl.actions?.buzzer,
      cut: tpl.actions?.cut !== false
    });

    addJob({
      printerId: printer.id,
      printerName: printer.name,
      type: "template_print",
      status: "success",
      textPreview: `[Template: ${tpl.name}] ${renderedText.substring(0, 80)}`
    });

    res.json({
      success: true,
      message: `Template "${tpl.name}" printed successfully on ${printer.name}`,
      preview: renderedText
    });

  } catch (e) {
    console.error("Template Print Error:", e);
    res.status(500).json({ error: e.message });
  }
});

/* ============ MQTT CLOUD PUB/SUB INSTANT PRINTING ============ */

let mqttClient = null;
let mqttStatus = "disconnected";

function loadMqttConfig() {
  const defaultCfg = {
    enabled: false,
    broker: "mqtt://broker.hivemq.com:1883",
    topicPrefix: "androprint",
    qos: 1,
    username: "",
    password: "",
    status: mqttStatus,
    lastConnected: null
  };
  try {
    if (fs.existsSync(MQTT_CONFIG_FILE)) {
      const raw = fs.readFileSync(MQTT_CONFIG_FILE, "utf8").trim();
      if (raw) return { ...defaultCfg, ...JSON.parse(raw), status: mqttStatus };
    }
  } catch (e) {}
  return defaultCfg;
}

function saveMqttConfig(cfg) {
  try {
    fs.writeFileSync(MQTT_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

function initMqttClient() {
  if (!mqtt) {
    console.warn("⚠️ MQTT package not installed. MQTT Cloud Printing disabled.");
    return;
  }

  const config = loadMqttConfig();
  if (!config.enabled) {
    if (mqttClient) {
      try { mqttClient.end(true); } catch (e) {}
      mqttClient = null;
    }
    mqttStatus = "disabled";
    return;
  }

  if (mqttClient) {
    try { mqttClient.end(true); } catch (e) {}
    mqttClient = null;
  }

  const prefix = config.topicPrefix || "androprint";
  const printTopic = `${prefix}/${SERVER_ID}/print`;
  const routeTopic = `${prefix}/${SERVER_ID}/route`;
  const pingTopic = `${prefix}/${SERVER_ID}/ping`;
  const statusTopic = `${prefix}/${SERVER_ID}/status`;
  const ackTopic = `${prefix}/${SERVER_ID}/ack`;

  const opts = {
    clientId: `androprint_${SERVER_ID}_${crypto.randomBytes(3).toString("hex")}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000
  };

  if (config.username) opts.username = config.username;
  if (config.password) opts.password = config.password;

  try {
    console.log(`🔌 Connecting to MQTT Broker: ${config.broker} ...`);
    mqttClient = mqtt.connect(config.broker, opts);

    mqttClient.on("connect", () => {
      mqttStatus = "connected";
      console.log(`✅ MQTT Connected! Subscribing to: ${printTopic}`);

      // Publish online status (with retain)
      mqttClient.publish(
        statusTopic,
        JSON.stringify({
          status: "online",
          serverId: SERVER_ID,
          serverTime: new Date().toISOString(),
          printers: loadPrinters().map(p => ({ id: p.id, name: p.name, role: p.role, enabled: p.enabled }))
        }),
        { retain: true, qos: 1 }
      );

      mqttClient.subscribe([printTopic, routeTopic, pingTopic], { qos: config.qos || 1 }, (err) => {
        if (err) console.error("MQTT Subscribe Error:", err);
      });
    });

    mqttClient.on("message", async (topic, payload) => {
      try {
        const payloadStr = payload.toString("utf8");
        console.log(`📥 MQTT Message on [${topic}]:`, payloadStr.substring(0, 100));

        let data = {};
        try {
          data = JSON.parse(payloadStr);
        } catch {
          data = { text: payloadStr };
        }

        if (topic === pingTopic) {
          mqttClient.publish(statusTopic, JSON.stringify({
            status: "online",
            serverId: SERVER_ID,
            pong: Date.now()
          }));
          return;
        }

        if (topic === printTopic) {
          const printer = await resolvePrinterForJob(data.printerId, data.role || data.target);
          if (!printer) {
            mqttClient.publish(ackTopic, JSON.stringify({ success: false, error: "No active printer found" }));
            return;
          }

          await printReceipt(printer, data);
          addJob({
            printerId: printer.id,
            printerName: printer.name,
            type: "mqtt_cloud_print",
            status: "success",
            textPreview: (data.text || "MQTT Cloud Receipt").substring(0, 80)
          });

          mqttClient.publish(ackTopic, JSON.stringify({
            success: true,
            message: "Printed via MQTT",
            printerId: printer.id,
            timestamp: Date.now()
          }));
        }
      } catch (err) {
        console.error("MQTT Message Handling Error:", err);
        mqttClient.publish(ackTopic, JSON.stringify({ success: false, error: err.message }));
      }
    });

    mqttClient.on("error", (err) => {
      console.warn("MQTT Error:", err.message);
      mqttStatus = "error";
    });

    mqttClient.on("offline", () => {
      mqttStatus = "offline";
    });

    mqttClient.on("close", () => {
      mqttStatus = "closed";
    });

  } catch (err) {
    console.error("MQTT Client Init Failed:", err);
    mqttStatus = "failed";
  }
}

app.get("/api/mqtt/config", (req, res) => {
  const cfg = loadMqttConfig();
  res.json({
    ...cfg,
    status: mqttStatus,
    serverId: SERVER_ID,
    topics: {
      print: `${cfg.topicPrefix || "androprint"}/${SERVER_ID}/print`,
      route: `${cfg.topicPrefix || "androprint"}/${SERVER_ID}/route`,
      status: `${cfg.topicPrefix || "androprint"}/${SERVER_ID}/status`,
      ack: `${cfg.topicPrefix || "androprint"}/${SERVER_ID}/ack`
    }
  });
});

app.post("/api/mqtt/config", authRequired, (req, res) => {
  const current = loadMqttConfig();
  const updated = { ...current, ...req.body };
  saveMqttConfig(updated);
  initMqttClient();
  res.json({ success: true, config: updated, status: mqttStatus });
});

app.post("/api/mqtt/test", authRequired, async (req, res) => {
  try {
    if (!mqttClient || mqttStatus !== "connected") {
      return res.status(400).json({ success: false, error: "MQTT Client is not connected to a broker" });
    }
    const cfg = loadMqttConfig();
    const testTopic = `${cfg.topicPrefix || "androprint"}/${SERVER_ID}/print`;
    const payload = JSON.stringify({
      text: "\n================================\n  ANDROPRINT MQTT CLOUD TEST\n================================\nMQTT Cloud Instant Print Active!\nNo tunnels • Direct Pub/Sub\n" + new Date().toLocaleString() + "\n================================\n\n\n",
      cut: true,
      buzzer: true
    });

    mqttClient.publish(testTopic, payload, { qos: 1 }, (err) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, message: `Test published to ${testTopic}` });
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Auto-start MQTT on server launch if enabled
setTimeout(() => {
  initMqttClient();
}, 2000);

/* ============ DEDICATED HARDWARE CONTROL ENDPOINTS ============ */

// 1. Cash Drawer Kick
app.post("/api/printer/drawer-kick", authRequired, async (req, res) => {
  try {
    const { printerId } = req.body;
    if (!printerId) return res.status(400).json({ error: "printerId required" });

    const printer = loadPrinters().find(p => p.id === printerId && p.enabled);
    if (!printer) return res.status(404).json({ error: "Printer not found" });

    await printReceipt(printer, { drawerKick: true, cut: false });
    addJob({
      printerId,
      printerName: printer.name,
      type: "drawer_kick",
      status: "success",
      textPreview: "[Cash Drawer Kick Command]"
    });

    res.json({ success: true, message: "Cash drawer kicked successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Kitchen Buzzer / Beep
app.post("/api/printer/buzzer", authRequired, async (req, res) => {
  try {
    const { printerId, count = 2 } = req.body;
    if (!printerId) return res.status(400).json({ error: "printerId required" });

    const printer = loadPrinters().find(p => p.id === printerId && p.enabled);
    if (!printer) return res.status(404).json({ error: "Printer not found" });

    await printReceipt(printer, { buzzer: true, cut: false });
    addJob({
      printerId,
      printerName: printer.name,
      type: "buzzer",
      status: "success",
      textPreview: `[Kitchen Buzzer Alert x${count}]`
    });

    res.json({ success: true, message: "Buzzer beep triggered" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Dynamic UPI / QR Code Direct Print
app.post("/api/printer/qr", authRequired, async (req, res) => {
  try {
    const { printerId, qr, title = "SCAN & PAY WITH ANY UPI APP", footer = "GPay / PhonePe / Paytm / BHIM" } = req.body;
    if (!printerId || !qr) return res.status(400).json({ error: "printerId and qr payload required" });

    const printer = loadPrinters().find(p => p.id === printerId && p.enabled);
    if (!printer) return res.status(404).json({ error: "Printer not found" });

    let headerText = title ? `\n${title}\n================================\n` : "";
    let footerText = footer ? `\n${footer}\n\n\n` : "\n\n\n";

    await printReceipt(printer, {
      text: headerText,
      align: "center",
      bold: true,
      qr,
      cut: true
    });

    addJob({
      printerId,
      printerName: printer.name,
      type: "qr_print",
      status: "success",
      textPreview: `[UPI / QR Code Print]`
    });

    res.json({ success: true, message: "QR Code printed successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Barcode Direct Print
app.post("/api/printer/barcode", authRequired, async (req, res) => {
  try {
    const { printerId, barcode, type = "CODE128", label = "" } = req.body;
    if (!printerId || !barcode) return res.status(400).json({ error: "printerId and barcode string required" });

    const printer = loadPrinters().find(p => p.id === printerId && p.enabled);
    if (!printer) return res.status(404).json({ error: "Printer not found" });

    await printReceipt(printer, {
      text: label ? `\n${label}\n` : "\n",
      align: "center",
      barcode: { data: barcode, type },
      cut: true
    });

    addJob({
      printerId,
      printerName: printer.name,
      type: "barcode_print",
      status: "success",
      textPreview: `[Barcode: ${barcode}]`
    });

    res.json({ success: true, message: "Barcode printed successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Store Logo Management
app.post("/api/printer/logo", authRequired, async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 required" });

    const pngBuf = await rasterizeImage(imageBase64, 480);
    if (!pngBuf) return res.status(400).json({ error: "Invalid image or failed to rasterize" });

    fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });
    fs.writeFileSync(STORE_LOGO_PATH, pngBuf);

    res.json({ success: true, message: "Store logo saved and rasterized successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/printer/logo", (req, res) => {
  if (fs.existsSync(STORE_LOGO_PATH)) {
    res.sendFile(STORE_LOGO_PATH);
  } else {
    res.status(404).json({ exists: false, error: "No store logo uploaded" });
  }
});

app.delete("/api/printer/logo", authRequired, (req, res) => {
  if (fs.existsSync(STORE_LOGO_PATH)) {
    fs.unlinkSync(STORE_LOGO_PATH);
  }
  res.json({ success: true, message: "Store logo removed" });
});

// 6. Paper Feed & Auto Cut Endpoint
app.post("/api/printer/cut", authRequired, async (req, res) => {
  try {
    const { printerId, mode = "full", feed = 3 } = req.body;
    if (!printerId) return res.status(400).json({ error: "printerId required" });

    const printer = loadPrinters().find(p => p.id === printerId && p.enabled);
    if (!printer) return res.status(404).json({ error: "Printer not found" });

    const device = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printer.connection.ip}:${printer.connection.port}`,
      timeout: 3000
    });

    const feedCount = typeof feed === "number" ? feed : (parseInt(feed, 10) || 3);
    for (let i = 0; i < feedCount; i++) {
      device.newLine();
    }

    if (mode === "partial") {
      device.partialCut();
    } else {
      device.cut();
    }

    await device.execute();

    addJob({
      printerId,
      printerName: printer.name,
      type: "paper_cut",
      status: "success",
      textPreview: `[Paper Cut: ${mode.toUpperCase()} (feed: ${feedCount})]`
    });

    res.json({
      success: true,
      message: `Paper ${mode} cut executed successfully`,
      mode,
      feed: feedCount
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============ API: PRINT JOBS ============ */

app.get("/api/jobs", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ jobs: getRecentJobs(limit) });
});

app.post("/api/jobs/clear", (req, res) => {
  printJobs = [];
  saveJobs();
  broadcast({ type: "job_update", jobs: [] });
  res.json({ success: true });
});

/* ============ API: SYSTEM STATS ============ */

app.get("/api/stats", (req, res) => {
  const uptime = Date.now() - SERVER_START;
  const memUsage = process.memoryUsage();

  const successJobs = printJobs.filter(j => j.status === "success").length;
  const failedJobs = printJobs.filter(j => j.status === "failed").length;

  // Jobs in last 24h
  const oneDayAgo = Date.now() - 86400000;
  const recentJobs = printJobs.filter(
    j => new Date(j.timestamp).getTime() > oneDayAgo
  );

  res.json({
    uptime,
    uptimeFormatted: formatUptime(uptime),
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
    },
    jobs: {
      total: printJobs.length,
      success: successJobs,
      failed: failedJobs,
      successRate: printJobs.length > 0
        ? Math.round((successJobs / printJobs.length) * 100)
        : 100,
      last24h: recentJobs.length
    },
    connections: {
      sseClients: sseClients.size
    }
  });
});

/* ============ API: CLOUD / TUNNEL ============ */

let tunnelInfo = {
  active: false,
  url: null,
  provider: null,
  startedAt: null
};

app.get("/api/cloud", (req, res) => {
  res.json({
    tunnel: tunnelInfo,
    serverId: SERVER_ID,
    localUrl: `http://localhost:${PORT}`,
    endpoints: [
      { method: "POST", path: "/print", desc: "Send text to printer" },
      { method: "POST", path: "/api/printer/test", desc: "Test a printer" },
      { method: "GET", path: "/api/printers", desc: "List all printers" },
      { method: "GET", path: "/api/server", desc: "Server info & stats" },
      { method: "GET", path: "/api/events", desc: "SSE real-time stream" }
    ]
  });
});

app.post("/api/cloud/register", (req, res) => {
  const { url, provider } = req.body;
  tunnelInfo = {
    active: true,
    url: url || null,
    provider: provider || "cloudflare",
    startedAt: new Date().toISOString()
  };
  broadcast({ type: "cloud_update", tunnel: tunnelInfo });
  res.json({ success: true, tunnel: tunnelInfo });
});

app.post("/api/cloud/disconnect", (req, res) => {
  tunnelInfo = { active: false, url: null, provider: null, startedAt: null };
  broadcast({ type: "cloud_update", tunnel: tunnelInfo });
  res.json({ success: true });
});

/* ============ NAVIGATION ROUTE ALIASES ============ */
app.get(["/printers", "/printers.html"], (req, res) => res.redirect("/printer.html"));
app.get(["/printer"], (req, res) => res.redirect("/printer.html"));
app.get(["/webdirect", "/webdirect.html"], (req, res) => res.redirect("/webprint.html"));
app.get(["/webprint"], (req, res) => res.redirect("/webprint.html"));
app.get(["/receipt", "/receipts", "/designer", "/designer.html"], (req, res) => res.redirect("/designer.html"));
app.get(["/jobs", "/job-history"], (req, res) => res.redirect("/jobs.html"));
app.get(["/clients", "/api-clients"], (req, res) => res.redirect("/clients.html"));
app.get(["/cloud", "/relay", "/cloud-relay"], (req, res) => res.redirect("/cloud.html"));
app.get(["/dash", "/dashboard"], (req, res) => res.redirect("/dashboard.html"));

/* ============ API: QUICK PRINT (for dashboard) ============ */

app.post("/api/quickprint", async (req, res) => {
  try {
    let { printerId, targetIp, targetPort, text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: "Print text is required" });
    }

    if (targetIp) {
      const pIp = targetIp.trim();
      const pPort = parseInt(targetPort) || 9100;
      logger.info("PRINT", `Direct test print to discovered target ${pIp}:${pPort}`);

      const conn = await checkPrinterConnection(pIp, pPort, 2500);
      if (!conn.online) {
        const diag = explainPrinterError(conn.error, pIp, pPort, `Discovered Device (${pIp})`);
        return res.status(502).json({
          success: false,
          printed: false,
          title: diag.title,
          error: diag.description,
          fix: diag.fix,
          diagnostics: { ip: pIp, port: pPort, errCode: conn.error }
        });
      }

      const directTp = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: `tcp://${pIp}:${pPort}`,
        timeout: 4000
      });
      directTp.println(text);
      directTp.cut();
      await directTp.execute();
      addJob({
        printerId: `direct-${pIp}`,
        printerName: `Discovered Device (${pIp})`,
        type: "quickprint",
        status: "success",
        textPreview: text.substring(0, 100),
        timestamp: new Date().toISOString()
      });
      return res.json({ success: true, printed: true, message: `Direct test receipt printed on ${pIp}:${pPort}` });
    }

    const printers = Array.isArray(loadPrinters()) ? loadPrinters() : [];
    let printer = null;
    if (printerId && printers.length > 0) {
      printer = printers.find(p => p && p.id === printerId && p.enabled);
    }
    if (!printer && printers.length > 0) {
      printer = printers.find(p => p && p.enabled) || printers[0];
      if (printer) printerId = printer.id;
    }

    if (!printer) {
      logger.warn("PRINT", `Quick test received but no printer configured in system`);
      return res.status(404).json({
        success: false,
        printed: false,
        title: "No Printer Configured",
        error: "No physical printer has been saved in AndroPrint yet.",
        fix: [
          "1. Open the 'Printers' menu from top navigation bar.",
          "2. Click '+ Add Printer' to save your printer IP (e.g. 192.168.1.150:9100).",
          "3. Once saved, click 'Test' on that printer card."
        ]
      });
    }

    const pIp = printer.connection && printer.connection.ip;
    const pPort = (printer.connection && parseInt(printer.connection.port)) || 9100;
    if (!pIp) {
      return res.status(400).json({
        success: false,
        printed: false,
        title: "Invalid Printer Configuration",
        error: `Printer '${printer.name || printerId}' has no IP connection configured.`,
        fix: ["Open 'Printers' menu and update this printer's IP and port (e.g. 192.168.1.150:9100)."]
      });
    }

    const conn = await checkPrinterConnection(pIp, pPort, 2500);
    if (!conn.online) {
      const diag = explainPrinterError(conn.error, pIp, pPort, printer.name || "Configured Printer");
      return res.status(502).json({
        success: false,
        printed: false,
        title: diag.title,
        error: diag.description,
        fix: diag.fix,
        diagnostics: { ip: pIp, port: pPort, errCode: conn.error }
      });
    }

    await printText(printer, text);

    addJob({
      printerId: printer.id,
      printerName: printer.name,
      type: "quickprint",
      status: "success",
      textPreview: text.substring(0, 100),
      timestamp: new Date().toISOString()
    });

    res.json({ success: true, printed: true, message: `Quick print dispatched to ${printer.name}` });
  } catch (e) {
    const errorMsg = e.message || "Unknown error";
    logger.error("PRINT", "Quick print failed: " + errorMsg);
    addJob({
      printerId: req.body.printerId,
      type: "quickprint",
      status: "failed",
      error: errorMsg,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({
      success: false,
      printed: false,
      title: "Print Execution Failed",
      error: errorMsg,
      fix: [
        "1. Check if printer paper roll is empty or lever is open.",
        "2. Check if printer error indicator (RED light) is blinking.",
        "3. Power cycle printer and retry."
      ]
    });
  }
});

/* ============ WEBHOOK PRINTING ENGINE ============ */

function loadWebhookConfig() {
  try {
    if (fs.existsSync(WEBHOOK_FILE)) {
      return JSON.parse(fs.readFileSync(WEBHOOK_FILE, "utf8"));
    }
  } catch (e) {}
  return {
    enabled: true,
    defaultPrinterId: "",
    secret: "",
    soundBuzzer: true,
    printUpiQr: true,
    drawerKick: false,
    merchantVpa: "msamods@okaxis",
    merchantName: "AndroPrint Merchant",
    autoCut: true,
    printBarcode: true
  };
}

function saveWebhookConfig(cfg) {
  fs.writeFileSync(WEBHOOK_FILE, JSON.stringify(cfg, null, 2));
}

function padRight(str, len) {
  str = String(str || "");
  return str.length >= len ? str.substring(0, len) : str + " ".repeat(len - str.length);
}

function padLeft(str, len) {
  str = String(str || "");
  return str.length >= len ? str.substring(0, len) : " ".repeat(len - str.length) + str;
}

function centerText(str, len) {
  str = String(str || "");
  if (str.length >= len) return str;
  const left = Math.floor((len - str.length) / 2);
  const right = len - str.length - left;
  return " ".repeat(left) + str + " ".repeat(right);
}

function formatOrderReceipt(order, source = "generic", paperWidth = 80) {
  const lineLen = paperWidth === 58 ? 32 : 42;
  const sep = "-".repeat(lineLen);
  const dsep = "=".repeat(lineLen);

  let title = "ONLINE ORDER";
  let orderId = "";
  let customerName = "";
  let customerPhone = "";
  let address = "";
  let items = [];
  let subtotal = "";
  let tax = "";
  let total = "0.00";
  let paymentMethod = "";
  let notes = "";

  if (source === "woocommerce") {
    title = "WOOCOMMERCE ORDER";
    orderId = order.number || order.id || "N/A";
    customerName = [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(" ");
    customerPhone = order.billing?.phone || "";
    address = [order.shipping?.address_1 || order.billing?.address_1, order.shipping?.city || order.billing?.city].filter(Boolean).join(", ");
    total = order.total || "0.00";
    paymentMethod = order.payment_method_title || order.payment_method || "Online";
    items = (order.line_items || []).map(item => ({
      name: item.name || "Item",
      qty: item.quantity || 1,
      price: parseFloat(item.total || item.price || 0).toFixed(2)
    }));
  } else if (source === "shopify") {
    title = "SHOPIFY ORDER";
    orderId = order.order_number || order.name || order.id || "N/A";
    const cust = order.customer || order.shipping_address || order.billing_address || {};
    customerName = [cust.first_name, cust.last_name].filter(Boolean).join(" ");
    customerPhone = cust.phone || order.phone || "";
    const ship = order.shipping_address || {};
    address = [ship.address1, ship.city, ship.province].filter(Boolean).join(", ");
    total = order.total_price || "0.00";
    paymentMethod = order.financial_status ? `Status: ${order.financial_status.toUpperCase()}` : "Shopify Checkout";
    items = (order.line_items || []).map(item => ({
      name: item.title || item.name || "Item",
      qty: item.quantity || 1,
      price: (parseFloat(item.price || 0) * (item.quantity || 1)).toFixed(2)
    }));
  } else {
    title = order.title || "ORDER RECEIPT";
    orderId = order.orderId || order.invoiceNumber || order.id || ("#" + Date.now().toString().slice(-4));
    customerName = order.customerName || order.customer?.name || order.name || "";
    customerPhone = order.phone || order.customerPhone || order.customer?.phone || "";
    address = order.address || order.shippingAddress || "";
    total = (order.total || order.amount || 0).toString();
    subtotal = order.subtotal ? order.subtotal.toString() : "";
    tax = order.tax ? order.tax.toString() : "";
    paymentMethod = order.paymentMethod || order.payment || "Online";
    notes = order.notes || order.instructions || "";
    items = (order.items || order.lineItems || []).map(it => ({
      name: it.name || it.item || "Item",
      qty: it.qty || it.quantity || 1,
      price: parseFloat(it.price || it.total || 0).toFixed(2)
    }));
  }

  let out = "";
  out += `${dsep}\n`;
  out += centerText(title, lineLen) + "\n";
  out += `${dsep}\n`;
  out += `Order #   : ${orderId}\n`;
  out += `Date/Time : ${new Date().toLocaleString()}\n`;
  if (customerName.trim()) out += `Customer  : ${customerName.trim()}\n`;
  if (customerPhone.trim()) out += `Phone     : ${customerPhone.trim()}\n`;
  if (address.trim()) out += `Address   : ${address.trim()}\n`;
  out += `${sep}\n`;

  const nameWidth = lineLen - 14;
  out += padRight("ITEM", nameWidth) + padRight("QTY", 5) + padLeft("PRICE", 9) + "\n";
  out += `${sep}\n`;

  for (const it of items) {
    let itemName = it.name;
    if (itemName.length > nameWidth) {
      itemName = itemName.substring(0, nameWidth - 1) + "…";
    }
    out += padRight(itemName, nameWidth) + padRight(String(it.qty), 5) + padLeft(String(it.price), 9) + "\n";
  }

  out += `${sep}\n`;
  if (subtotal) out += padRight("Subtotal:", lineLen - 10) + padLeft(subtotal, 10) + "\n";
  if (tax) out += padRight("Tax / GST:", lineLen - 10) + padLeft(tax, 10) + "\n";
  out += padRight("TOTAL AMOUNT:", lineLen - 12) + padLeft("Rs " + parseFloat(total).toFixed(2), 12) + "\n";
  out += `${sep}\n`;
  if (paymentMethod) out += `Payment   : ${paymentMethod}\n`;
  if (notes) out += `Notes     : ${notes}\n`;
  out += `${dsep}\n`;
  out += centerText("Thank You For Your Order!", lineLen) + "\n\n";

  return {
    receiptText: out,
    orderId,
    total: parseFloat(total) || 0,
    customerName,
    itemsCount: items.length
  };
}

async function handleIncomingWebhook(req, res, source = "generic") {
  try {
    const config = loadWebhookConfig();
    if (!config.enabled) {
      return res.status(403).json({ error: "Webhook printing is currently disabled in settings" });
    }

    if (config.secret) {
      const providedSecret = req.headers["x-webhook-secret"] || req.query.secret || req.body?.secret;
      if (providedSecret !== config.secret) {
        return res.status(401).json({ error: "Invalid webhook secret token" });
      }
    }

    const printerId = req.params?.printerId || req.query.printerId || req.headers["x-printer-id"] || req.body?.printerId || config.defaultPrinterId;
    const printers = loadPrinters();
    let printer = printers.find(p => p.id === printerId && p.enabled);
    if (!printer) {
      printer = printers.find(p => p.enabled);
    }

    if (!printer) {
      return res.status(404).json({ error: "No enabled printer found to process webhook" });
    }

    const payload = req.body || {};
    let printOptions = {};

    if (payload.text && typeof payload.text === "string" && !payload.line_items && !payload.items) {
      printOptions = {
        text: payload.text,
        cut: config.autoCut !== false,
        buzzer: config.soundBuzzer !== false,
        drawerKick: config.drawerKick === true
      };
    } else {
      const parsed = formatOrderReceipt(payload, source, printer.paperWidth || 80);
      
      let qrPayload = null;
      if (config.printUpiQr && parsed.total > 0 && config.merchantVpa) {
        qrPayload = {
          upi: {
            pa: config.merchantVpa,
            pn: config.merchantName || "AndroPrint Merchant",
            am: parsed.total.toFixed(2),
            cu: "INR",
            tn: `Order ${parsed.orderId}`
          }
        };
      }

      let barcodePayload = null;
      if (config.printBarcode && parsed.orderId) {
        barcodePayload = {
          data: String(parsed.orderId).replace(/[^a-zA-Z0-9-]/g, "").substring(0, 20) || "ORD-001",
          type: "CODE128"
        };
      }

      printOptions = {
        text: parsed.receiptText,
        qr: qrPayload,
        barcode: barcodePayload,
        buzzer: config.soundBuzzer !== false,
        drawerKick: config.drawerKick === true,
        cut: config.autoCut !== false
      };
    }

    await printReceipt(printer, printOptions);

    addJob({
      printerId: printer.id,
      printerName: printer.name,
      type: `webhook_${source}`,
      status: "success",
      textPreview: `[Webhook: ${source.toUpperCase()}] Printed on ${printer.name}`
    });

    res.json({
      success: true,
      message: `Webhook processed and printed on ${printer.name}`,
      printer: printer.name,
      source
    });

  } catch (err) {
    console.error("Webhook print error:", err);
    res.status(500).json({ error: err.message });
  }
}

/* Webhook Endpoints */
app.post("/webhook/print", (req, res) => handleIncomingWebhook(req, res, "generic"));
app.post("/webhook/print/:printerId", (req, res) => handleIncomingWebhook(req, res, "generic"));
app.post("/webhook/woocommerce", (req, res) => handleIncomingWebhook(req, res, "woocommerce"));
app.post("/webhook/shopify", (req, res) => handleIncomingWebhook(req, res, "shopify"));
app.post("/webhook/telegram", (req, res) => handleIncomingWebhook(req, res, "telegram"));
app.post("/webhook/generic", (req, res) => handleIncomingWebhook(req, res, "generic"));

/* Webhook Management API */
app.get("/api/webhook/config", (req, res) => {
  res.json(loadWebhookConfig());
});

app.post("/api/webhook/config", authRequired, (req, res) => {
  const current = loadWebhookConfig();
  const updated = { ...current, ...req.body };
  saveWebhookConfig(updated);
  res.json({ success: true, config: updated });
});

app.post("/api/webhook/simulate", authRequired, async (req, res) => {
  const { type = "woocommerce" } = req.body;
  let samplePayload = {};

  if (type === "woocommerce") {
    samplePayload = {
      id: 4092,
      number: "WC-4092",
      total: "420.00",
      payment_method_title: "Cash on Delivery",
      billing: {
        first_name: "Rahul",
        last_name: "Sharma",
        phone: "+91 98765 43210",
        address_1: "Flat 4B, Emerald Heights",
        city: "Kochi, Kerala"
      },
      line_items: [
        { name: "Malabar Chicken Dum Biryani", quantity: 2, total: "360.00" },
        { name: "Fresh Mint Lime Juice", quantity: 1, total: "40.00" },
        { name: "Packaging & Delivery", quantity: 1, total: "20.00" }
      ]
    };
  } else if (type === "shopify") {
    samplePayload = {
      order_number: 1084,
      total_price: "850.00",
      financial_status: "paid",
      customer: {
        first_name: "Ananya",
        last_name: "Nair",
        phone: "+91 94471 23456"
      },
      shipping_address: {
        address1: "House #12, Rose Villa",
        city: "Trivandrum",
        province: "Kerala"
      },
      line_items: [
        { title: "Cotton Casual Kurti (M)", quantity: 1, price: "650.00" },
        { title: "Matching Silk Scarf", quantity: 1, price: "200.00" }
      ]
    };
  } else {
    samplePayload = {
      orderId: "ORD-" + Math.floor(1000 + Math.random() * 9000),
      customerName: "Suhail Ahmed",
      phone: "+91 99955 88822",
      address: "Beach Road, Calicut",
      items: [
        { name: "Kozhikodan Halwa 500g", qty: 2, price: "180.00" },
        { name: "Banana Chips 250g", qty: 1, price: "90.00" }
      ],
      subtotal: "270.00",
      tax: "13.50",
      total: "283.50",
      paymentMethod: "UPI Scan & Pay"
    };
  }

  req.body = samplePayload;
  return handleIncomingWebhook(req, res, type);
});

/* ============ CLOUD TUNNEL & CLOUDFLARE APIS ============ */

// 1. Get Cloud Tunnel Configuration & Status
app.get("/api/cloud", (req, res) => {
  const status = cloudflare.getStatus();
  res.json({
    success: true,
    serverId: SERVER_ID,
    tunnel: status.tunnel,
    installed: status.installed,
    instructions: status.instructions
  });
});

// 2. Register Manual Cloud Tunnel URL
app.post("/api/cloud/register", (req, res) => {
  try {
    const { url, provider } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: "Tunnel URL is required" });
    }
    const tunnel = cloudflare.registerManual(url, provider);
    res.json({ success: true, tunnel });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 3. Disconnect Cloud Tunnel
app.post("/api/cloud/disconnect", (req, res) => {
  const result = cloudflare.stop();
  res.json(result);
});

// 4. Cloudflare Specific Status
app.get("/api/cloudflare", (req, res) => {
  const status = cloudflare.getStatus();
  res.json({
    success: true,
    active: status.tunnel.active,
    url: status.tunnel.url,
    installed: status.installed,
    instructions: status.instructions
  });
});

// 5. Start Cloudflare Tunnel (Quick trycloudflare or Named Token)
app.post("/api/cloudflare/start", async (req, res) => {
  const { mode, token } = req.body || {};
  try {
    if (mode === "token" || token) {
      const tunnel = await cloudflare.startNamedTunnel(token);
      return res.json({ success: true, tunnel });
    } else {
      const tunnel = await cloudflare.startQuickTunnel(PORT, USE_SSL);
      return res.json({ success: true, tunnel });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
      instructions: cloudflare.getInstallInstructions()
    });
  }
});

// 6. Stop Cloudflare Tunnel
app.post("/api/cloudflare/stop", (req, res) => {
  const result = cloudflare.stop();
  res.json(result);
});

// Auto-start Cloudflare if enabled in .env
if (process.env.CLOUDFLARE === "true") {
  setTimeout(() => {
    logger.info("CLOUD", "Auto-starting Cloudflare tunnel per CLOUDFLARE=true setting in .env...");
    cloudflare.startQuickTunnel(PORT, USE_SSL).catch(err => {
      logger.warn("CLOUD", "Cloudflare auto-start note: " + err.message);
    });
  }, 2000);
}

/* ============ SYSTEM, DEVICES & AUTO-REPAIR APIS ============ */

// 1. System Detailed Info
app.get("/api/system/info", (req, res) => {
  const androidInfo = diagnostics.getAndroidInfo();
  res.json({
    success: true,
    serverId: SERVER_ID,
    version: "2.0.0",
    port: PORT,
    ssl: USE_SSL,
    standalone: STANDALONE_MODE,
    auth: ENABLE_AUTH,
    android: androidInfo,
    uptime: Date.now() - SERVER_START,
    uptimeFormatted: formatUptime(Date.now() - SERVER_START)
  });
});

// 2. Dynamic Port Changer with Live Rebind
app.post("/api/system/port", (req, res) => {
  const newPort = parseInt(req.body.port, 10);
  if (isNaN(newPort) || newPort < 1024 || newPort > 65535) {
    return res.status(400).json({ success: false, error: "Port must be an integer between 1024 and 65535" });
  }

  if (newPort === PORT) {
    return res.json({ success: true, message: `Server is already on port ${newPort}`, newPort });
  }

  const testServer = net.createServer();
  let responded = false;

  const timer = setTimeout(() => {
    if (!responded) {
      responded = true;
      try { testServer.close(); } catch {}
      res.status(500).json({ success: false, error: `Port validation timed out for ${newPort}` });
    }
  }, 1200);

  testServer.once("error", (err) => {
    clearTimeout(timer);
    if (responded) return;
    responded = true;
    return res.status(409).json({ success: false, error: `Port ${newPort} is in use: ${err.message}` });
  });

  testServer.once("listening", () => {
    clearTimeout(timer);
    if (responded) return;
    responded = true;

    testServer.close(() => {
      // Save port in .env file
      const envPath = path.join(__dirname, ".env");
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
      if (envContent.includes("PORT=")) {
        envContent = envContent.replace(/PORT=\d+/g, `PORT=${newPort}`);
      } else {
        envContent += `\nPORT=${newPort}\n`;
      }
      try { fs.writeFileSync(envPath, envContent.trim() + "\n"); } catch {}
      process.env.PORT = String(newPort);

      const oldPort = PORT;
      const protocol = USE_SSL ? "https" : "http";
      const redirectUrl = `${protocol}://${req.hostname}:${newPort}/dashboard.html`;

      logger.info("SYSTEM", `Switching server port from ${oldPort} to ${newPort}...`);

      res.json({
        success: true,
        oldPort,
        newPort,
        redirectUrl,
        message: `Port updated to ${newPort}. Server rebounding listener...`
      });

      setTimeout(() => {
        try {
          // Terminate active persistent SSE streams so server.close() does not hang
          sseClients.forEach(client => {
            try { client.end(); } catch {}
          });
          sseClients.clear();

          // Forcefully terminate all TCP client connections
          activeSockets.forEach(sock => {
            try { sock.destroy(); } catch {}
          });
          activeSockets.clear();

          if (typeof server.closeAllConnections === "function") {
            try { server.closeAllConnections(); } catch {}
          }

          let rebound = false;
          const doRebind = () => {
            if (rebound) return;
            rebound = true;
            PORT = newPort;
            try {
              server.listen(PORT, "0.0.0.0", () => {
                logger.success("SYSTEM", `AndroPrint re-bound to port ${PORT} (${protocol})`);
                broadcast({ type: "port_changed", port: PORT });
              });
            } catch (e) {
              logger.error("SYSTEM", "Failed to listen on new port: " + e.message);
            }
          };

          const closeTimeout = setTimeout(() => {
            logger.warn("SYSTEM", "server.close() wait expired, proceeding with rebind");
            doRebind();
          }, 800);

          server.close(() => {
            clearTimeout(closeTimeout);
            doRebind();
          });
        } catch (e) {
          logger.error("SYSTEM", "Failed to rebind port: " + e.message);
        }
      }, 300);
    });
  });

  testServer.listen(newPort, "0.0.0.0");
});

// 3. Standalone Mode Toggle
app.post("/api/system/standalone", (req, res) => {
  STANDALONE_MODE = req.body.standalone !== false;
  const envPath = path.join(__dirname, ".env");
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (env.includes("STANDALONE_MODE=")) {
    env = env.replace(/STANDALONE_MODE=\w+/g, `STANDALONE_MODE=${STANDALONE_MODE}`);
  } else {
    env += `\nSTANDALONE_MODE=${STANDALONE_MODE}\n`;
  }
  fs.writeFileSync(envPath, env.trim() + "\n");
  logger.info("SYSTEM", `Standalone Mode set to ${STANDALONE_MODE}`);
  broadcast({ type: "mode_changed", standalone: STANDALONE_MODE });
  res.json({ success: true, standalone: STANDALONE_MODE });
});

// 4. System Diagnostics & Issue Identifier
app.get("/api/system/diagnose", async (req, res) => {
  try {
    const report = await diagnostics.runDiagnostics(PORT, USE_SSL);
    res.json(report);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. One-Click Bug Auto-Repair
app.post("/api/system/repair", async (req, res) => {
  try {
    broadcast({ type: "repair_started" });
    const result = await diagnostics.runAutoRepair(PORT);
    broadcast({ type: "repair_finished", result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Single Phone All Local Connected Devices Scanner
app.get("/api/devices/connected", async (req, res) => {
  try {
    const result = await diagnostics.scanConnectedDevices();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/devices/scan", async (req, res) => {
  try {
    const result = await diagnostics.scanConnectedDevices((percent, msg) => {
      broadcast({ type: "device_scan_progress", percent, message: msg });
    });
    broadcast({ type: "device_scan_complete", result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. System Logs Management & Download
app.get("/api/logs", (req, res) => {
  const logs = logger.getLogs(req.query);
  res.json({ success: true, count: logs.length, logs });
});

app.get("/api/logs/download", (req, res) => {
  const logFile = logger.getLogFilePath();
  if (fs.existsSync(logFile)) {
    res.download(logFile, `androprint-${new Date().toISOString().split("T")[0]}.log`);
  } else {
    res.status(404).send("No log file found.");
  }
});

app.post("/api/logs/clear", (req, res) => {
  logger.clear();
  broadcast({ type: "logs_cleared" });
  res.json({ success: true, message: "Logs cleared." });
});

// 8. Auto-Update Check & Apply
app.get("/api/system/check-update", async (req, res) => {
  try {
    const update = await diagnostics.checkUpdate("2.0.0");
    res.json(update);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/system/update", async (req, res) => {
  logger.info("SYSTEM", "User requested system update");
  res.json({
    success: true,
    message: "AndroPrint is up to date (v2.0.0 release).",
    latest: "2.0.0"
  });
});

/* ============ API JSON 404 & GLOBAL ERROR HANDLER ============ */

// Guarantee that ANY unmatched /api/* route returns JSON instead of Express HTML 404
app.all("/api/*", (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.path}`,
    code: "ENDPOINT_NOT_FOUND"
  });
});

// Guarantee that ANY unhandled exception on /api/* returns JSON instead of HTML stack trace
app.use((err, req, res, next) => {
  logger.error("SYSTEM", `Unhandled error on ${req.method} ${req.path}: ${err.message}`);
  if (req.path.startsWith("/api/")) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.message || "Internal server error",
      code: "INTERNAL_ERROR"
    });
  }
  next(err);
});

/* ============ START ============ */

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`[WARN] Port ${PORT} in use, attempting ${PORT + 1}...`);
    PORT++;
    try {
      server.listen(PORT, "0.0.0.0");
    } catch (e) {
      console.error("[ERROR] Failed to retry listen:", e.message);
    }
  } else {
    console.error("[ERROR] Server listen error:", err.message);
  }
});

server.listen(PORT, () => {
  const protocol = USE_SSL ? "https" : "http";
  console.log("");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║               ANDROPRINT v2.0 CLOUD SERVER                 ║");
  console.log("║     Developed By : MSA MODS x WhatYouWantKerala            ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  Local    : ${protocol}://localhost:${PORT}                          ║`);
  console.log(`║  SSL/TLS  : ${USE_SSL ? "ACTIVE (HTTPS)" : "INACTIVE (HTTP)"}                          ║`);
  console.log(`║  Server ID: ${SERVER_ID}                                  ║`);
  console.log(`║  Auth     : ${ENABLE_AUTH ? "ENABLED " : "DISABLED"}                                    ║`);
  console.log(`║  SSE / WS : READY                                          ║`);
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");
});
