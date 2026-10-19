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
const QRCode = require("qrcode");
const { Jimp } = require("jimp");
const { PNG } = require("pngjs");

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
const STORE_LOGO_PATH = path.join(DATA_DIR, "uploads", "store_logo.png");

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
    align = "left",
    bold = false,
    underline = false
  } = options;

  const device = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${printer.connection.ip}:${printer.connection.port}`,
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
  if (cut) {
    device.cut();
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
    const printerId = req.headers["x-printer-id"] || req.body.printerId;
    const {
      text = "",
      logo = null,
      qr = null,
      barcode = null,
      drawerKick = false,
      buzzer = false,
      beep = false,
      cut = true,
      align = "left",
      bold = false,
      underline = false
    } = req.body;

    if (!printerId) {
      return res.status(400).json({ error: "printerId missing" });
    }

    if (!text && !logo && !qr && !barcode && !drawerKick && !buzzer && !beep) {
      return res.status(400).json({
        error: "At least one print action (text, logo, qr, barcode, drawerKick, buzzer) required"
      });
    }

    const printers = loadPrinters();
    const printer = printers.find(p => p.id === printerId && p.enabled);

    if (!printer) {
      addJob({
        printerId,
        type: "print",
        status: "failed",
        error: "Printer not found or disabled",
        textPreview: (text || "Rich Receipt").substring(0, 100)
      });
      return res.status(404).json({ error: "Printer not found or disabled" });
    }

    await printReceipt(printer, {
      text,
      logo,
      qr,
      barcode,
      drawerKick,
      buzzer,
      beep,
      cut,
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
