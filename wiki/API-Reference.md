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
Prints text and ESC/POS formatted content to the specified printer. Auto-initializes UTF-8 encoding, multi-byte character tables, and paper cut.

#### Request Body (JSON)
```json
{
  "printerId": "printer_main_01",
  "text": "      MY RESTAURANT\n--------------------------------\nToken #42 - Table 4\nChicken Biryani x 2    ₹360.00\nLime Juice x 1          ₹40.00\n--------------------------------\nTOTAL:                 ₹400.00\n--------------------------------\n  Thank You! Visit Again!\n\n\n"
}
```

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

#### Error Responses
- `400 Bad Request`: `{"error": "printerId or text missing"}`
- `403 Forbidden`: `{"error": "Invalid Print Key"}` or `{"error": "Client not allowed"}`
- `404 Not Found`: `{"error": "Printer not found or disabled"}`
- `500 Internal Server Error`: `{"error": "connect ECONNREFUSED 192.168.1.100:9100"}`

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
*Developed By : MSA MODS x WhatYouWantKerala*
