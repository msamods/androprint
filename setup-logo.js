const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const SRC_IMAGE = 'C:\\Users\\user\\.gemini\\antigravity-ide\\brain\\ab8f29fb-d60a-44ae-892a-999ad2cbcbad\\.user_uploaded\\media_1793090505694.jpg';

async function processLogo() {
  console.log("Loading source image:", SRC_IMAGE);
  const image = await Jimp.read(SRC_IMAGE);

  // 1. Save master public logo (512x512 PNG)
  const publicLogoPath = path.join(__dirname, 'public', 'logo.png');
  const logo512 = image.clone().resize({ w: 512, h: 512 });
  await logo512.write(publicLogoPath);
  console.log("Saved master public logo:", publicLogoPath);

  // Save favicon (64x64 PNG)
  const faviconPath = path.join(__dirname, 'public', 'favicon.png');
  const fav64 = image.clone().resize({ w: 64, h: 64 });
  await fav64.write(faviconPath);
  console.log("Saved favicon:", faviconPath);

  // 2. Android drawable app_logo.png (256x256)
  const drawableDir = path.join(__dirname, 'android-app', 'app', 'src', 'main', 'res', 'drawable');
  if (!fs.existsSync(drawableDir)) fs.mkdirSync(drawableDir, { recursive: true });
  const appLogoPath = path.join(drawableDir, 'app_logo.png');
  const logo256 = image.clone().resize({ w: 256, h: 256 });
  await logo256.write(appLogoPath);
  console.log("Saved android app_logo.png:", appLogoPath);

  // 3. Android mipmap icons
  const mipmaps = [
    { dir: 'mipmap-mdpi', size: 48 },
    { dir: 'mipmap-hdpi', size: 72 },
    { dir: 'mipmap-xhdpi', size: 96 },
    { dir: 'mipmap-xxhdpi', size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 }
  ];

  for (const m of mipmaps) {
    const targetDir = path.join(__dirname, 'android-app', 'app', 'src', 'main', 'res', m.dir);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const iconRes = image.clone().resize({ w: m.size, h: m.size });
    await iconRes.write(path.join(targetDir, 'ic_launcher.png'));
    await iconRes.write(path.join(targetDir, 'ic_launcher_round.png'));
    console.log(`Saved ${m.dir} icon (${m.size}x${m.size})`);
  }

  console.log("All logo assets generated successfully!");
}

processLogo().catch(err => {
  console.error("Error processing logo:", err);
  process.exit(1);
});
