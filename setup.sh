#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# ANDROPRINT v2.0 – AUTOMATED TERMUX & TERMUX:BOOT ONE-CLICK SETUP
# Developed By : MSA MODS x WhatYouWantKerala
# ==============================================================================

set -e

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║             ANDROPRINT v2.0 INSTALLER & AUTOBOOT           ║"
echo "║       Developed By : MSA MODS x WhatYouWantKerala          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 1. Update Termux Repositories
echo "📦 [1/6] Updating packages..."
pkg update -y && pkg upgrade -y

# 2. Install Core System Tools & Runtimes
echo "🛠️ [2/6] Installing Node.js, Cloudflared & Utilities..."
pkg install -y \
  nodejs-lts \
  git \
  curl \
  jq \
  netcat-openbsd \
  termux-api \
  cloudflared

# 3. Create required runtime directories
echo "📁 [3/6] Setting up project workspace..."
mkdir -p uploads public

# 4. Install Node.js Dependencies
echo "⚡ [4/6] Installing Node.js print gateway dependencies..."
npm install --no-audit --prefer-offline || npm install

# 5. Acquire Wakelock to prevent Android battery sleep
echo "🔋 [5/6] Enabling Termux Wakelock..."
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  echo "   ✓ Wakelock active (Device CPU will stay awake for printing)"
fi

# 6. Setup Termux:Boot Auto-Start on Phone Reboot
echo "🚀 [6/6] Configuring Termux:Boot Auto-Start..."
BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOT_SCRIPT="$BOOT_DIR/start-androprint.sh"

cat << 'EOF' > "$BOOT_SCRIPT"
#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# AndroPrint Auto-Start on Android Phone Boot
# Developed By : MSA MODS x WhatYouWantKerala
# ==============================================================================

# Prevent Android CPU sleep (Doze mode)
termux-wake-lock

# Auto-detect AndroPrint project path
if [ -d "$HOME/androprint" ]; then
  APP_DIR="$HOME/androprint"
elif [ -d "/data/data/com.termux/files/home/androprint" ]; then
  APP_DIR="/data/data/com.termux/files/home/androprint"
else
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

cd "$APP_DIR" || exit 1

# Launch AndroPrint server in the background and log output
node server.js > "$APP_DIR/androprint-boot.log" 2>&1 &

echo "[$(date)] AndroPrint Service Started Successfully via Termux:Boot" >> "$APP_DIR/androprint-boot.log"
EOF

chmod +x "$BOOT_SCRIPT"
echo "   ✓ Auto-boot script installed at: $BOOT_SCRIPT"

# 7. Complete Summary Banner
LOCAL_IP=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || echo "127.0.0.1")

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║             ✅ ANDROPRINT SETUP COMPLETE!                  ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  Localhost UI : http://localhost:3000                      ║"
echo "║  Wi-Fi LAN UI : http://$LOCAL_IP:3000"
echo "║  Termux:Boot  : CONFIGURED (~/.termux/boot/start-androprint.sh) ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "💡 INSTRUCTIONS TO AUTO-START ON REBOOT:"
echo "1. Install 'Termux:Boot' from F-Droid (if not installed yet)."
echo "2. Open Termux:Boot app once to grant auto-start permissions."
echo "3. Whenever your phone restarts, AndroPrint will start automatically!"
echo ""
echo "▶ To start the server right now, run:"
echo "   node server.js"
echo ""
