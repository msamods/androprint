require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const net = require("net");

const {
  ThermalPrinter,
  PrinterTypes
} = require("node-thermal-printer");

const app = express();
app.use(cors());
app.use(express.json());

/* ===============================
   ENV
================================ */

const PORT = process.env.PORT || 3000;
const ENABLE_AUTH = process.env.ENABLE_AUTH === "true";

/* ===============================
   PATHS
================================ */

const ROOT = path.join(__dirname, "..");
const CONFIG = path.join(ROOT, "config");

const PRINTER_FILE = path.join(CONFIG, "printer.json");
const CLIENT_FILE  = path.join(CONFIG, "clients.json");
const SERVER_ID_FILE = path.join(CONFIG, "server.id");

/* ===============================
   HELPERS
================================ */

function safeRead(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function loadPrinters() {
  const data = safeRead(PRINTER_FILE, { printers: [] });
  return data.printers || [];
}

function loadClients() {
  return safeRead(CLIENT_FILE, []);
}

function getServerId() {
  if (fs.existsSync(SERVER_ID_FILE)) {
    return fs.readFileSync(SERVER_ID_FILE, "utf8").trim();
  }
  const id = "srv-" + Math.random().toString(36).slice(2);
  fs.writeFileSync(SERVER_ID_FILE, id);
  return id;
}

const SERVER_ID = getServerId();

/* ===============================
   AUTH
================================ */

function authRequired(req, res, next) {
  if (!ENABLE_AUTH) return next();

  const id = req.headers["x-client-id"];
  const key = req.headers["x-print-key"];

  if (!id || !key) {
    return res.status(401).json({ error: "Client auth required" });
  }

  const ok = loadClients().find(
    c => c.id === id && c.pin === key && c.enabled
  );

  if (!ok) {
    return res.status(403).json({ error: "Invalid client" });
  }

  next();
}

/* ===============================
   PRINTER STATUS
================================ */

function isPrinterOnline(ip, port) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => resolve(false));
    socket.connect(port, ip);
  });
}

/* ===============================
   API : PRINTERS
================================ */

app.get("/api/printers", async (req, res) => {
  const printers = loadPrinters();

  const result = await Promise.all(
    printers.map(async p => ({
      ...p,
      online: await isPrinterOnline(
        p.connection.ip,
        p.connection.port
      )
    }))
  );

  res.json({ printers: result });
});

/* ===============================
   PRINT ROUTE (AUTO MODE)
================================ */

app.post("/print", authRequired, async (req, res) => {
  try {
    const printerId = req.headers["x-printer-id"];
    if (!printerId) {
      return res.status(400).json({ error: "x-printer-id missing" });
    }

    const printerCfg = loadPrinters().find(
      p =>
        p.enabled &&
        (
          p.id.toLowerCase() === printerId.toLowerCase() ||
          p.name?.toLowerCase() === printerId.toLowerCase()
        )
    );

    if (!printerCfg) {
      return res.status(404).json({ error: "Printer not found or disabled" });
    }

    const printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: `tcp://${printerCfg.connection.ip}:${printerCfg.connection.port}`,
      timeout: 15000
    });

    if (!(await printer.isPrinterConnected())) {
      return res.status(500).json({ error: "Printer offline" });
    }

    const body = req.body || {};

    /* ========= AUTO DETECT ========= */

    // 1️⃣ INVOICE JSON
    if (body.isInvoiceData?.isInvoice) {
      await printInvoice(printer, body);
      return res.json({ success: true, mode: "invoice" });
    }

    // 2️⃣ TEXT
    if (body.text) {
      printer.println(body.text);
      printer.cut();
      await printer.execute();
      return res.json({ success: true, mode: "text" });
    }

    return res.status(400).json({
      error: "Unsupported print payload"
    });

  } catch (err) {
    console.error("PRINT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ===============================
   INVOICE PRINTER
================================ */

async function printInvoice(printer, data) {
  const { company = [], master = {}, table = [] } = data;
  const comp = company[0] || {};

  printer.alignCenter();
  printer.bold(true);
  printer.println(comp.Name || "COMPANY");
  printer.bold(false);

  if (comp.Place) printer.println(comp.Place);
  if (comp.Ph) printer.println("Ph: " + comp.Ph);
  if (comp.gst) printer.println("GSTIN: " + comp.gst);

  printer.drawLine();

  printer.alignLeft();
  printer.println("Bill No : " + (master.BillNo ?? ""));
  printer.println(
    "Date    : " +
    (master.BillDate || "") +
    " " +
    (master.BillTime || "")
  );

  if (master.BillPartyName) {
    printer.println("Party   : " + master.BillPartyName);
  }

  printer.drawLine();

  table.forEach((it, i) => {
    printer.tableCustom([
      { text: String(i + 1), cols: 3 },
      { text: String(it.ItemNameTextField || "").substring(0, 18), cols: 18 },
      { text: String(it.qty || 0), cols: 4, align: "RIGHT" },
      {
        text: Number(it.total || 0).toFixed(2),
        cols: 7,
        align: "RIGHT"
      }
    ]);
  });

  printer.drawLine();
  printer.alignRight();
  printer.bold(true);
  printer.println(
    "NET TOTAL : " +
    Number(master.BillNetTotalField || 0).toFixed(2)
  );
  printer.bold(false);

  printer.newLine();
  printer.alignCenter();
  printer.println("Thank you!");
  printer.cut();

  await printer.execute();
}

/* ===============================
   START SERVER
================================ */

app.listen(PORT, () => {
  console.log("================================");
  console.log("ANDROPRINT SERVER RUNNING");
  console.log("Local URL :", `http://localhost:${PORT}`);
  console.log("Server ID :", SERVER_ID);
  console.log("Auth      :", ENABLE_AUTH ? "ENABLED" : "DISABLED");
  console.log("================================");
});
