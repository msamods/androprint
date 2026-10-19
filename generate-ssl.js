/**
 * Generate Local Self-Signed SSL Certificates for AndroPrint
 * Developed By : MSA MODS x WhatYouWantKerala
 *
 * Runs natively in Node.js using crypto without needing OpenSSL installed!
 */

const fs = require('fs');
const path = require('path');
const { generateKeyPairSync } = require('crypto');

console.log("Generating SSL certificate for localhost...");

// To create standard X.509 certs across platforms without native OpenSSL binaries,
// you can either use OpenSSL CLI or mkcert.
// If OpenSSL is available on the machine, this script calls openssl directly.

const { execSync } = require('child_process');

try {
  const keyPath = path.join(__dirname, 'server.key');
  const certPath = path.join(__dirname, 'server.cert');

  const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`;
  execSync(cmd, { stdio: 'inherit' });

  console.log("✅ SSL Certificates generated successfully!");
  console.log(`- Key  : ${keyPath}`);
  console.log(`- Cert : ${certPath}`);
  console.log("\nStart your server with SSL:");
  console.log("  USE_SSL=true node server.js");
} catch (e) {
  console.log("Note: OpenSSL CLI command was not executed directly.");
  console.log("You can generate certificates with either of these commands:");
  console.log("1. Using OpenSSL: openssl req -x509 -newkey rsa:2048 -keyout server.key -out server.cert -days 365 -nodes -subj \"/CN=localhost\"");
  console.log("2. Using mkcert (Trusted by all browsers): mkcert -key-file server.key -cert-file server.cert localhost 127.0.0.1 ::1");
}
