#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# ANDROPRINT 1-CLICK AUTO-REPAIR & BUG FIX SCRIPT
# Developed By : MSA MODS x WhatYouWantKerala
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo -e "\033[1m\033[38;5;141m🔧 ANDROPRINT SELF-HEALING & BUG REPAIR ENGINE\033[0m"
echo -e "\033[38;5;51mScanning environment and repairing issues...\033[0m"

node -e "
const DiagnosticEngine = require('./diagnostics');
const engine = new DiagnosticEngine(__dirname);
engine.runAutoRepair().then(res => {
  console.log('\n\x1b[38;5;48m✔ Auto-Repair Complete! Fixed ' + res.fixedCount + ' issue(s):\x1b[0m');
  res.fixedIssues.forEach(i => console.log('  • ' + i));
  console.log('\nSystem Health: ' + res.finalHealth.healthScore + '% (' + res.finalHealth.status + ')');
}).catch(err => {
  console.error('Repair error:', err);
});
"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi

echo -e "\n\033[38;5;48mDone! Restart server with: androprint restart\033[0m"
