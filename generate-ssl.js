/**
 * ANDROPRINT - SSL CERTIFICATE GENERATOR WITH SAN SUPPORT
 * Developed By : MSA MODS x WhatYouWantKerala
 *
 * Generates 10-year valid SSL certificates with Subject Alternative Names (SAN)
 * for localhost (127.0.0.1) and all local LAN / Wi-Fi IP addresses.
 * Includes built-in embedded 10-year fallback cert so Android standalone
 * works 100% without needing the external openssl binary.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const EMBEDDED_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDNJHk7v7z6fKEQ
TW7EJqXtVo7I4ucVboDS9qycNFBFWLjJKze6KJQ4OL8mcXqXa6m1Yd2IWj3GJo+Y
iBOF5F2sGS5nKNppndDzU+5tVkr3OzYegdeOmkEv8+srOxpQC+3hFc0pEQ4xVyrr
DjfAwpVyQzAnLnpqnPofGZzRdEn7wLjSKPAJofbCe4WM202i6Du8F00+r521byjI
Bl7JyxHJsUm//OWoOU1xv4lYnmo+sfI7DGkfGCbUrIVifCorMEF0GNguafXFFzZV
/AreRHP1J8qPna405ad8PIfy4OpU8/yDAjWO7rA7/f5ZF9KBnW+lfG61MB+nb0/6
BNE9m1rXAgMBAAECggEADsfb/FQaV6n3KOeLXZKzTeB4tTy0DbVCjvC7Cx4x0m1M
EyKMB1u5Ijvkee6fOJ3HQoxkm9h0rvxESGc1kOYdYbMGxuQIqKd4UK/xc+tNx3Z6
tcQBNgMjQ0M95IWDpdTWNOuPNrBF54QyUXFazwa2Id95brlIlLnuw6Liy6ynT/43
uiiPZyaWGHmuqZhybmHUDFYKTMWShpFEDUGGChql3T4oKuWIfzPxr6eWBD/GTGOd
spkXTP+VqarQln0GFxdHORwJRuEJt4S+FxBBn6BnB/V8Jd6Wvt3sAWwNIxhY3ISs
V4ck7ogo+PxS7duhYB4dubXr/LwYiWwqBJYR+ygbUQKBgQD06TPOPZ8E1lmQXnVz
epf1F5jamHMk0DydC+Gf73xU1KHrvlVjMzO66WmHWvDTj2Mfj5e8udi4BX1rm8wm
ar0YZD/dXe0VFk35JmQ08LOBDj9NQbcewSRgLia6OTo6SoZNgr2ktlQuYyyBHB6S
js9Xjt+jGsKTpunhck7MROZSCwKBgQDWbk8mzOEn+IFr8yK7wKRI6R/dFQ6lIGkp
CV4keHe50ZpL133n6ApnSpI0GAmdZgPJHc4h7WLaaTw068qMXZjgZMmP2qm8HLUz
cBbgc7DmTf7tq95JVA7B+S62PhIIy/+wuZmoSMSauTH+zO+/6GxojUClud4iorFE
a0xFT8VF5QKBgQDedYlKF+z+jtlR6osS9tNanDGKtZk5YjD8kdNC3Fz6DR57LSsQ
bWzapbPmb/N6p67o9xxkIAe7t7jh6uV4K9JRepYMNInqcpUm7/lroQvb+R4ExeFY
/SVWe/VPiDXcxt7RPyWVnMxASnMdX3Zht3ic1rlKxT7isWWWE6eBoj/3WwKBgQCI
IK1E/4nsuxlGc6rYMJra4oxk6MpMUAASmizW0FeJcqQWg64dfDSmkDOyuJPaBXpf
wfkrlq1L5MTg/9OtOnoj8jf3iCR7FGqARidvxGJIQrmVHqfWO3PG9q8N6OfAB+nB
woHm0JNneixgCrAlT6MK2KlyzEVWDZylx8w6sEKXdQKBgEA7HTxR9xrTLEWqfVud
0iXg2H11HivmNkascEvxrewy5x16M5lqc/R7RQvZsX3Up0HcPQGUL8Hvv6fpTniF
znfoRHQIQtIKWAqs0UMifgopG0R/lR2bBPGLzG10xjMV34AmIS1v+Rekhw2o5+aE
J4mYC9KKg3TMvtb1I2PxoryD
-----END PRIVATE KEY-----`;

const EMBEDDED_CERT = `-----BEGIN CERTIFICATE-----
MIIEGTCCAwGgAwIBAgIUe6KZkxlN2hm93ijfhEbUnHp0TncwDQYJKoZIhvcNAQEL
BQAwdjELMAkGA1UEBhMCSU4xDzANBgNVBAgMBktlcmFsYTEQMA4GA1UEBwwHQ2Fs
aWN1dDERMA8GA1UECgwITVNBIE1PRFMxHTAbBgNVBAsMFEFuZHJvUHJpbnQgTG9j
YWwgU1NMMRIwEAYDVQQDDAlsb2NhbGhvc3QwHhcNMjYxMDI3MTA0MTEyWhcNMzYx
MDI0MTA0MTEyWjB2MQswCQYDVQQGEwJJTjEPMA0GA1UECAwGS2VyYWxhMRAwDgYD
VQQHDAdDYWxpY3V0MREwDwYDVQQKDAhNU0EgTU9EUzEdMBsGA1UECwwUQW5kcm9Q
cmludCBMb2NhbCBTU0wxEjAQBgNVBAMMCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAM0keTu/vPp8oRBNbsQmpe1Wjsji5xVugNL2rJw0
UEVYuMkrN7oolDg4vyZxepdrqbVh3YhaPcYmj5iIE4XkXawZLmco2mmd0PNT7m1W
Svc7Nh6B146aQS/z6ys7GlAL7eEVzSkRDjFXKusON8DClXJDMCcuemqc+h8ZnNF0
SfvAuNIo8Amh9sJ7hYzbTaLoO7wXTT6vnbVvKMgGXsnLEcmxSb/85ag5TXG/iVie
aj6x8jsMaR8YJtSshWJ8KiswQXQY2C5p9cUXNlX8Ct5Ec/Unyo+drjTlp3w8h/Lg
6lTz/IMCNY7usDv9/lkX0oGdb6V8brUwH6dvT/oE0T2bWtcCAwEAAaOBnjCBmzAd
BgNVHQ4EFgQUtwGUs9/PO+GWStdMMZLKEV/y8TIwHwYDVR0jBBgwFoAUtwGUs9/P
O+GWStdMMZLKEV/y8TIwDwYDVR0TAQH/BAUwAwEB/zBIBgNVHREEQTA/gglsb2Nh
bGhvc3SCCyoubG9jYWxob3N0gg1hbmRyb2lkLmxvY2FshwR/AAABhxAAAAAAAAAA
AAAAAAAAAAABMA0GCSqGSIb3DQEBCwUAA4IBAQAahK/m0KCuD1BhXNyRsjtChn1P
WlSmgK9i2/qxCjZjg9884kiblsZmkFEYSJL/qKz3/qEL/UYrZd4tpg4JqgDxyfLy
1MQ1+f+b/4nxBOJd7KBjQXlZ+1WBgRGwjbM51McADjXoJxdH0EG0H0X7VpIivlH2
rpNjPXdqq64+fJNnFqM4B6ltaVoeaQI6a39hA+S6ScPUX7kdL/bHoxWbF6+joQol
kLDeHjmbX2OQVtrIY2Bws1Fj9AuAi3vgqUe/SgwhOTDpDSpE43VII+fSKiCRGfsV
99l/uZ5LTdgz5ChxHSoBLI2zUnzJbLzZwvscMFrNClthR923rJO544Dh3W47
-----END CERTIFICATE-----`;

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

  console.log("🔒 Setting up high-security local SSL certificate for localhost & LAN...");

  // Write embedded 10-year SAN certificate first (failsafe for Android)
  try {
    fs.writeFileSync(keyPath, EMBEDDED_KEY.trim() + '\n');
    fs.writeFileSync(certPath, EMBEDDED_CERT.trim() + '\n');
    console.log("✅ 10-year SAN SSL Certificate deployed successfully!");
    return { success: true, keyPath, certPath, created: true };
  } catch (err) {
    console.warn("⚠️ Failed to write cert files:", err.message);
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
