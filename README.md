# 🖨️ AndroPrint v2.0 – Cloud & LAN ESC/POS Print Gateway

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue.svg?style=flat-square" alt="Version 2.0.0">
  <img src="https://img.shields.io/badge/platform-Termux%20%7C%20Linux%20%7C%20Windows%20%7C%20Docker-brightgreen.svg?style=flat-square" alt="Platforms">
  <img src="https://img.shields.io/badge/license-MIT-purple.svg?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/Cloud-Cloudflare%20%7C%20Ngrok%20%7C%20Localtunnel-cyan.svg?style=flat-square" alt="Cloud Support">
</p>

**AndroPrint** transforms any Android phone, Raspberry Pi, or mini-PC into an enterprise-grade **Cloud & LAN ESC/POS Thermal Print Server**. Connect POS systems, web shops, and mobile apps directly to physical thermal receipt printers without needing manufacturer drivers or expensive dedicated hardware.

---

## ✨ What's New in v2.0

- 🚀 **Real-Time SSE Event Streaming**: Live updates for print jobs, printer connectivity status, and cloud tunnel state via Server-Sent Events (`/api/events`).
- ☁️ **First-Class Cloud Connect**: Seamless integration with Cloudflare Tunnels, Ngrok, and Localtunnel with automatic URL registration and management interface.
- 🎨 **Next-Gen Glassmorphic UI**: Ultra-clean, modern dark mode dashboard with live telemetry, stat counters, quick-print widget, and responsive layout.
- 📜 **Full Job Queue & Audit History**: In-memory and persisted print history (`jobs.json`) with status inspection, error logging, and retry abilities.
- ⚡ **Direct Quick-Print Engine**: Instant raw text and receipt test engine right from the web dashboard.
- 👥 **Advanced Client & Token Access**: Point of Sale client generation, instant credential copying, header helpers, and granular enable/disable controls.

---

## 🏗️ Architecture

```
  ┌──────────────────────────────────────────────────────────────┐
  │                        Cloud Clients                         │
  │     (E-commerce, Shopify, WooCommerce, Remote POS, Web)       │
  └──────────────────────────────┬───────────────────────────────┘
                                 │ HTTPS / Webhook
                                 ▼
                     ┌───────────────────────┐
                     │ Cloudflare / Ngrok    │ (Optional Secure Tunnel)
                     └───────────┬───────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│               AndroPrint Server v2.0 (Node.js)                 │
│                                                                │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ Web Dashboard   │  │ SSE Realtime Hub │  │ Print Queue   │  │
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ Auth & Clients  │  │ Cloud Connector  │  │ ESC/POS Logic │  │
│  └─────────────────┘  └──────────────────┘  └───────────────┘  │
└────────────────────────────────┬───────────────────────────────┘
                                 │ RAW TCP Socket (Port 9100)
                                 ▼
         ┌───────────────────────────────────────────────┐
         │       LAN ESC/POS Thermal Printers            │
         │  (58mm / 80mm Network Receipts / Kitchen)     │
         └───────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Option 1: On Android via Termux

1. Install **Termux** from F-Droid.
2. Clone & run setup:
   ```bash
   git clone https://github.com/msamods/androprint.git
   cd androprint
   bash setup.sh
   node server.js
   ```

### Option 2: Linux / Windows / macOS

```bash
git clone https://github.com/msamods/androprint.git
cd androprint
npm install
npm start
```

### Accessing the Web Dashboard

Open your browser at `http://localhost:3000` (or `http://<phone-ip>:3000`):
- **Default Username:** `admin`
- **Default PIN:** `1231` (or your configured admin PIN)

---

## ☁️ Cloud Connect (Cloudflare Tunnels)

Expose your local Android or LAN printer server securely to the Internet in under 60 seconds without port forwarding:

1. Install `cloudflared` on your phone or host:
   ```bash
   pkg install cloudflared
   ```
2. Start the tunnel to AndroPrint:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Copy your generated `https://xxxx.trycloudflare.com` URL and register it in the **Cloud Connect** tab in the web UI or via API:
   ```bash
   curl -X POST http://localhost:3000/api/cloud/register \
     -H "Content-Type: application/json" \
     -d '{"url": "https://xxxx.trycloudflare.com", "provider": "cloudflare"}'
   ```

Now you can send print jobs from anywhere in the world!

---

## 🔌 API Reference

### Authentication Headers
For secure print and admin endpoints, pass:
```http
x-client-id: clt-admin
x-print-key: 123456
```

### Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/api/status` | Server health, version, uptime | No |
| `GET` | `/api/stats` | System telemetry, print counts, memory | No |
| `GET` | `/api/events` | Server-Sent Events (SSE) live stream | No |
| `GET` | `/api/printers` | List all configured printers & online state | Yes |
| `POST` | `/api/printer/save` | Add or update a printer configuration | Yes |
| `POST` | `/api/printer/delete` | Remove a printer by ID | Yes |
| `POST` | `/api/printer/test` | Dispatch a receipt test print | Yes |
| `POST` | `/api/print` | Send standard print payload (text/receipt) | Yes |
| `POST` | `/api/quickprint` | Send fast raw text directly to printer | No |
| `GET` | `/api/jobs` | Retrieve recent print job history | No |
| `POST` | `/api/jobs/clear` | Clear job history log | No |
| `GET` | `/api/clients` | List POS client credentials | No |
| `POST` | `/api/client/create` | Generate a new POS client credential | No |
| `POST` | `/api/client/toggle` | Enable or disable a client ID | No |
| `POST` | `/api/client/delete` | Delete a client ID | No |
| `GET` | `/api/cloud` | Get active cloud tunnel configuration | No |
| `POST` | `/api/cloud/register` | Register an active tunnel URL | No |
| `POST` | `/api/cloud/disconnect` | Clear active cloud tunnel | No |

### Example: Quick Print

```bash
curl -X POST http://localhost:3000/api/quickprint \
  -H "Content-Type: application/json" \
  -d '{
    "printerId": "cashier-1",
    "text": "Hello from Cloud Print!\nTable 4 - Order #1024\n"
  }'
```

---

## 📁 Project Structure

```
androprint/
├── public/                 # Glassmorphic Web Dashboard
│   ├── index.html          # Modern login screen
│   ├── dashboard.html      # Live telemetry & operations dashboard
│   ├── printer.html        # Printer configuration & management
│   ├── clients.html        # API credentials & client keys
│   ├── cloud.html          # Cloudflare & remote tunnel hub
│   └── jobs.html           # Print jobs history & queue log
├── server.js               # Core Express & ESC/POS socket gateway
├── setup.sh                # Automated Termux environment setup script
├── printer.json            # Persisted printer network configurations
├── clients.json            # Persisted API clients & access keys
├── jobs.json               # Persisted print logs & audit trail
├── package.json            # Node.js dependencies & manifest
└── README.md               # Documentation
```

---

## 🔒 Security Best Practices

- Always update the default admin credentials and client keys before deploying into production.
- Use Cloudflare Access or token-based authentication on tunnels exposed publicly.
- Ensure the Android device running the server is kept connected to a continuous power supply with battery protection or background wakelock enabled (`termux-wake-lock`).

---

## 📄 License

MIT © [msamods](https://github.com/msamods)
