# 🔑 Authentication & Security Guide

AndroPrint provides flexible authentication options suitable for both internal private networks and exposed public cloud tunnels.

---

## 1. Authentication Modes

Security mode is controlled via the `ENABLE_AUTH` variable in `.env`:

```env
# Set to 'true' to require API keys for printing and configuration
ENABLE_AUTH=true
```

| Mode | Behavior | Ideal Use Case |
|---|---|---|
| `ENABLE_AUTH=false` (Default) | All endpoints open; no headers required | Isolated LAN, Private Wi-Fi, Home/Office Test labs |
| `ENABLE_AUTH=true` | Requires valid `x-client-id` and `x-print-key` headers | Cloud Tunnels (Ngrok / Cloudflare), Public Webhooks |

---

## 2. API Key Headers

When enabled, send the following HTTP headers with each request:

```http
x-client-id: pos_terminal_01
x-print-key: 9842
```

### Authentication Failure Codes
- **403 Forbidden**:
  ```json
  {"error": "Invalid Print Key"}
  ```
- **403 Forbidden**:
  ```json
  {"error": "Client not allowed"}
  ```

---

## 3. Managing Clients via Dashboard

1. Navigate to `http://<server-ip>:3000/clients.html`
2. Click **Create New Client**
3. Enter Client Name (e.g. `WooCommerce Store`, `Front POS`)
4. Assign a 4-8 digit numeric PIN / Print Key
5. Toggle client activation status anytime with a single click

---
*Developed By : MSA MODS x WhatYouWantKerala*
