/**
 * Bundles AndroPrint Node.js server and Web Dashboards into Android APK assets
 * Developed By : MSA MODS x WhatYouWantKerala
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const ASSETS_PROJECT_DIR = path.join(ROOT_DIR, 'android-app', 'app', 'src', 'main', 'assets', 'nodejs-project');

console.log("📦 Bundling AndroPrint project into Android assets:", ASSETS_PROJECT_DIR);

if (!fs.existsSync(ASSETS_PROJECT_DIR)) {
  fs.mkdirSync(ASSETS_PROJECT_DIR, { recursive: true });
}

const FILES_TO_COPY = [
  'server.js',
  'diagnostics.js',
  'system_logger.js',
  'generate-ssl.js',
  'cloudflare_manager.js',
  'package.json'
];

// Use compiled self-contained bundle for standalone APK execution
const bundledServer = path.join(ROOT_DIR, 'dist-bundle', 'index.js');
if (fs.existsSync(bundledServer)) {
  fs.copyFileSync(bundledServer, path.join(ASSETS_PROJECT_DIR, 'server.js'));
  console.log("  ✓ Bundled standalone server.js (with all embedded dependencies)");
} else {
  fs.copyFileSync(path.join(ROOT_DIR, 'server.js'), path.join(ASSETS_PROJECT_DIR, 'server.js'));
  console.log("  ✓ Copied server.js");
}

for (const file of FILES_TO_COPY) {
  if (file === 'server.js') continue;
  const src = path.join(ROOT_DIR, file);
  const dest = path.join(ASSETS_PROJECT_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  ✓ Copied ${file}`);
  }
}

// Copy public directory
function copyFolderRecursive(source, target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  const files = fs.readdirSync(source);
  for (const file of files) {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursive(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  }
}

const publicSrc = path.join(ROOT_DIR, 'public');
const publicDest = path.join(ASSETS_PROJECT_DIR, 'public');
if (fs.existsSync(publicSrc)) {
  copyFolderRecursive(publicSrc, publicDest);
  console.log("  ✓ Copied public/ directory (all HTML dashboards)");
}

console.log("🎉 Android project assets ready for 1-Click standalone APK packaging!");
