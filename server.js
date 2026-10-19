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

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const net = require("net");
const cors = require("cors");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { ThermalPrinter, PrinterTypes } = require("node-thermal-printer");

const app = express();
const PORT = process.env.PORT || 3000;
const ENABLE_AUTH = process.env.ENABLE_AUTH === "true";

// SSL / HTTPS Setup
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(__dirname, "server.key");
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, "server.cert");
const USE_SSL = (process.env.USE_SSL === "true" || (fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)));

let server;
if (USE_SSL) {
  try {
    const sslOptions = {
      key: fs.readFileSync(SSL_KEY_PATH),
      cert: fs.readFileSync(SSL_CERT_PATH)
    };
    server = https.createServer(sslOptions, app);
  } catch (err) {
    console.warn("⚠️ Failed to load SSL certs, falling back to HTTP:", err.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const DATA_DIR = __dirname;
const PRINTER_FILE = path.join(DATA_DIR, "printer.json");
const CLIENT_FILE = path.join(DATA_DIR, "clients.json");
const SERVER_ID_FILE = path.join(DATA_DIR, "server.id");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");

app.use(cors());
app.use(express.json({ limit: "10mb" }));
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
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ============ LOADERS ============ */

function loadPrinters() {
  return safeRead(PRINTER_FILE, { printers: [] }).printers;
}

function savePrinters(printers) {
  safeWrite(PRINTER_FILE, { printers });
}

function loadClients() {
  return safeRead(CLIENT_FILE, { clients: [] }).clients;
}

function saveClients(clients) {
  safeWrite(CLIENT_FILE, { clients });
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

/* ============ TCP CHECK ============ */

function isPrinterOnline(ip, port, timeout = 1500) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let online = false;

    socket.setTimeout(timeout);
    socket.connect(port, ip, () => {
      online = true;
      socket.destroy();
    });

    socket.on("error", () => {});
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => resolve(online));
  });
}

/* ============ PRINT TEXT HELPER ============ */

async function printText(printer, text) {
  // Support UTF-8 multilingual characters and fallback encoding
  const device = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${printer.connection.ip}:${printer.connection.port}`,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    options: {
      timeout: 5000
    }
  });

  // ESC/POS UTF-8 and multilingual codepage configuration
  // FS & (Select Chinese/Kanji/Asian mode) or ESC t (select character code table)
  try {
    device.raw(Buffer.from([0x1B, 0x40])); // ESC @ (Initialize)
    device.raw(Buffer.from([0x1C, 0x26])); // FS & (Select Kanji/Multilingual mode if supported)
    device.raw(Buffer.from([0x1B, 0x74, 0x00])); // ESC t 0 (Standard/PC437/UTF-8 base)
  } catch (e) {}

  device.println(text);
  device.cut();

  await device.execute();
}

/* ============ API: SERVER INFO (ENHANCED) ============ */

app.get("/api/server", async (req, res) => {
  const printers = loadPrinters();
  const clients = loadClients();

  const statuses = await Promise.all(
    printers.map(async p => ({
      id: p.id,
      online: await isPrinterOnline(p.connection.ip, p.connection.port)
    }))
  );

  const onlineCount = statuses.filter(s => s.online).length;
  const uptime = Date.now() - SERVER_START;

  res.json({
    serverId: SERVER_ID,
    auth: ENABLE_AUTH,
    version: "2.0.0",
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

app.post("/api/printer/save", authRequired, (req, res) => {
  const printers = loadPrinters();
  const p = req.body;

  const index = printers.findIndex(x => x.id === p.id);
  if (index >= 0) printers[index] = p;
  else printers.push(p);

  savePrinters(printers);
  broadcast({ type: "printer_update" });
  res.json({ success: true });
});

app.post("/api/printer/delete", authRequired, (req, res) => {
  const printers = loadPrinters().filter(p => p.id !== req.body.id);
  savePrinters(printers);
  broadcast({ type: "printer_update" });
  res.json({ success: true });
});

/* ============ REAL TEST PRINT ============ */

app.post("/api/printer/test", authRequired, async (req, res) => {
  try {
    const { printerId } = req.body;
    const printer = loadPrinters().find(p => p.id === printerId && p.enabled);

    if (!printer) {
      return res.status(404).json({ error: "Printer not found" });
    }

    const online = await isPrinterOnline(
      printer.connection.ip,
      printer.connection.port
    );

    if (!online) {
      addJob({
        printerId,
        printerName: printer.name,
        type: "test",
        status: "failed",
        error: "Printer offline"
      });
      return res.status(500).json({
        printed: false,
        error: "Printer offline"
      });
    }

    const tp = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printer.connection.ip}:${printer.connection.port}`,
      timeout: 3000
    });

    tp.println("════════════════════════════════");
    tp.println("       ANDROPRINT v2.0");
    tp.println("       TEST PRINT");
    tp.println("════════════════════════════════");
    tp.println(`Printer : ${printer.name}`);
    tp.println(`Server  : ${SERVER_ID}`);
    tp.println(`Time    : ${new Date().toLocaleString()}`);
    tp.println("════════════════════════════════");
    tp.println("  ✓ Connection OK");
    tp.println("  ✓ Print Engine OK");
    tp.println("  ✓ Cloud Ready");
    tp.println("════════════════════════════════");
    tp.cut();

    const ok = await tp.execute();
    if (!ok) throw new Error("Execute failed");

    addJob({
      printerId,
      printerName: printer.name,
      type: "test",
      status: "success"
    });

    res.json({ success: true, printed: true });

  } catch (e) {
    addJob({
      printerId: req.body.printerId,
      type: "test",
      status: "failed",
      error: e.message
    });
    res.status(500).json({
      success: false,
      printed: false,
      error: e.message
    });
  }
});

/* ============ PRINT ENDPOINT ============ */

app.post("/print", authRequired, async (req, res) => {
  try {
    const printerId =
      req.headers["x-printer-id"] || req.body.printerId;
    const text = req.body.text;

    if (!printerId || !text) {
      return res.status(400).json({
        error: "printerId or text missing"
      });
    }

    const printers = loadPrinters();
    const printer = printers.find(
      p => p.id === printerId && p.enabled
    );

    if (!printer) {
      addJob({
        printerId,
        type: "print",
        status: "failed",
        error: "Printer not found or disabled",
        textPreview: text.substring(0, 100)
      });
      return res.status(404).json({
        error: "Printer not found or disabled"
      });
    }

    await printText(printer, text);

    addJob({
      printerId,
      printerName: printer.name,
      type: "print",
      status: "success",
      textPreview: text.substring(0, 100),
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
    res.status(500).json({
      error: err.message
    });
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

/* ============ API: QUICK PRINT (for dashboard) ============ */

app.post("/api/quickprint", authRequired, async (req, res) => {
  try {
    const { printerId, text } = req.body;
    if (!printerId || !text) {
      return res.status(400).json({ error: "printerId and text required" });
    }

    const printer = loadPrinters().find(p => p.id === printerId && p.enabled);
    if (!printer) {
      return res.status(404).json({ error: "Printer not found" });
    }

    await printText(printer, text);

    addJob({
      printerId,
      printerName: printer.name,
      type: "quickprint",
      status: "success",
      textPreview: text.substring(0, 100)
    });

    res.json({ success: true });
  } catch (e) {
    addJob({
      printerId: req.body.printerId,
      type: "quickprint",
      status: "failed",
      error: e.message
    });
    res.status(500).json({ error: e.message });
  }
});

/* ============ START ============ */

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
