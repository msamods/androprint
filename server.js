/**************************************************
 * ANDROPRINT – FINAL SERVER.JS
 * Developed by MSAMODS
 **************************************************/

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const net = require("net");
const bodyParser = require("body-parser");
const { spawn } = require("child_process");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static("public"));

/* =================================================
   SERVER ID (persist once)
================================================= */
if (!process.env.SERVER_ID) {
  const sid = "srv-" + crypto.randomUUID().slice(0, 8);
  fs.appendFileSync(".env", `\nSERVER_ID=${sid}\n`);
  process.env.SERVER_ID = sid;
}

/* =================================================
   CLOUDFLARE TEMP TUNNEL
================================================= */
let cloudflareUrl = null;

function startCloudflare() {
  const cf = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`]);
  cf.stdout.on("data", d => {
    const m = d.toString().match(/https:\/\/[-\w]+\.trycloudflare\.com/);
    if (m && !cloudflareUrl) {
      cloudflareUrl = m[0];
      console.log("======================================");
      console.log("☁ CLOUDFLARE TEMP URL");
      console.log(cloudflareUrl);
      console.log("UI :", cloudflareUrl + "/dashboard.html");
      console.log("PRINT API :", cloudflareUrl + "/print");
      console.log("======================================");
    }
  });
}

/* =================================================
   PRINTER ENV HELPERS
================================================= */
const PRINTER_ENV = "printer.env";

function loadPrinters() {
  if (!fs.existsSync(PRINTER_ENV)) return {};
  const lines = fs.readFileSync(PRINTER_ENV, "utf8").split("\n");
  const printers = {};

  lines.forEach(l => {
    if (!l || l.startsWith("#")) return;
    const [k, v] = l.split("=");
    const m = k.match(/^PRINTER_(.*?)_(.*)$/);
    if (!m) return;
    const id = m[1];
    printers[id] ??= { id };
    printers[id][m[2].toLowerCase()] = v;
  });

  return printers;
}

function savePrinters(printers) {
  let out = ["TOTAL_PRINTERS=6"];
  Object.values(printers).forEach(p => {
    Object.entries(p).forEach(([k, v]) => {
      if (k === "id") return;
      out.push(`PRINTER_${p.id}_${k.toUpperCase()}=${v}`);
    });
    out.push("");
  });
  fs.writeFileSync(PRINTER_ENV, out.join("\n"));
}

/* =================================================
   RAW PRINT
================================================= */
function rawPrint(printer, text) {
  const socket = new net.Socket();
  socket.connect(printer.port, printer.ip, () => {
    socket.write(text + "\n\n");
    if (printer.cut === "true") socket.write("\x1D\x56\x00");
    socket.end();
  });
}

/* =================================================
   CLIENT AUTH (OPTIONAL)
================================================= */
const clients = []; // simple memory store for now

function auth(req, res, next) {
  if (process.env.ENABLE_CLIENT_AUTH !== "true") return next();

  const cid = req.headers["x-client-id"];
  const pin = req.headers["x-print-key"];
  if (!cid || !pin) return res.sendStatus(401);

  const ok = clients.find(c => c.id === cid && c.pin === pin);
  if (!ok) return res.sendStatus(403);

  next();
}

/* =================================================
   BASIC ROUTES
================================================= */
app.get("/", (_, res) => {
  res.send("AndroPrint Server Running");
});

/* =================================================
   DASHBOARD CONFIG
================================================= */
app.get("/api/config", (_, res) => {
  res.json({
    serverId: process.env.SERVER_ID,
    port: PORT,
    cloudflare: cloudflareUrl,
    defaultPrinter: process.env.DEFAULT_PRINTER || null,
    authEnabled: process.env.ENABLE_CLIENT_AUTH === "true"
  });
});

/* =================================================
   CLIENT MANAGEMENT
================================================= */
app.post("/api/client/create", (_, res) => {
  const id = "clt-" + crypto.randomUUID().slice(0, 6);
  const pin = Math.floor(100000 + Math.random() * 900000).toString();
  clients.push({ id, pin });

  console.log("NEW CLIENT REGISTERED");
  console.log("CLIENT ID:", id);
  console.log("PIN:", pin);

  res.json({ client_id: id, pin });
});

app.get("/api/clients", (_, res) => {
  res.json(clients);
});

/* =================================================
   PRINTER MANAGEMENT
================================================= */
app.get("/api/printers", (_, res) => {
  res.json(loadPrinters());
});

app.post("/api/printer/save", (req, res) => {
  const printers = loadPrinters();
  const { id, role } = req.body;

  const count = Object.values(printers).filter(p => p.role === role).length;
  if (!printers[id] && count >= 3)
    return res.status(400).json({ error: "Max 3 printers per role" });

  printers[id] = req.body;
  savePrinters(printers);
  res.json({ ok: true });
});

app.post("/api/printer/delete", (req, res) => {
  const printers = loadPrinters();
  delete printers[req.body.id];
  savePrinters(printers);
  res.json({ ok: true });
});

app.post("/api/printer/test", (req, res) => {
  const printers = loadPrinters();
  const p = printers[req.body.printerId];
  if (!p) return res.sendStatus(404);
  rawPrint(p, "TEST PRINT");
  res.json({ ok: true });
});

/* =================================================
   PRINT APIs
================================================= */
app.post("/print", auth, (req, res) => {
  const printers = loadPrinters();
  const pid = req.headers["x-printer-id"] || process.env.DEFAULT_PRINTER;
  const p = printers[pid];

  if (!p || p.status !== "enabled")
    return res.status(400).json({ error: "Printer unavailable" });

  rawPrint(p, req.body.text || "");
  res.json({ ok: true });
});

/* =================================================
   CLOUDFLARE INFO
================================================= */
app.get("/api/cloudflare", (_, res) => {
  res.json({
    url: cloudflareUrl,
    endpoints: [
      "/print",
      "/img",
      "/pdfdirect",
      "/pdftoimg",
      "/html"
    ]
  });
});

/* =================================================
   START SERVER
================================================= */
app.listen(PORT, () => {
  console.log("======================================");
  console.log("🖨 ANDROPRINT SERVER STARTED");
  console.log("SERVER ID :", process.env.SERVER_ID);
  console.log("PORT      :", PORT);
  console.log("======================================");

  if (process.env.CLOUDFLARE === "true") {
    startCloudflare();
  }
});
