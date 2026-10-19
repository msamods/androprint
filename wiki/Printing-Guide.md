# 🖨️ ESC/POS Thermal Printing Guide

AndroPrint supports standard ESC/POS protocol thermal receipt printers connected over TCP/IP LAN, Wi-Fi, or direct USB/Bluetooth.

---

## 1. Supported Paper Widths
- **58mm (2-inch)**: ~32 characters per line (Monospace)
- **80mm (3-inch)**: ~48 characters per line (Monospace)

---

## 2. Multilingual & UTF-8 Character Support
AndroPrint automatically passes UTF-8 encoded byte buffers to the printer and configures standard ESC/POS code pages:

- **English / Latin**: Standard ASCII PC437
- **Malayalam (മലയാളം)**: UTF-8 Multi-byte string rendering
- **Arabic / Persian**: Right-to-Left UTF-8 text
- **Hindi / Devanagari**: Unicode code tables
- **Chinese / Japanese / Korean**: Double-byte Kanji/Asian mode (`FS &`)

---

## 3. Formatting & ESC/POS Commands
When printing via `POST /print`, you can include standard formatting escape sequences or plain text with newlines:

```
================================
         RECEIPT TITLE
================================
Date: 2026-10-20       Time: 14:30
--------------------------------
Item 1                 $10.00
Item 2                 $25.50
--------------------------------
TOTAL                  $35.50
================================
  Thank You For Your Business!
```

---
*Developed By : MSA MODS x WhatYouWantKerala*
