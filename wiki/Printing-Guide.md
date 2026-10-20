# 🖨️ ESC/POS Thermal Printing Guide

AndroPrint supports standard ESC/POS protocol thermal receipt printers connected over TCP/IP LAN, Wi-Fi, or direct USB/Bluetooth.

---

## 1. Supported Paper Widths
- **58mm (2-inch)**: ~32 characters per line (Monospace / Font A), or 42 characters (Font B). Usually manual tear bar.
- **80mm (3-inch)**: ~48 characters per line (Monospace / Font A), or 64 characters (Font B). Usually equipped with motorized Auto Cutter.

---

## 2. ✂️ Auto Cut Deep-Dive & Hardware Details

### What is Auto Cut?
Most commercial 80mm POS printers (Epson, TVS, Star, Citizen, Bixolon, Munbyn, Xprinter) are equipped with an internal motorized mechanical blade (guillotine or rotary cutter) designed to automatically cut the thermal paper roll at the end of each printed ticket or receipt.

### 📐 Mechanical Printhead-to-Cutter Offset
In thermal printers, the thermal burn printhead is physically positioned **15mm to 25mm above** the cutter blade. 
If an auto cut command is executed immediately after printing the last line of text without feeding paper forward:
* ⚠️ **Issue**: The bottom lines of the receipt (such as the total amount, footer, or dynamic UPI QR code) will be trapped under the printhead or sliced in half!
* ✅ **Solution**: AndroPrint automatically injects **line feed commands (`feedLines: 2` or `3`)** before triggering the cutter blade, ensuring your complete receipt clears the cutter bar cleanly.

---

### ✂️ Cut Modes: Full Cut vs Partial Cut

| Feature | Full Cut (`mode: "full"`) | Partial Cut (`mode: "partial"`) |
|---|---|---|
| **Blade Action** | Cuts 100% across the paper roll | Cuts ~95% across the width, leaving a tiny 1-2mm tab in the center |
| **Result** | Receipt drops completely free into the receipt tray or hands | Receipt remains lightly attached to the roll so it does not blow away or fall on the floor |
| **Best Used For** | Supermarket checkouts, retail sales, customer receipts | Busy restaurant kitchens (KOTs), bar orders, windy outdoor counters |
| **ESC/POS Command** | `GS V 0` (`0x1D 0x56 0x00`) or `GS V 65 n` | `GS V 1` (`0x1D 0x56 0x01`) or `GS V 66 n` |
| **AndroPrint API** | `"cut": true` or `"cutMode": "full"` | `"cut": "partial"` or `"cutMode": "partial"` |

---

### 🔌 How to Trigger Auto Cut via AndroPrint API

#### 1. In Receipt Print (`POST /print`)
You can control auto cut behavior directly inside any print request:

```json
{
  "printerId": "printer_counter_1",
  "text": "Order #1024\nTable 7\nBurger x 2\nFries x 1\n",
  "cut": true,
  "cutMode": "partial",
  "feedLines": 3
}
```

* `cut`: `true` (cut paper), `false` (do not cut paper, continuous roll), or `"partial"`
* `cutMode`: `"full"` (default) or `"partial"`
* `feedLines`: Number of blank lines to feed forward before cutting (default `2`, recommended `3` to `4` for tall cutter gaps)

#### 2. Standalone Manual Feed & Cut (`POST /api/printer/cut`)
Useful for POS cashiers pressing a "Feed & Cut" or "Tear Receipt" button on a touchscreen:

```bash
curl -X POST http://localhost:3000/api/printer/cut \
  -H "Content-Type: application/json" \
  -H "x-client-id: pos_register_01" \
  -H "x-print-key: 9842" \
  -d '{
    "printerId": "printer_counter_1",
    "mode": "full",
    "feed": 3
  }'
```

Response:
```json
{
  "success": true,
  "message": "Paper full cut executed successfully",
  "mode": "full",
  "feed": 3
}
```

---

### ⚙️ ESC/POS Standard Hex Byte Sequences

If you are communicating with printers directly or debugging raw socket buffers:

| Function | Command | ASCII | Hex Bytes |
|---|---|---|---|
| **Full Cut** | `GS V 0` | `<GS> V <NUL>` | `1D 56 00` |
| **Partial Cut** | `GS V 1` | `<GS> V <SOH>` | `1D 56 01` |
| **Feed `n` lines & Full Cut** | `GS V 65 n` | `<GS> V A <n>` | `1D 56 41 [n]` |
| **Feed `n` lines & Partial Cut**| `GS V 66 n` | `<GS> V B <n>` | `1D 56 42 [n]` |
| **Feed `n` lines (ESC d)** | `ESC d n` | `<ESC> d <n>` | `1B 64 [n]` |
| **Hardware Reset** | `ESC @` | `<ESC> @` | `1B 40` |

---

### 🛠️ Auto Cut Hardware Troubleshooting

1. **Printer Does Not Cut (Only Feeds Paper)**
   * Check if your printer model has an auto cutter. Most 58mm portable Bluetooth printers (e.g. PT-210, MPT-II, POS-58) have a **manual serrated tear bar**, not a motorized cutter. Auto cut only works on printers with built-in motorized cutters (typically 80mm POS printers).
   * Check printer DIP switches: Some printers have a physical DIP switch on the bottom that disables the auto cutter.
   * Check paper jam / blade lock: If the blade jams, turn off the printer, open the top cover, roll the manual gear wheel until the blade retracts, and close the cover.

2. **Bottom of Receipt Is Sliced Off**
   * Increase `feedLines` from `2` to `4` or `5`. This feeds additional blank paper past the blade before cutting.

3. **Receipt Drops on Floor**
   * Change `cutMode` from `"full"` to `"partial"`. The partial cut leaves a small tab attached to the roll so the bill hangs safely until the cashier or chef pulls it off.

---

## 3. Multilingual & UTF-8 Character Support
AndroPrint automatically passes UTF-8 encoded byte buffers to the printer and configures standard ESC/POS code pages:

- **English / Latin**: Standard ASCII PC437
- **Malayalam (മലയാളം)**: UTF-8 Multi-byte string rendering
- **Arabic / Persian**: Right-to-Left UTF-8 text
- **Hindi / Devanagari**: Unicode code tables
- **Chinese / Japanese / Korean**: Double-byte Kanji/Asian mode (`FS &`)

---

## 4. Formatting & ESC/POS Commands
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
