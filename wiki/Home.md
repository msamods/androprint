# 🖨️ AndroPrint Wiki

Welcome to the **AndroPrint v2.0** official technical documentation and wiki.

> **Developed By : [MSA MODS](https://github.com/msamods) × WhatYouWantKerala**  
> *Transform any Android Phone, Windows Desktop, or Raspberry Pi into a high-speed, secure Cloud Thermal Print Server with zero drivers.*

---

## 📚 Wiki Directory

### 🔌 API Documentation
- [**API Reference**](API-Reference) — Complete REST API reference for all endpoints (`/print`, `/api/printers`, `/api/jobs`, `/api/server`, etc.)
- [**Webhook Printing Engine**](Webhook-Integration) — Automated receipt printing from WooCommerce, Shopify, Telegram bots & Custom Webhooks
- [**Authentication & Security**](Authentication) — API Client Keys, Header signatures (`x-client-id`, `x-print-key`), and `ENABLE_AUTH` mode
- [**Real-time Streaming (SSE)**](WebSocket-and-SSE) — Live Server-Sent Events stream (`/api/events`) for monitoring logs, jobs, and printer status

### 🖨️ Hardware & Integration
- [**ESC/POS Printing Guide**](Printing-Guide) — Network (TCP/IP) thermal printers, UTF-8 multilingual printing (Malayalam, Arabic, Hindi, etc.), paper widths (58mm/80mm), and cut commands
- [**Web Bluetooth & WebUSB**](Web-Bluetooth-and-USB) — Browser-based direct printing via BLE and USB OTG without installing any drivers

### 📦 Platforms & Deployment
- [**Android Native Agent**](Android-Native-Agent) — Background Foreground Service, Wakelock, APK build, and Termux:Boot configuration
- [**Windows Standalone Agent**](Windows-Standalone-Agent) — Portable 64-bit EXE deployment without Node.js

---

## ⚡ Quick Architecture Overview

```mermaid
graph TD
    Client[Web App / POS / Shopify / WooCommerce] -->|REST API & JSON| Gateway[AndroPrint Gateway Server:3000]
    Gateway -->|TCP ESC/POS Port 9100| LANPrinter[Network Thermal Printer]
    Gateway -->|Server-Sent Events| Dashboard[Real-time Web Dashboard]
    Browser[Chromium Browser] -->|Web Bluetooth / WebUSB| BLEPrinter[Portable Bluetooth/USB Printer]
    Cloud[Cloudflare Tunnel / Ngrok] -->|Public HTTPS URL| Gateway
```

---
*Developed By : MSA MODS x WhatYouWantKerala*
