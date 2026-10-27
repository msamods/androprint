/**
 * ANDROPRINT - SSL CERTIFICATE GENERATOR WITH SAN SUPPORT
 * Developed By : MSA MODS x WhatYouWantKerala
 *
 * Generates 10-year valid SSL certificates with Subject Alternative Names (SAN)
 * for localhost (127.0.0.1) and all local LAN / Wi-Fi IP addresses.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function getLocalIpAddresses() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function ensureSSLCertificates(baseDir = __dirname) {
  const keyPath = path.join(baseDir, 'server.key');
  const certPath = path.join(baseDir, 'server.cert');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    try {
      const keyContent = fs.readFileSync(keyPath, 'utf8');
      const certContent = fs.readFileSync(certPath, 'utf8');
      if (keyContent.includes('PRIVATE KEY') && certContent.includes('CERTIFICATE')) {
        return { success: true, keyPath, certPath, created: false };
      }
    } catch {}
  }

  console.log("🔒 Generating high-security local SSL certificate for localhost & LAN...");

  const cnfPath = path.join(baseDir, 'openssl_temp.cnf');
  const localIps = getLocalIpAddresses();

  let altNames = [
    'DNS.1 = localhost',
    'DNS.2 = *.localhost',
    'DNS.3 = android.local',
    'IP.1 = 127.0.0.1',
    'IP.2 = ::1'
  ];

  localIps.forEach((ip, idx) => {
    altNames.push(`IP.${idx + 3} = ${ip}`);
  });

  const cnfContent = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = req_distinguished_name
x509_extensions = v3_req

[req_distinguished_name]
C = IN
ST = Kerala
L = Calicut
O = MSA MODS
OU = AndroPrint Local SSL
CN = localhost

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${altNames.join('\n')}
`;

  try {
    fs.writeFileSync(cnfPath, cnfContent.trim());

    // Try OpenSSL CLI
    const cmd = `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -config "${cnfPath}"`;
    execSync(cmd, { stdio: 'pipe' });

    if (fs.existsSync(cnfPath)) fs.unlinkSync(cnfPath);

    console.log("✅ SSL Certificates generated successfully!");
    console.log(`- Key  : ${keyPath}`);
    console.log(`- Cert : ${certPath}`);
    console.log(`- SANs : localhost, 127.0.0.1, ${localIps.join(', ') || 'none'}`);
    return { success: true, keyPath, certPath, created: true };
  } catch (err) {
    if (fs.existsSync(cnfPath)) {
      try { fs.unlinkSync(cnfPath); } catch {}
    }
    console.warn("⚠️ OpenSSL failed:", err.message);

    // Fallback: Check if we can create a self-signed cert or inform user
    return { success: false, error: err.message, keyPath, certPath };
  }
}

if (require.main === module) {
  const result = ensureSSLCertificates();
  if (result.success) {
    console.log("Certificate ready for https://localhost:3000");
  } else {
    console.error("Certificate generation error:", result.error);
    process.exit(1);
  }
}

module.exports = { ensureSSLCertificates };
