#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# ANDROPRINT v2.0 – SETUP & INSTALLER ENTRYPOINT
# Developed By : MSA MODS x WhatYouWantKerala
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/install.sh" ]; then
  exec bash "$SCRIPT_DIR/install.sh" "$@"
fi

echo "Running fallback installation..."
node "$SCRIPT_DIR/generate-ssl.js"
node "$SCRIPT_DIR/server.js"
