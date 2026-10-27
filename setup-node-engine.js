/**
 * Downloads and extracts precompiled nodejs-mobile libnode.so for Android
 * Developed By : MSA MODS x WhatYouWantKerala
 */

const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const ZIP_URL = 'https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.20.4/nodejs-mobile-v18.20.4-android.zip';
const ZIP_DEST = path.join(__dirname, 'nodejs-mobile-temp.zip');
const TARGET_JNI = path.join(__dirname, 'android-app', 'app', 'src', 'main', 'jniLibs');

console.log('⬇️ Downloading nodejs-mobile v18.20.4 Android prebuilts...');

function download(curUrl) {
  https.get(curUrl, { headers: { 'User-Agent': 'node' } }, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      download(res.headers.location);
      return;
    }
    if (res.statusCode !== 200) {
      console.error('Download failed with status code:', res.statusCode);
      return;
    }
    const file = fs.createWriteStream(ZIP_DEST);
    res.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        console.log('📦 Extracting libnode.so to jniLibs...');
        extractLibs();
      });
    });
  }).on('error', err => console.error('Error downloading:', err));
}

function extractLibs() {
  const fd = fs.openSync(ZIP_DEST, 'r');
  const stat = fs.fstatSync(fd);
  const bufferSize = Math.min(stat.size, 65536);
  const buf = Buffer.alloc(bufferSize);
  fs.readSync(fd, buf, 0, bufferSize, stat.size - bufferSize);

  let eocdOffset = -1;
  for (let i = bufferSize - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdBuf = Buffer.alloc(cdSize);
  fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);

  let p = 0;
  while (p < cdSize) {
    if (cdBuf.readUInt32LE(p) !== 0x02014b50) break;
    const method = cdBuf.readUInt16LE(p + 10);
    const compSize = cdBuf.readUInt32LE(p + 20);
    const fnLen = cdBuf.readUInt16LE(p + 28);
    const extraLen = cdBuf.readUInt16LE(p + 30);
    const commLen = cdBuf.readUInt16LE(p + 32);
    const localHeaderOffset = cdBuf.readUInt32LE(p + 42);
    const fn = cdBuf.toString('utf8', p + 46, p + 46 + fnLen);

    if (fn.includes('libnode.so')) {
      const lhBuf = Buffer.alloc(30);
      fs.readSync(fd, lhBuf, 0, 30, localHeaderOffset);
      const lFnLen = lhBuf.readUInt16LE(26);
      const lExtraLen = lhBuf.readUInt16LE(28);
      const dataOffset = localHeaderOffset + 30 + lFnLen + lExtraLen;

      const compData = Buffer.alloc(compSize);
      fs.readSync(fd, compData, 0, compSize, dataOffset);
      const raw = method === 8 ? zlib.inflateRawSync(compData) : compData;

      let abi = 'arm64-v8a';
      if (fn.includes('armeabi-v7a')) abi = 'armeabi-v7a';
      else if (fn.includes('x86_64')) abi = 'x86_64';

      const destPath = path.join(TARGET_JNI, abi, 'libnode.so');
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, raw);
      console.log(`  ✓ Extracted libnode.so for ${abi} (${(raw.length / (1024 * 1024)).toFixed(1)} MB)`);
    }

    p += 46 + fnLen + extraLen + commLen;
  }
  fs.closeSync(fd);
  try { fs.unlinkSync(ZIP_DEST); } catch (e) {}
  console.log('✅ All Android native runtime libraries ready!');
}

download(ZIP_URL);
