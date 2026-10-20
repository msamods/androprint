# 📦 AndroPrint Developer SDK

Official client library for integrating **AndroPrint** thermal printing into your web applications, POS software, backend servers, and mobile apps.

> **Developed By : [MSA MODS](https://github.com/msamods) × WhatYouWantKerala**  
> *Seamlessly print receipts, Kitchen KOTs, barcodes, dynamic UPI QR codes, and trigger cash drawers from any system in the world.*

---

## ⚡ Connection Modes: How It Works

AndroPrint supports two connection architectures:

```
[ Your POS / Cloud Web App ]
         │
         ├── Mode 1 (Cloud): ⚡ MQTT Pair Code (Zero Tunnels / No Port Forwarding)
         └── Mode 2 (Local): 🔑 LAN IP + Device PIN (Same Wi-Fi Router)
         │
         ▼
[ AndroPrint Phone APK / Windows EXE ]
         │ (ESC/POS Port 9100 / USB / Bluetooth)
         ▼
[ Thermal Receipt Printer ]
```

### 1. ⚡ Mode 1: Cloud Pub/Sub via Pair Code (Recommended)
* **Zero Configuration**: No Cloudflare tunnels, no Ngrok, and zero router port forwarding required.
* **How it connects**: When you open the AndroPrint APK on your phone or EXE on Windows, a **Pair Code / Server ID** (e.g. `srv-0f6fecb2`) is displayed on screen.
* Simply pass this `pairCode` into the SDK. Any print job published from your cloud server reaches the physical printer in **<50ms** across 4G/5G cellular data or Wi-Fi.

### 2. 🔑 Mode 2: Local Network (HTTP REST API)
* Ideal when the billing PC or tablet is on the same local Wi-Fi router as the printer.
* Connect directly via `http://192.168.1.100:3000` using the **Client ID** and **4-digit Device PIN** configured in the AndroPrint Dashboard (`clients.html`).

---

## 🚀 Quick Start (Node.js / JavaScript)

### 1. Installation
Include `sdk/androprint.js` in your project, or install via npm:
```bash
npm install mqtt # Required only if using Mode 1 (Cloud MQTT)
```

```javascript
const AndroPrint = require('./sdk/androprint.js');
```

---

### 2. Mode 1: Cloud Printing with Pair Code (No Tunnels!)

```javascript
const printer = new AndroPrint({
  mode: 'mqtt',
  pairCode: 'srv-0f6fecb2' // Shown on your AndroPrint APK / EXE screen
});

// Print instant receipt from any cloud server!
await printer.print({
  text: "ANDROPRINT CLOUD DINE-IN\nOrder #204\nTotal: Rs. 450.00\n",
  qr: {
    upi: {
      pa: "merchant@okaxis",
      am: "450.00",
      pn: "Spice Garden"
    }
  },
  drawerKick: true, // Pop cash register drawer
  cut: true         // Auto cut paper
});
```

---

### 3. Mode 2: Local Wi-Fi Printing (LAN IP + PIN)

```javascript
const printer = new AndroPrint({
  baseUrl: 'http://192.168.1.100:3000',
  clientId: 'pos_counter_1',
  printKey: '1234' // 4-digit Device PIN
});

await printer.print({
  text: "COUNTER 1 INVOICE\nItem: Coffee x2 - Rs. 100\n",
  cut: true
});
```

---

## 🍳 Multi-Printer Smart Routing (Restaurant / POS)

Dispatch an entire order payload in one call. AndroPrint automatically parses the items and routes them to their designated stations:
* 🍗 **Kitchen Items** (`category: "kitchen"`) -> Routes to `KITCHEN` printer as formatted KOT with large table number, cooking notes, buzzer beep, and partial cut.
* 🍹 **Bar / Drinks Items** (`category: "bar"`) -> Routes to `BAR` printer as BOT ticket.
* 🧾 **Customer Bill** -> Routes to `CASHIER` printer with full itemization, taxes, grand total, dynamic UPI payment QR, drawer kick, and full cut.
* **Failover Safe**: If the kitchen or bar printer goes offline, tickets automatically reroute to the cashier printer with a high-visibility failover warning banner.

```javascript
await printer.routeOrder({
  orderId: "ORD-9201",
  table: "Table 4",
  serverName: "Waiter Sam",
  customer: "Rahul",
  items: [
    { name: "Malabar Biryani", qty: 2, price: 220, category: "kitchen", notes: "Extra raita" },
    { name: "Kerala Parotta", qty: 4, price: 20, category: "kitchen" },
    { name: "Fresh Mint Mojito", qty: 2, price: 90, category: "bar" }
  ],
  subtotal: 700,
  tax: 35,
  total: 735,
  upi: { pa: "msamods@okaxis", pn: "AndroPrint Diner" },
  drawerKick: true,
  buzzer: true
});
```

---

## 📄 HTML & PDF-to-Receipt Auto-Converter

### 1. Print HTML
Directly print HTML tables and text:
```javascript
await printer.printHtml(`
  <h1>SPICE RETREAT</h1>
  <hr>
  <table>
    <tr><td>Chicken Tikka</td><td>1x</td><td>$14.00</td></tr>
    <tr><td>Butter Naan</td><td>2x</td><td>$6.00</td></tr>
  </table>
  <hr>
  <p><strong>Grand Total: $20.00</strong></p>
`, { role: 'CASHIER', cut: true });
```

### 2. Print PDF
Print PDF documents or invoices (base64 encoded):
```javascript
const fs = require('fs');
const pdfBase64 = fs.readFileSync('bill.pdf').toString('base64');

await printer.printPdf(pdfBase64, { cut: true });
```

---

## 🎨 Print Designer Templates

Print templates created in the Visual Receipt Designer ([`designer.html`](../public/designer.html)) with dynamic variables:

```javascript
await printer.printTemplate('restaurant-dinein', {
  ORDER_ID: 'ORD-501',
  TOTAL: '850.00',
  CUSTOMER: 'Akash'
});
```

---

## 🔌 Non-JavaScript Implementations

### Python
```python
import requests

url = "http://192.168.1.100:3000/print"
headers = {
    "Content-Type": "application/json",
    "x-client-id": "pos_01",
    "x-print-key": "1234"
}
payload = {
    "text": "PYTHON INVOICE #101\nTotal: Rs. 250.00\n",
    "drawerKick": True,
    "cut": True
}
res = requests.post(url, json=payload, headers=headers)
print(res.json())
```

### Flutter / Dart
```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

Future<void> sendPrint() async {
  final res = await http.post(
    Uri.parse('http://192.168.1.100:3000/print'),
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': 'pos_flutter',
      'x-print-key': '1234',
    },
    body: jsonEncode({
      'text': 'FLUTTER TICKET\nPrinted Successfully!\n',
      'cut': true,
    }),
  );
  print(res.body);
}
```

### PHP / Laravel / WordPress
```php
<?php
$curl = curl_init();
curl_setopt_array($curl, [
  CURLOPT_URL => "http://192.168.1.100:3000/print",
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => json_encode([
    "text" => "PHP PRINT JOB\nOrder #4092\n",
    "cut" => true
  ]),
  CURLOPT_HTTPHEADER => [
    "Content-Type: application/json",
    "x-client-id: pos_php",
    "x-print-key: 1234"
  ]
]);
$response = curl_exec($curl);
curl_close($curl);
echo $response;
?>
```

---

## 📚 SDK Methods Reference

| Method | Parameters | Description |
| :--- | :--- | :--- |
| `print(options)` | `options: Object` | Prints receipt text, logo, QR code, barcode with cut & drawer kick |
| `routeOrder(order)` | `order: Object` | Smart routing of order items to KITCHEN, BAR, and CASHIER |
| `printHtml(html, options)` | `html: String, options: Object` | Automatically parses HTML tables and tags into ESC/POS layout |
| `printPdf(pdfBase64, options)` | `pdfBase64: String, options: Object` | Parses PDF text and prints thermal receipt |
| `printTemplate(templateId, vars)` | `templateId: String, vars: Object` | Renders and prints visual designer templates |
| `kickDrawer(printerId)` | `printerId?: String` | Sends 24V pulse to open RJ11 cash drawer |
| `soundBuzzer(printerId, count)` | `printerId?: String, count?: Number` | Emits acoustic alarm beeps on kitchen thermal printer |
| `printUpi(printerId, upiDetails)` | `printerId: String, upiDetails: Object` | Prints high-contrast UPI QR code (`pa`, `am`, `pn`) |
| `getPrinters()` | *none* | Retrieves list of configured printers and real-time online status |
| `discoverPrinters(subnet)` | `subnet?: String` | Scans local subnet for Port 9100 ESC/POS printers |
| `getStatus()` | *none* | Retrieves server telemetry, uptime, and system status |

---

*Developed By : MSA MODS x WhatYouWantKerala*
