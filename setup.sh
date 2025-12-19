#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "======================================"
echo "   ANDROPRINT – ONE CLICK INSTALL"
echo "======================================"

# Update system
pkg update -y && pkg upgrade -y

# Core tools
pkg install -y \
  nodejs \
  git \
  curl \
  jq \
  netcat-openbsd \
  poppler \
  imagemagick \
  cloudflared

# Create required folders
mkdir -p uploads
mkdir -p public

# Node dependencies (SAFE ONLY)
npm install express cors multer dotenv node-thermal-printer

# Optional process manager
npm install -g pm2

echo ""
echo "======================================"
echo " ✅ ANDROPRINT SETUP COMPLETE"
echo "======================================"
echo ""
echo "▶ Start server:"
echo "   node server.js"
echo ""
echo "▶ Open Admin UI:"
echo "   http://localhost:3000/printer.html"
echo ""
echo "▶ Cloudflare (if enabled):"
echo "   Temp URL will show in terminal"
echo ""
