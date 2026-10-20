/**
 * AndroPrint Wiki Sync Utility
 * Developed By : MSA MODS x WhatYouWantKerala
 * 
 * Synchronizes local wiki/ directory with GitHub's repository wiki (androprint.wiki.git)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WIKI_DIR = path.resolve(__dirname, 'wiki');
const TEMP_CLONE = path.join(os.tmpdir(), 'androprint_wiki_sync');

// Get GitHub token from git credentials if available
let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  try {
    const creds = execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8'
    });
    const match = creds.match(/password=(.+)/);
    if (match) token = match[1].trim();
  } catch (e) {}
}

const WIKI_REMOTE = token 
  ? `https://msamods:${token}@github.com/msamods/androprint.wiki.git`
  : 'https://github.com/msamods/androprint.wiki.git';

console.log('🔄 Checking GitHub Wiki remote...');

if (fs.existsSync(TEMP_CLONE)) {
  fs.rmSync(TEMP_CLONE, { recursive: true, force: true });
}

try {
  execSync(`git clone ${WIKI_REMOTE} "${TEMP_CLONE}"`, { stdio: 'inherit' });
  console.log('✅ Cloned GitHub Wiki repo.');

  // Copy all files from wiki/ into temp clone
  const files = fs.readdirSync(WIKI_DIR);
  for (const file of files) {
    fs.copyFileSync(path.join(WIKI_DIR, file), path.join(TEMP_CLONE, file));
    console.log(` -> Copied ${file}`);
  }

  execSync('git config user.name "MSA MODS"', { cwd: TEMP_CLONE });
  execSync('git config user.email "msamods.org@gmail.com"', { cwd: TEMP_CLONE });
  execSync('git add .', { cwd: TEMP_CLONE });
  execSync('git commit -m "docs: sync wiki pages from repo"', { cwd: TEMP_CLONE });
  execSync('git push origin master', { cwd: TEMP_CLONE, stdio: 'inherit' });

  console.log('\n🎉 Successfully synced all wiki pages to GitHub Wiki!');
} catch (e) {
  console.error('\n⚠️ Note: GitHub Wiki repository is not initialized yet.');
  console.log('To activate it:');
  console.log('1. Go to https://github.com/msamods/androprint/wiki');
  console.log('2. Click "Create the first page" and save.');
  console.log('3. Run `node sync-wiki.js` again!\n');
}
