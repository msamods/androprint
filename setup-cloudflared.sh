#!/bin/bash
# ================================================================
# ANDROPRINT - 1-CLICK CLOUDFLARE TUNNEL INSTALLER FOR TERMUX & LINUX
# Developed By : MSA MODS x WhatYouWantKerala
# ================================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║          ANDROPRINT • CLOUDFLARE TUNNEL SETUP                 ║"
echo "║          Zero Config • Free Public HTTPS Printing             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

if command -v cloudflared &> /dev/null; then
    VERSION=$(cloudflared --version)
    echo -e "${GREEN}[✔] cloudflared is ALREADY installed: ${VERSION}${NC}"
    echo ""
    echo -e "${YELLOW}Starting Cloudflare Tunnel to AndroPrint on port 3000...${NC}"
    cloudflared tunnel --url http://127.0.0.1:3000
    exit 0
fi

echo -e "${YELLOW}[*] Detecting environment...${NC}"

if [ -d "/data/data/com.termux" ]; then
    echo -e "${CYAN}[*] Android Termux environment detected.${NC}"
    echo -e "${YELLOW}[*] Updating Termux package mirrors...${NC}"
    pkg update -y
    echo -e "${YELLOW}[*] Installing cloudflared...${NC}"
    pkg install -y cloudflared
elif command -v apt-get &> /dev/null; then
    echo -e "${CYAN}[*] Debian/Ubuntu environment detected.${NC}"
    ARCH=$(dpkg --print-architecture)
    URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
    echo -e "${YELLOW}[*] Downloading from ${URL}...${NC}"
    curl -L --output /tmp/cloudflared.deb "$URL"
    sudo dpkg -i /tmp/cloudflared.deb
elif command -v apk &> /dev/null; then
    echo -e "${CYAN}[*] Alpine Linux detected.${NC}"
    apk add --no-cache cloudflared
else
    echo -e "${RED}[!] Unsupported package manager. Please install cloudflared manually from https://github.com/cloudflare/cloudflared/releases${NC}"
    exit 1
fi

if command -v cloudflared &> /dev/null; then
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   ✔ CLOUDFLARED SUCCESSFULLY INSTALLED!                       ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "You can now launch the tunnel directly from the AndroPrint Web Dashboard"
    echo -e "or start it from terminal with:"
    echo -e "${CYAN}  cloudflared tunnel --url http://127.0.0.1:3000${NC}"
    echo ""
else
    echo -e "${RED}[✖] Installation failed. Check your network connection.${NC}"
    exit 1
fi
