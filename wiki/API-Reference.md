# 🔌 AndroPrint REST API Reference

The **AndroPrint** REST API provides a standardized interface for interacting with ESC/POS thermal printers over local Wi-Fi, LAN, or via Cloud Tunnels (Cloudflare / Ngrok).

**Base URL**: `http://<server-ip>:3000` (or `https://<server-ip>:3000` when SSL is enabled)

---

## 📑 Table of Contents
1. [Authentication Headers](#-authentication-headers)
2. [Print Endpoints](#-print-endpoints)
   - [`POST /print`](#post-print)
   - [`POST /api/quickprint`](#post-apiquickprint)
3. [Printer Management](#-printer-management)
   - [`GET /api/printers`](#get-apiprinters)
   - [`POST /api/printer/save`](#post-apiprintersave)
   - [`POST /api/printer/delete`](#post-apiprinterdelete)
   - [`POST /api/printer/test`](#post-apiprintertest)
4. [Print Jobs & Queue](#-print-jobs--queue)
   - [`GET /api/jobs`](#get-apijobs)
   - [`POST /api/jobs/clear`](#post-apijobsclear)
5. [Client Management & Auth](#-client-management)
   - [`GET /api/clients`](#get-apiclients)
   - [`POST /api/client/create`](#post-apiclientcreate)
   - [`POST /api/client/toggle`](#post-apiclienttoggle)
   - [`POST /api/client/delete`](#post-apiclientdelete)
6. [System & Server Status](#-system--server-status)
   - [`GET /api/server`](#get-apiserver)
   - [`GET /api/stats`](#get-apistats)
   - [`GET /api/events` (SSE Streaming)](#get-apievents)
7. [Cloud Tunnels](#-cloud-tunnels)
   - [`GET /api/cloud`](#get-apicloud)
   - [`POST /api/cloud/register`](#post-apicloudregister)
   - [`POST /api/cloud/disconnect`](#post-apiclouddisconnect)

---

## 🔑 Authentication Headers

When `ENABLE_AUTH=true` is set in the environment / `.env`, all protected routes require the following HTTP headers:

| Header | Description | Required | Example |
|---|---|---|---|
| `x-client-id` | Registered Client Identifier | Yes (if auth enabled) | `pos_register_01` |
| `x-print-key` | Secret Print Key / PIN | Yes (if auth enabled) | `9842` |
| `x-printer-id` | Target Printer ID | Optional (can pass in body) | `printer_kitchen_1` |
| `Content-Type` | Request MIME Type | Yes (for POST requests) | `application/json` |

---

## 🖨️ Print Endpoints

### `POST /print`
Comprehensive receipt print dispatcher. Supports rich multimedia tickets with store logo rasterization, dynamic UPI QR codes, barcodes, cash drawer kick, and buzzer alerts.

#### Rich Request Body (JSON)
```json
{
  "printerId": "printer_main_01",
  "text": "      MY RESTAURANT\n--------------------------------\nToken #42 - Table 4\nChicken Biryani x 2    ₹360.00\nLime Juice x 1          ₹40.00\n--------------------------------\nTOTAL:                 ₹400.00\n--------------------------------\n  Thank You! Visit Again!\n\n",
  "align": "left",
  "bold": false,
  "drawerKick": true,
  "buzzer": true,
  "cut": true,
  "qr": {
    "upi": {
      "pa": "merchant@okaxis",
      "pn": "My Restaurant",
      "am": "400.00",
      "cu": "INR",
      "tn": "Order #42"
    }
  },
  "barcode": {
    "data": "ORD-2026-0042",
    "type": "CODE128"
  },
  "logo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

#### Payload Fields Reference
| Field | Type | Description |
|---|---|---|
| `printerId` | String | Target printer identifier (**Required**) |
| `text` | String | Plain or formatted UTF-8 receipt text |
| `align` | String | Text alignment: `"left"`, `"center"`, or `"right"` |
| `bold` | Boolean | Enable bold font style for text body |
| `underline` | Boolean | Enable underline font style |
| `drawerKick` | Boolean | Triggers RJ11/RJ12 cash drawer kick on print |
| `buzzer` / `beep` | Boolean | Triggers acoustic buzzer alert on thermal printer |
| `cut` | Boolean / String | Automatically feeds and cuts paper: `true`, `false`, or `"partial"` (default: `true`) |
| `cutMode` | String | Cut mode: `"full"` (clean cut) or `"partial"` (leaves a small center tab) |
| `feedLines` | Number | Blank lines to feed forward before cutting (default: `2`) |
| `qr` | Object / String | QR payload. Supports `{ upi: { pa, pn, am, cu, tn } }` for Google Pay / PhonePe / Paytm dynamic QR |
| `barcode` | Object / String | Barcode payload. String or `{ data: "...", type: "CODE128" }` |
| `logo` | String | Base64 PNG/JPG/WebP data URL or server file path |

#### Headers
```http
POST /print HTTP/1.1
Host: 127.0.0.1:3000
Content-Type: application/json
x-client-id: pos_register_01
x-print-key: 9842
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "message": "Printed successfully",
  "printerId": "printer_main_01"
}
```

---

### Hardware Control Endpoints

#### `POST /api/printer/drawer-kick`
Kicks open the cash drawer immediately without requiring a print ticket.
```json
{
  "printerId": "printer_main_01"
}
```

#### `POST /api/printer/buzzer`
Fires an audible beep alert on kitchen/bar printers.
```json
{
  "printerId": "printer_kitchen",
  "count": 2
}
```

#### `POST /api/printer/qr`
Prints a standalone dynamic UPI or text QR code with header/footer.
```json
{
  "printerId": "printer_main_01",
  "qr": {
    "upi": {
      "pa": "merchant@okaxis",
      "pn": "AndroPrint Store",
      "am": "250.00"
    }
  },
  "title": "SCAN & PAY WITH ANY UPI APP",
  "footer": "GPay • PhonePe • Paytm • BHIM"
}
```

#### `POST /api/printer/barcode`
Prints a standalone barcode with optional text label.
```json
{
  "printerId": "printer_main_01",
  "barcode": "INV-2026-0042",
  "type": "CODE128",
  "label": "INVOICE #0042"
}
```

#### `POST /api/printer/logo`
Uploads and saves a persistent store logo that prints at the top of receipts.
```json
{
  "imageBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

---

### `POST /api/quickprint`
Convenience print endpoint used by the web management dashboard.

#### Request Body
```json
{
  "printerId": "printer_main_01",
  "text": "Quick test bill output"
}
```

---

## ⚙️ Printer Management

### `GET /api/printers`
Fetches all configured thermal printers. Each printer automatically undergoes a live TCP socket health check to report real-time status.

#### Response (`200 OK`)
```json
[
  {
    "id": "printer_1710928392",
    "name": "Kitchen Thermal 80mm",
    "type": "network",
    "enabled": true,
    "paperWidth": 80,
    "connection": {
      "ip": "192.168.1.200",
      "port": 9100
    },
    "status": "online"
  },
  {
    "id": "printer_1710928410",
    "name": "Bar Counter 58mm",
    "type": "network",
    "enabled": true,
    "paperWidth": 58,
    "connection": {
      "ip": "192.168.1.201",
      "port": 9100
    },
    "status": "offline"
  }
]
```

---

### `POST /api/printer/save`
Creates a new printer or updates an existing printer configuration.

#### Request Body
```json
{
  "id": "printer_main_01",
  "name": "Billing Counter",
  "type": "network",
  "enabled": true,
  "paperWidth": 80,
  "connection": {
    "ip": "192.168.1.150",
    "port": 9100
  }
}
```

#### Response (`200 OK`)
```json
{
  "success": true
}
```

---

### `POST /api/printer/delete`
Removes a printer by its unique ID.

#### Request Body
```json
{
  "id": "printer_main_01"
}
```

---

### `POST /api/printer/test`
Sends a standardized ESC/POS diagnostic test receipt directly to the printer. Verifies IP connectivity, print head firing, and paper cutter.

#### Request Body
```json
{
  "printerId": "printer_main_01"
}
```

#### Response (`200 OK`)
```json
{
  "success": true,
  "printed": true
}
```

---

## ✂️ Hardware Control Endpoints

### `POST /api/printer/cut`
Feeds paper forward and fires the motorized auto cutter blade.

#### Request Body
```json
{
  "printerId": "printer_main_01",
  "mode": "full",
  "feed": 3
}
```

| Parameter | Type | Description | Default |
|---|---|---|---|
| `printerId` | String | Target printer ID (**Required**) | - |
| `mode` | String | `"full"` (clean cut) or `"partial"` (leaves small center tab) | `"full"` |
| `feed` | Number | Blank lines to feed before cutting | `3` |

#### Response (`200 OK`)
```json
{
  "success": true,
  "message": "Paper full cut executed successfully",
  "mode": "full",
  "feed": 3
}
```

---

### `POST /api/printer/drawer-kick`
Sends high-current 24V pulse to the RJ11/RJ12 drawer connector (Pin 2 / Pin 5) to pop open the cash register.

#### Request Body
```json
{
  "printerId": "printer_main_01"
}
```

---

### `POST /api/printer/buzzer`
Emits an acoustic beep tone for kitchen order tickets (KOT) or waiter alerts.

#### Request Body
```json
{
  "printerId": "printer_kitchen",
  "count": 2
}
```

---

### `POST /api/printer/qr`
Prints a high-contrast dynamic UPI payment QR code or web URL with automatic centering.

#### Request Body
```json
{
  "printerId": "printer_counter",
  "qr": {
    "upi": {
      "pa": "merchant@okaxis",
      "pn": "Restaurant Name",
      "am": "350.00",
      "cu": "INR",
      "tn": "Bill #892"
    }
  },
  "title": "SCAN & PAY VIA GPAY / PHONEPE",
  "footer": "Thank you!"
}
```

---

### `POST /api/printer/barcode`
Generates a crisp Code128 / EAN13 barcode ticket for parcel tracking, receipts, or queue tokens.

#### Request Body
```json
{
  "printerId": "printer_counter",
  "barcode": "ORD-92019-X",
  "type": "CODE128",
  "label": "ORDER #92019-X"
}
```

---

### `POST /api/printer/logo`
Uploads and saves a store branding logo (automatically rasterized to 1-bit monochrome ESC/POS format).

#### Request Body
```json
{
  "imageBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

---

## 📋 Print Jobs & Queue

### `GET /api/jobs`
Returns recent print job history (up to last 100 jobs) sorted in reverse chronological order.

#### Response (`200 OK`)
```json
[
  {
    "id": "job_1710929940123",
    "time": "10/20/2026, 2:00:15 AM",
    "printerId": "printer_main_01",
    "printerName": "Billing Counter",
    "type": "print",
    "status": "success",
    "textPreview": "MY RESTAURANT\nToken #42...",
    "clientId": "pos_register_01"
  }
]
```

---

### `POST /api/jobs/clear`
Clears the in-memory and persistent job history list.

#### Response (`200 OK`)
```json
{
  "success": true
}
```

---

## 👥 Client Management & Auth

### `GET /api/clients`
Returns list of registered API clients and keys.

#### Response (`200 OK`)
```json
[
  {
    "id": "pos_terminal_1",
    "name": "Front Counter iPad",
    "pin": "1234",
    "enabled": true,
    "createdAt": "2026-10-18T10:00:00Z"
  }
]
```

---

### `POST /api/client/create`
Registers a new API client key.

#### Request Body
```json
{
  "name": "WooCommerce Webhook",
  "pin": "8934"
}
```

---

### `POST /api/client/toggle`
Enables or disables an API client without deleting it.

#### Request Body
```json
{
  "id": "pos_terminal_1"
}
```

---

### `POST /api/client/delete`
Deletes an API client permanently.

#### Request Body
```json
{
  "id": "pos_terminal_1"
}
```

---

## 📊 System & Server Status

### `GET /api/server`
Provides essential server identity, local IP, uptime, and configuration.

#### Response (`200 OK`)
```json
{
  "serverId": "SRV-9F2B-A4C1",
  "version": "2.0.0",
  "authEnabled": false,
  "uptime": 3600,
  "uptimeHuman": "1h 0m",
  "localIp": "192.168.1.105",
  "port": 3000,
  "nodeVersion": "v18.20.8"
}
```

---

### `GET /api/stats`
Returns system performance metrics (RAM memory usage, CPU, total jobs printed).

#### Response (`200 OK`)
```json
{
  "uptime": "2 hours 15 mins",
  "memoryUsage": {
    "rss": "42 MB",
    "heapUsed": "18 MB",
    "heapTotal": "28 MB"
  },
  "totalJobs": 142,
  "successJobs": 139,
  "failedJobs": 3
}
```

---

### `GET /api/events` (Server-Sent Events)
Live real-time event stream (`text/event-stream`). Emits JSON events whenever printers update, new jobs complete, or errors occur.

```http
GET /api/events HTTP/1.1
Accept: text/event-stream
```

```
event: message
data: {"type": "job_added", "job": {"id": "job_123", "status": "success"}}

event: message
data: {"type": "printer_update"}
```

---

## 🌐 Code Integration Examples

### 1. JavaScript / Fetch (Web Browser & Node.js)
```javascript
const printBill = async () => {
  const response = await fetch("http://192.168.1.105:3000/print", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": "pos_01",
      "x-print-key": "1234"
    },
    body: JSON.stringify({
      printerId: "printer_kitchen",
      text: "ORDER #104\n2x Burger\n1x Fries\n\n\n"
    })
  });

  const result = await response.json();
  console.log("Print result:", result);
};
```

### 2. cURL (Command Line & Shell)
```bash
curl -X POST http://192.168.1.105:3000/print \
  -H "Content-Type: application/json" \
  -H "x-client-id: pos_01" \
  -H "x-print-key: 1234" \
  -d '{
    "printerId": "printer_kitchen",
    "text": "Hello Thermal World!\n\n"
  }'
```

### 3. Python (`requests`)
```python
import requests

url = "http://192.168.1.105:3000/print"
headers = {
    "Content-Type": "application/json",
    "x-client-id": "pos_01",
    "x-print-key": "1234"
}
payload = {
    "printerId": "printer_kitchen",
    "text": "INVOICE #9921\nSubtotal: $45.00\nTax: $4.50\nTOTAL: $49.50\n\n\n"
}

response = requests.post(url, json=payload, headers=headers)
print(response.json())
```

### 4. Dart / Flutter
```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

Future<void> sendPrintJob() async {
  final url = Uri.parse('http://192.168.1.105:3000/print');
  final response = await http.post(
    url,
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': 'pos_01',
      'x-print-key': '1234',
    },
    body: jsonEncode({
      'printerId': 'printer_kitchen',
      'text': 'FLUTTER THERMAL PRINT\nSuccess!\n\n\n',
    }),
  );

  print('Status: ${response.statusCode}, Body: ${response.body}');
}
```

---

## 🍳 Smart Multi-Printer Routing API

### `POST /api/print/route`
Intelligently separates restaurant/retail orders into Kitchen Order Tickets (KOT), Bar Order Tickets (BOT), and Cashier Customer Bills. If a target role printer is offline, it automatically fails over to the primary cashier printer with a high-visibility failover warning banner.

#### Request Body (Structured Order):
```json
{
  "orderId": "ORD-501",
  "table": "Table 12",
  "serverName": "Waiter Sam",
  "customer": "Rahul",
  "items": [
    { "name": "Butter Chicken", "qty": 1, "price": 280, "category": "kitchen", "notes": "Medium spicy" },
    { "name": "Garlic Naan", "qty": 2, "price": 40, "category": "kitchen" },
    { "name": "Virgin Mojito", "qty": 2, "price": 120, "category": "bar" }
  ],
  "subtotal": 480,
  "tax": 24,
  "total": 504,
  "upi": { "pa": "msamods@okaxis", "pn": "AndroPrint Diner" },
  "drawerKick": true,
  "buzzer": true,
  "printKOT": true,
  "printBOT": true,
  "printBill": true
}
```

---

## 🔍 Network Printer Auto-Discovery API

### `GET /api/printers/discover` / `POST /api/printers/discover`
Scans the local `/24` Wi-Fi/LAN subnet on Port 9100 using non-blocking parallel sockets and probes device models with ESC/POS `GS I 67`.

#### Response:
```json
{
  "success": true,
  "scannedSubnets": ["192.168.1"],
  "count": 1,
  "printers": [
    {
      "ip": "192.168.1.4",
      "port": 9100,
      "online": true,
      "model": "EPSON TM-T82II"
    }
  ]
}
```

---

## 📄 HTML & PDF Auto-Converter APIs

### `POST /api/print/html`
Parses HTML tags (`<table>`, `<tr>`, `<td>`, `<h1>`, `<hr>`, `<p>`, `<b>`) into formatted monospace ESC/POS lines and prints immediately.

```bash
curl -X POST "http://localhost:3000/api/print/html" \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<h1>STORE BILL</h1><hr><table><tr><td>Coffee</td><td>x2</td><td>$8.00</td></tr></table>",
    "role": "CASHIER",
    "cut": true
  }'
```

### `POST /api/print/pdf`
Accepts `multipart/form-data` with a PDF file or `{ "pdfBase64": "..." }`, extracts text and columnar layouts using `pdf-parse`, and formats it to 58mm/80mm roll width with auto-cut.

---

## ⚡ MQTT Cloud Pub/Sub Instant Printing

### Topics
* **Print Topic**: `androprint/{SERVER_ID}/print` — Publish JSON print jobs from any cloud server or web app.
* **Route Topic**: `androprint/{SERVER_ID}/route` — Publish multi-printer orders.
* **Status Topic**: `androprint/{SERVER_ID}/status` — Retained status heartbeat.
* **Ack Topic**: `androprint/{SERVER_ID}/ack` — Print acknowledgment.

---
*Developed By : MSA MODS x WhatYouWantKerala*
