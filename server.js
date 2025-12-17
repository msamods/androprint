/**
 * ANDROPRINT SERVER (FINAL)
 * Developed by MSAMODS
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const multer = require("multer");
const bodyParser = require("body-parser");
const { ThermalPrinter, PrinterTypes } = require("node-thermal-printer");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

/* --------------------------------------------------
   PATHS
-------------------------------------------------- */
const DATA_DIR = __dirname;
const PRINTER_FILE = path.join(DATA_DIR, "printers.json");
const CLIENT_FILE  = path.join(DATA_DIR, "clients.json");
const UPLOAD_DIR   = path.join(DATA_DIR, "uploads");

/* --------------------------------------------------
   PREP
-------------------------------------------------- */
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(PRINTER_FILE)) fs.writeFileSync(PRINTER_FILE, JSON.stringify({ printers: [] }, null, 2));
if (!fs.existsSync(CLIENT_FILE)) fs.writeFileSync(CLIENT_FILE, JSON.stringify({ clients: [] }, null, 2));

const upload = multer({ dest: UPLOAD_DIR });

app.use(bodyParser.json({ limit: "10mb" }));
app.use(express.static("public"));

/* --------------------------------------------------
   HELPERS
-------------------------------------------------- */
const readPrinters = () => JSON.parse(fs.readFileSync(PRINTER_FILE)).printers;
const savePrinters = (p) => fs.writeFileSync(PRINTER_FILE, JSON.stringify({ printers: p }, null, 2));

const readClients = () => JSON.parse(fs.readFileSync(CLIENT_FILE)).clients;

function authCheck(req, res) {
  if (process.env.ENABLE_CLIENT_AUTH !== "true") return true;

  const id = req.headers["x-client-id"];
  const key = req.headers["x-print-key"];

  const clients = readClients();
  const valid = clients.find(c => c.id === id && c.pin === key && c.enabled);

  if (!valid) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

async function getPrinter(printerId) {
  const printers = readPrinters();
  return printers.find(p => p.id === printerId && p.enabled);
}

/* --------------------------------------------------
   CLOUDFARE (TEMP)
-------------------------------------------------- */
let cloudflareURL = null;

if (process.env.CLOUDFLARE === "true") {
  try {
    const cf = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`]);
    cf.stdout.on("data", d => {
      const m = d.toString().match(/https:\/\/.*trycloudflare.com/);
      if (m) {
        cloudflareURL = m[0];
        console.log("\n☁ CLOUDFLARE TEMP URL");
        console.log(cloudflareURL);
      }
    });
  } catch (e) {
    console.log("Cloudflare failed:", e.message);
  }
}

/* --------------------------------------------------
   API – INFO
-------------------------------------------------- */
app.get("/api/config", (req, res) => {
  res.json({
    port: PORT,
    cloudflare: cloudflareURL,
    authEnabled: process.env.ENABLE_CLIENT_AUTH === "true"
  });
});

app.get("/api/cloudflare", (req, res) => {
  res.json({ url: cloudflareURL });
});

/* --------------------------------------------------
   API – PRINTER MANAGEMENT
-------------------------------------------------- */
app.get("/api/printers", (req, res) => {
  res.json({ printers: readPrinters() });
});

app.post("/api/printer/save", (req, res) => {
  const printers = readPrinters();
  const p = req.body;

  const cash = printers.filter(x => x.role === "CASHIER").length;
  const kit  = printers.filter(x => x.role === "KITCHEN").length;

  if (!printers.find(x => x.id === p.id)) {
    if (p.role === "CASHIER" && cash >= 3) return res.status(400).json({ error: "Max Cashier printers reached" });
    if (p.role === "KITCHEN" && kit >= 3) return res.status(400).json({ error: "Max Kitchen printers reached" });
    printers.push(p);
  } else {
    const i = printers.findIndex(x => x.id === p.id);
    printers[i] = p;
  }

  savePrinters(printers);
  res.json({ success: true });
});

app.post("/api/printer/delete", (req, res) => {
  const printers = readPrinters().filter(p => p.id !== req.body.id);
  savePrinters(printers);
  res.json({ success: true });
});

app.post("/api/printer/test", async (req, res) => {
  const printer = await getPrinter(req.body.id);
  if (!printer) return res.status(404).json({ error: "Printer not found" });

  try {
    const tp = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printer.connection.ip}:${printer.connection.port}`,
      characterSet: "PC437"
    });
    tp.println("=== ANDROPRINT TEST ===");
    tp.println(printer.name);
    tp.println(new Date().toLocaleString());
    tp.cut();
    await tp.execute();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* --------------------------------------------------
   PRINT – TEXT
-------------------------------------------------- */
app.post("/print", async (req, res) => {
  if (!authCheck(req, res)) return;

  const printer = await getPrinter(req.headers["x-printer-id"]);
  if (!printer) return res.status(404).json({ error: "Printer not found" });

  try {
    const tp = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printer.connection.ip}:${printer.connection.port}`,
      characterSet: "PC437"
    });
    tp.println(req.body.text || "");
    tp.cut();
    await tp.execute();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* --------------------------------------------------
   PRINT – IMAGE
-------------------------------------------------- */
app.post("/img", upload.single("file"), async (req, res) => {
  const printer = await getPrinter(req.headers["x-printer-id"]);
  if (!printer) return res.status(404).json({ error: "Printer not found" });

  try {
    const tp = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printer.connection.ip}:${printer.connection.port}`
    });
    await tp.printImage(req.file.path);
    tp.cut();
    await tp.execute();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* --------------------------------------------------
   PRINT – PDF → IMAGE
-------------------------------------------------- */
app.post("/pdftoimg", upload.single("file"), async (req, res) => {
  const printer = await getPrinter(req.headers["x-printer-id"]);
  if (!printer) return res.status(404).json({ error: "Printer not found" });

  const img = req.file.path + ".png";

  try {
    execSync(`pdftoppm -png -singlefile "${req.file.path}" "${req.file.path}"`);
    execSync(`convert "${img}" -resize 576 -colorspace Gray "${img}"`);

    const tp = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printer.connection.ip}:${printer.connection.port}`
    });

    await tp.printImage(img);
    tp.cut();
    await tp.execute();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* --------------------------------------------------
   START
-------------------------------------------------- */
app.listen(PORT, () => {
  console.log("\n🖨 ANDROPRINT SERVER STARTED");
  console.log("PORT :", PORT);
  if (cloudflareURL) console.log("CLOUDFLARE:", cloudflareURL);
});
