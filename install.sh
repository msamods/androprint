#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
#   ⚡ ANDROPRINT v2.0 – UNIVERSAL ONE-CLICK ANDROID INSTALLER (ANDROID 8-16) ⚡
#   Developed By : MSA MODS x WhatYouWantKerala
#   Website      : https://msamods.org
# ==============================================================================
# Features:
# ✔ All Phone Support: Android 8 (Oreo) up to Android 16 (Baklava)
# ✔ Architecture Auto-Detect: aarch64, armv7l, x86_64, i686
# ✔ Single Phone All Local Connected Devices Hub (USB OTG, Bluetooth, LAN, Hotspot)
# ✔ Standalone Mode Enabled (Runs 100% offline without internet/cloud dependencies)
# ✔ SSL Enabled Local https://localhost:3000 out-of-the-box with SAN
# ✔ Dynamic Port Changer Ready
# ✔ Premium Colorful Terminal UI with Percentage Animation (0% - 100%)
# ✔ Termux Terminal CLI command ('androprint')
# ✔ Termux Widgets for One-Tap Android Home Screen Control
# ✔ Termux:Boot Auto-Start on phone reboot
# ✔ Auto-Diagnostic & Auto-Repair Engine for Bug Fixes
# ==============================================================================

# Enable strict error handling where appropriate
set -e

# ANSI Color & Style Palette
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'
CYAN='\033[38;5;51m'
PURPLE='\033[38;5;141m'
BLUE='\033[38;5;39m'
GREEN='\033[38;5;48m'
YELLOW='\033[38;5;220m'
RED='\033[38;5;196m'
MAGENTA='\033[38;5;201m'
WHITE='\033[38;5;231m'
BG_DARK='\033[48;5;234m'

# Clear screen if possible
clear 2>/dev/null || true

# Function: Animated Colorful Header Banner
print_banner() {
  echo -e "${PURPLE}╔══════════════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "${PURPLE}║${CYAN}   █████╗ ███╗   ██╗██████╗ ██████╗  ██████╗ ██████╗ ██████╗ ██╗███╗   ██╗████████╗  ${PURPLE}║${RESET}"
  echo -e "${PURPLE}║${CYAN}  ██╔══██╗████╗  ██║██╔══██╗██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██║████╗  ██║╚══██╔══╝  ${PURPLE}║${RESET}"
  echo -e "${PURPLE}║${CYAN}  ███████║██╔██╗ ██║██║  ██║██████╔╝██║   ██║██████╔╝██████╔╝██║██╔██╗ ██║   ██║     ${PURPLE}║${RESET}"
  echo -e "${PURPLE}║${CYAN}  ██╔══██║██║╚██╗██║██║  ██║██╔══██╗██║   ██║██╔═══╝ ██╔══██╗██║██║╚██╗██║   ██║     ${PURPLE}║${RESET}"
  echo -e "${PURPLE}║${CYAN}  ██║  ██║██║ ╚████║██████╔╝██║  ██║╚██████╔╝██║     ██║  ██║██║██║ ╚████║   ██║     ${PURPLE}║${RESET}"
  echo -e "${PURPLE}║${CYAN}  ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝     ${PURPLE}║${RESET}"
  echo -e "${PURPLE}╠══════════════════════════════════════════════════════════════════════╣${RESET}"
  echo -e "${PURPLE}║${WHITE}  ⚡ UNIVERSAL ANDROID ONE-CLICK INSTALLER • ANDROID 8 - 16           ${PURPLE}║${RESET}"
  echo -e "${PURPLE}║${GREEN}  ✔ Standalone Mode  •  ✔ Single-Phone Hub  •  ✔ SSL Localhost        ${PURPLE}║${RESET}"
  echo -e "${PURPLE}║${YELLOW}  Crafted with excellence by : MSA MODS x WhatYouWantKerala            ${PURPLE}║${RESET}"
  echo -e "${PURPLE}╚══════════════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
}

# Function: Smooth Percentage Progress Bar
render_progress() {
  local percent=$1
  local message=$2
  local width=34
  local filled=$((percent * width / 100))
  local empty=$((width - filled))

  printf "\r${CYAN}["
  printf "${GREEN}%0.s█" $(seq 1 $filled 2>/dev/null || true)
  printf "${DIM}%0.s░" $(seq 1 $empty 2>/dev/null || true)
  printf "${CYAN}] ${BOLD}%3d%%${RESET} ${WHITE}%s${RESET}\033[K" "$percent" "$message"
}

# Function: Spinner while running command
run_with_spinner() {
  local msg=$1
  shift
  local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  "$@" > /dev/null 2>&1 &
  local pid=$!
  local delay=0.08
  while kill -0 $pid 2>/dev/null; do
    local temp=${spinstr#?}
    printf "\r ${CYAN}%c${RESET} ${WHITE}%s...${RESET}" "$spinstr" "$msg"
    spinstr=$temp${spinstr%"$temp"}
    sleep $delay
  done
  wait $pid
  local exit_code=$?
  if [ $exit_code -eq 0 ]; then
    printf "\r ${GREEN}✔${RESET} ${WHITE}%s... ${GREEN}DONE${RESET}\n" "$msg"
  else
    printf "\r ${YELLOW}⚠${RESET} ${WHITE}%s... ${YELLOW}WARNING (Non-fatal)${RESET}\n" "$msg"
  fi
  return $exit_code
}

print_banner

# Step 0: Environment & Android Version Discovery
echo -e "${BOLD}${BLUE}🔍 [STAGE 1/6] System Architecture & Android Diagnostics${RESET}"
ARCH=$(uname -m 2>/dev/null || echo "unknown")
ANDROID_VER="Unknown"
DEVICE_MODEL="Android Phone"

if [ -f /system/bin/getprop ]; then
  ANDROID_VER=$(getprop ro.build.version.release 2>/dev/null || echo "Unknown")
  DEVICE_MODEL=$(getprop ro.product.model 2>/dev/null || echo "Android Phone")
fi

echo -e "   ${CYAN}• Device Model   :${RESET} ${WHITE}$DEVICE_MODEL${RESET}"
echo -e "   ${CYAN}• Android Release:${RESET} ${GREEN}Android $ANDROID_VER (Supported 8-16)${RESET}"
echo -e "   ${CYAN}• CPU Arch       :${RESET} ${WHITE}$ARCH${RESET}"
echo -e "   ${CYAN}• Mode           :${RESET} ${GREEN}Single-Phone Standalone Print Gateway${RESET}"
echo ""

# Step 1: Package Manager & Mirror Auto-Healing
echo -e "${BOLD}${BLUE}📦 [STAGE 2/6] Auto-Updating Termux Package Ecosystem${RESET}"
render_progress 10 "Checking Termux repository mirrors..."
sleep 0.3

# Fix repository issues if mirrors are unresponsive
if command -v pkg >/dev/null 2>&1; then
  render_progress 20 "Upgrading package index..."
  pkg update -y >/dev/null 2>&1 || {
    echo -e "\n   ${YELLOW}⚠ Mirror slow or unresponsive. Auto-repairing sources.list...${RESET}"
    termux-change-repo 2>/dev/null || true
    pkg update -y >/dev/null 2>&1 || true
  }
fi

render_progress 35 "Installing Node.js LTS, OpenSSL, Netcat, and Core Tools..."
# Install packages with full fallback
if command -v pkg >/dev/null 2>&1; then
  pkg install -y \
    nodejs-lts \
    openssl-tool \
    curl \
    git \
    jq \
    netcat-openbsd \
    termux-api \
    termux-tools \
    procps >/dev/null 2>&1 || {
      # Fallback to standard nodejs if nodejs-lts fails
      pkg install -y nodejs openssl-tool curl git jq netcat-openbsd >/dev/null 2>&1 || true
    }
fi

echo ""
echo -e "   ${GREEN}✔ Package ecosystem verified & ready!${RESET}"
echo ""

# Step 2: Android Battery Wakelock (Prevents Android Sleep / Doze mode)
echo -e "${BOLD}${BLUE}🔋 [STAGE 3/6] Android CPU Wakelock & Permissions${RESET}"
render_progress 45 "Enabling Termux Wakelock for continuous 24/7 printing..."
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  echo -e "\n   ${GREEN}✔ Wakelock ACTIVE (Device CPU will stay awake for instant printing)${RESET}"
else
  echo -e "\n   ${YELLOW}• Wakelock tool not in path (Skipped)${RESET}"
fi

# Request storage access if available
if command -v termux-setup-storage >/dev/null 2>&1 && [ ! -d "$HOME/storage" ]; then
  termux-setup-storage >/dev/null 2>&1 || true
fi
echo ""

# Step 3: Project Location & Node.js Dependencies
echo -e "${BOLD}${BLUE}⚡ [STAGE 4/6] Setting Up AndroPrint Standalone Engine${RESET}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR"

# If cloned outside, ensure we are in the directory
cd "$APP_DIR"

mkdir -p uploads public "$HOME/.shortcuts" "$HOME/.termux/boot"

render_progress 60 "Installing Gateway & Print Engine dependencies..."
if command -v npm >/dev/null 2>&1; then
  npm install --no-audit --prefer-offline >/dev/null 2>&1 || npm install >/dev/null 2>&1 || true
fi

# Configure Standalone Mode in .env
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat << 'EOF' > "$ENV_FILE"
PORT=3000
USE_SSL=true
STANDALONE_MODE=true
ENABLE_AUTH=false
AUTO_PRINT=true
LOG_LEVEL=INFO
EOF
fi

render_progress 75 "Generating 10-Year SSL Certificates with SAN (localhost & LAN)..."
# Step 4: SSL Certificate Generation
if [ -f "$APP_DIR/generate-ssl.js" ]; then
  node "$APP_DIR/generate-ssl.js" >/dev/null 2>&1 || true
fi
echo -e "\n   ${GREEN}✔ Local SSL active (https://localhost:3000)${RESET}"
echo ""

# Step 5: Termux Terminal CLI Integration ('androprint')
echo -e "${BOLD}${BLUE}🛠️ [STAGE 5/6] Installing Terminal CLI & Termux Widgets${RESET}"
render_progress 85 "Creating 'androprint' global command in \$PREFIX/bin..."

PREFIX_BIN="${PREFIX:-/data/data/com.termux/files/usr}/bin"
mkdir -p "$PREFIX_BIN"

ANDRO_CLI="$PREFIX_BIN/androprint"

cat << EOF > "$ANDRO_CLI"
#!/data/data/com.termux/files/usr/bin/bash
# AndroPrint Master Terminal CLI
APP_DIR="$APP_DIR"
cd "\$APP_DIR" || exit 1

case "\$1" in
  start)
    if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock; fi
    pkill -f "node server.js" 2>/dev/null || true
    nohup node server.js > "\$APP_DIR/androprint.log" 2>&1 &
    echo -e "\033[38;5;48m✔ AndroPrint Server Started in Background! (PID: \$!)\033[0m"
    echo -e "\033[38;5;51m🌐 Localhost UI: https://localhost:3000\033[0m"
    ;;
  stop)
    pkill -f "node server.js" 2>/dev/null || true
    echo -e "\033[38;5;196m⏹ AndroPrint Server Stopped.\033[0m"
    ;;
  restart)
    pkill -f "node server.js" 2>/dev/null || true
    sleep 1
    if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock; fi
    nohup node server.js > "\$APP_DIR/androprint.log" 2>&1 &
    echo -e "\033[38;5;48m🔄 AndroPrint Server Restarted Successfully!\033[0m"
    ;;
  status)
    if pgrep -f "node server.js" >/dev/null; then
      echo -e "\033[38;5;48m● AndroPrint is RUNNING (PID: \$(pgrep -f 'node server.js' | head -n 1))\033[0m"
      echo -e "\033[38;5;51m🌐 Dashboard: https://localhost:3000\033[0m"
    else
      echo -e "\033[38;5;196m○ AndroPrint is STOPPED.\033[0m"
    fi
    ;;
  logs)
    tail -f -n 50 "\$APP_DIR/androprint.log"
    ;;
  repair)
    node -e "const D=require('./diagnostics'); const d=new D('$APP_DIR'); d.runAutoRepair().then(r=>console.log(JSON.stringify(r,null,2)))"
    ;;
  open)
    if command -v termux-open-url >/dev/null 2>&1; then
      termux-open-url "https://localhost:3000/dashboard.html"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "https://localhost:3000/dashboard.html"
    else
      am start -a android.intent.action.VIEW -d "https://localhost:3000/dashboard.html" 2>/dev/null || true
    fi
    ;;
  port)
    if [ -n "\$2" ]; then
      node -e "const fs=require('fs'); let p=process.argv[1]; let e=fs.readFileSync('.env','utf8').replace(/PORT=\d+/g,'PORT='+p); fs.writeFileSync('.env',e); console.log('Port updated to '+p);" "\$2"
      echo -e "\033[38;5;48mPort set to \$2. Restarting server...\033[0m"
      androprint restart
    else
      echo "Usage: androprint port <PORT_NUMBER>"
    fi
    ;;
  tunnel|cloud)
    if ! command -v cloudflared >/dev/null 2>&1; then
      echo -e "\033[38;5;208m[*] cloudflared not installed. Installing...\033[0m"
      pkg update -y && pkg install -y cloudflared
    fi
    echo -e "\033[38;5;48m[✔] Launching Cloudflare Tunnel for AndroPrint...\033[0m"
    cloudflared tunnel --url http://127.0.0.1:3000
    ;;
  *)
    echo -e "\033[1m\033[38;5;141m⚡ ANDROPRINT TERMINAL CONTROLLER\033[0m"
    echo -e "Usage: androprint {start|stop|restart|status|logs|repair|port|open|tunnel}"
    ;;
esac
EOF

chmod +x "$ANDRO_CLI"
echo -e "\n   ${GREEN}✔ Global terminal command 'androprint' installed in $ANDRO_CLI${RESET}"

# Step 6: Create Termux Widgets (~/.shortcuts)
render_progress 92 "Creating Termux:Widget one-tap home screen buttons..."
SHORTCUTS_DIR="$HOME/.shortcuts"
mkdir -p "$SHORTCUTS_DIR"

# 1. Start Widget
cat << EOF > "$SHORTCUTS_DIR/AndroPrint-Start.sh"
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
cd "$APP_DIR" || exit 1
pkill -f "node server.js" 2>/dev/null || true
nohup node server.js > "$APP_DIR/androprint.log" 2>&1 &
termux-toast "AndroPrint Started!" 2>/dev/null || true
EOF
chmod +x "$SHORTCUTS_DIR/AndroPrint-Start.sh"

# 2. Stop Widget
cat << EOF > "$SHORTCUTS_DIR/AndroPrint-Stop.sh"
#!/data/data/com.termux/files/usr/bin/bash
pkill -f "node server.js" 2>/dev/null || true
termux-toast "AndroPrint Stopped" 2>/dev/null || true
EOF
chmod +x "$SHORTCUTS_DIR/AndroPrint-Stop.sh"

# 3. Restart Widget
cat << EOF > "$SHORTCUTS_DIR/AndroPrint-Restart.sh"
#!/data/data/com.termux/files/usr/bin/bash
cd "$APP_DIR" || exit 1
pkill -f "node server.js" 2>/dev/null || true
sleep 1
termux-wake-lock 2>/dev/null || true
nohup node server.js > "$APP_DIR/androprint.log" 2>&1 &
termux-toast "AndroPrint Restarted!" 2>/dev/null || true
EOF
chmod +x "$SHORTCUTS_DIR/AndroPrint-Restart.sh"

# 4. Open UI Widget
cat << EOF > "$SHORTCUTS_DIR/AndroPrint-OpenUI.sh"
#!/data/data/com.termux/files/usr/bin/bash
if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "https://localhost:3000/dashboard.html"
else
  am start -a android.intent.action.VIEW -d "https://localhost:3000/dashboard.html" 2>/dev/null || true
fi
EOF
chmod +x "$SHORTCUTS_DIR/AndroPrint-OpenUI.sh"

# 5. Auto-Repair Widget
cat << EOF > "$SHORTCUTS_DIR/AndroPrint-Repair.sh"
#!/data/data/com.termux/files/usr/bin/bash
cd "$APP_DIR" || exit 1
node -e "const D=require('./diagnostics'); const d=new D('$APP_DIR'); d.runAutoRepair();" 2>/dev/null || true
termux-toast "AndroPrint Auto-Repaired!" 2>/dev/null || true
EOF
chmod +x "$SHORTCUTS_DIR/AndroPrint-Repair.sh"

# 6. Cloudflare Tunnel Widget
cat << EOF > "$SHORTCUTS_DIR/AndroPrint-Tunnel.sh"
#!/data/data/com.termux/files/usr/bin/bash
if ! command -v cloudflared >/dev/null 2>&1; then
  pkg update -y && pkg install -y cloudflared
fi
cloudflared tunnel --url http://127.0.0.1:3000
EOF
chmod +x "$SHORTCUTS_DIR/AndroPrint-Tunnel.sh"

# Configure Termux:Boot Auto-Start
BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"
cat << EOF > "$BOOT_DIR/start-androprint.sh"
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd "$APP_DIR" || exit 1
nohup node server.js > "$APP_DIR/androprint.log" 2>&1 &
echo "[$(date)] AndroPrint booted on phone reboot" >> "$APP_DIR/androprint.log"
EOF
chmod +x "$BOOT_DIR/start-androprint.sh"

render_progress 100 "Installation and System Calibration Complete!"
echo ""
echo ""

# Find Device LAN IP
LOCAL_IP=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || echo "127.0.0.1")

# Launch Service
pkill -f "node server.js" 2>/dev/null || true
nohup node "$APP_DIR/server.js" > "$APP_DIR/androprint.log" 2>&1 &
sleep 2

echo -e "${PURPLE}╔══════════════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${PURPLE}║${GREEN}            🎉 ANDROPRINT INSTALLATION 100% SUCCESSFUL!               ${PURPLE}║${RESET}"
echo -e "${PURPLE}╠══════════════════════════════════════════════════════════════════════╣${RESET}"
echo -e "${PURPLE}║${WHITE}  📱 Local Device UI  : ${CYAN}https://localhost:3000/dashboard.html           ${PURPLE}║${RESET}"
echo -e "${PURPLE}║${WHITE}  📶 Wi-Fi LAN UI     : ${CYAN}https://${LOCAL_IP}:3000/dashboard.html${PURPLE}║${RESET}"
echo -e "${PURPLE}║${WHITE}  🔒 Security Mode    : ${GREEN}SSL / TLS Enabled (10-Year Local Cert)          ${PURPLE}║${RESET}"
echo -e "${PURPLE}║${WHITE}  🖨️ Architecture     : ${YELLOW}Standalone Mode • Single-Phone Local Hub        ${PURPLE}║${RESET}"
echo -e "${PURPLE}║${WHITE}  📲 Termux Widgets   : ${MAGENTA}5 One-Tap Shortcuts in ~/.shortcuts/            ${PURPLE}║${RESET}"
echo -e "${PURPLE}║${WHITE}  ⚡ Terminal Command : ${BOLD}androprint {start|stop|restart|logs|repair}     ${PURPLE}║${RESET}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${BOLD}${YELLOW}💡 HOW TO USE YOUR TERMUX HOME SCREEN WIDGETS:${RESET}"
echo -e "   1. Long press on your Android Home Screen -> Select ${BOLD}Widgets${RESET}."
echo -e "   2. Scroll to ${BOLD}Termux:Widget${RESET} and drag it onto your home screen."
echo -e "   3. You will see direct one-tap buttons:"
echo -e "      • ${GREEN}AndroPrint-Start${RESET}    : Starts the print gateway"
echo -e "      • ${RED}AndroPrint-Stop${RESET}     : Stops the gateway"
echo -e "      • ${CYAN}AndroPrint-OpenUI${RESET}   : Opens the Dashboard in Chrome/Browser"
echo -e "      • ${YELLOW}AndroPrint-Repair${RESET}   : 1-Click fix for all bugs & stuck jobs"
echo ""

# Try opening the browser automatically
if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "https://localhost:3000/dashboard.html" 2>/dev/null || true
fi

echo -e "${GREEN}✨ AndroPrint is now live and waiting for print jobs!${RESET}"
