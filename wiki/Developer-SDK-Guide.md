# 📦 AndroPrint Developer SDK & Client Integration

The **AndroPrint Client SDK** allows developers to integrate Android-based and Windows-based ESC/POS thermal printing into external web applications, cloud backends, point-of-sale (POS) systems, and mobile applications.

> **Source Code**: [`sdk/androprint.js`](https://github.com/msamods/androprint/blob/main/sdk/androprint.js)  
> **Developed By : [MSA MODS](https://github.com/msamods) × WhatYouWantKerala**

---

## ⚡ Connection Modes: How It Works

AndroPrint provides two connection topologies to connect external applications with physical thermal printers:

```
[ Developer's Cloud Web App / POS ]
                 │
                 ├── Mode 1: ⚡ MQTT Cloud Pub/Sub (Zero Tunnels / Pair Code)
                 └── Mode 2: 🔑 Local Wi-Fi REST API (Same LAN IP + PIN)
                 │
                 ▼
      [ AndroPrint APK / EXE ]
                 │ (Port 9100 / Bluetooth / USB)
                 ▼
      [ ESC/POS Thermal Printer ]
```

### 1. ⚡ Mode 1: Cloud Pub/Sub via Pair Code (MQTT)
* **Zero Tunnels / No Port Forwarding**: The AndroPrint server initiates an outbound socket to an MQTT broker.
* **How it connects**:
  1. Open AndroPrint on Android or Windows.
  2. Note your **Server ID / Pair Code** (e.g. `srv-0f6fecb2`).
  3. Initialize the SDK with this `pairCode`.
  4. The SDK publishes print payloads to `androprint/{pairCode}/print`. The printer prints immediately with **<50ms latency**, even behind cellular 4G/5G or restrictive Wi-Fi NAT firewalls!

### 2. 🔑 Mode 2: Local Network REST API (Same Wi-Fi)
* Connect directly via `http://<device-ip>:3000/print`.
* Protected by HTTP headers:
  - `x-client-id`: Client Name (from `clients.html`)
  - `x-print-key`: 4-Digit Device PIN

---

## 🚀 Node.js / JavaScript Example

```javascript
const AndroPrint = require('./sdk/androprint.js');

// Initialize with Pair Code (Cloud MQTT)
const printer = new AndroPrint({
  mode: 'mqtt',
  pairCode: 'srv-0f6fecb2'
});

// Or initialize for local Wi-Fi
/*
const printer = new AndroPrint({
  baseUrl: 'http://192.168.1.100:3000',
  clientId: 'pos_counter_1',
  printKey: '1234'
});
*/

async function printReceipt() {
  await printer.print({
    text: "SPICE GARDEN RESTAURANT\nOrder #204\nTotal: Rs. 450.00\n",
    qr: {
      upi: {
        pa: "msamods@okaxis",
        am: "450.00",
        pn: "Spice Garden"
      }
    },
    drawerKick: true,
    cut: true
  });
}

printReceipt();
```

---

## 🍳 Restaurant Multi-Printer Smart Routing

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

## 📄 HTML & PDF Conversion

```javascript
// HTML to Receipt
await printer.printHtml(`
  <h1>TAX INVOICE</h1>
  <hr>
  <table>
    <tr><td>Product A</td><td>x1</td><td>$10.00</td></tr>
    <tr><td>Product B</td><td>x2</td><td>$20.00</td></tr>
  </table>
`, { role: 'CASHIER', cut: true });

// PDF to Receipt
await printer.printPdf(base64PdfString, { cut: true });
```

---

## 🌐 Other Languages (Python, Dart/Flutter, PHP)

### Python
```python
import requests

res = requests.post(
    "http://192.168.1.100:3000/print",
    headers={"x-client-id": "pos_01", "x-print-key": "1234"},
    json={"text": "Hello Thermal Printer!\n", "cut": True}
)
print(res.json())
```

### Dart / Flutter
```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

final res = await http.post(
  Uri.parse('http://192.168.1.100:3000/print'),
  headers: {
    'Content-Type': 'application/json',
    'x-client-id': 'pos_flutter',
    'x-print-key': '1234',
  },
  body: jsonEncode({'text': 'FLUTTER RECEIPT\n', 'cut': true}),
);
```

---
*Developed By : MSA MODS x WhatYouWantKerala*
