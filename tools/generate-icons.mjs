import sharp from 'sharp';
import path from 'node:path';

const assetsDir = path.resolve('assets');

function baseIconSvg(size) {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d2d4a"/>
      <stop offset="100%" stop-color="#2d6ea8"/>
    </linearGradient>
    <linearGradient id="drop" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#9be8ff"/>
      <stop offset="100%" stop-color="#1fa5d7"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-opacity="0.25"/>
    </filter>
  </defs>

  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>

  <g opacity="0.22">
    <path d="M170 760 L854 760" stroke="#cdefff" stroke-width="20" stroke-linecap="round"/>
    <path d="M170 640 L854 640" stroke="#cdefff" stroke-width="12" stroke-linecap="round"/>
    <path d="M170 520 L854 520" stroke="#cdefff" stroke-width="8" stroke-linecap="round"/>
    <path d="M170 400 L854 400" stroke="#cdefff" stroke-width="6" stroke-linecap="round"/>
  </g>

  <g filter="url(#shadow)">
    <path d="M512 180 C460 270, 350 380, 350 540 C350 678, 446 780, 512 780 C578 780, 674 678, 674 540 C674 380, 564 270, 512 180 Z"
      fill="url(#drop)"/>
  </g>

  <path d="M390 590 C460 520, 540 650, 634 500" fill="none" stroke="#ffffff" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="392" cy="590" r="22" fill="#ffffff"/>
  <circle cx="507" cy="596" r="22" fill="#ffffff"/>
  <circle cx="634" cy="500" r="22" fill="#ffffff"/>
</svg>
`;
}

function foregroundSvg(size) {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="drop" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#d0f5ff"/>
      <stop offset="100%" stop-color="#43bee8"/>
    </linearGradient>
  </defs>
  <path d="M512 160 C456 256, 336 370, 336 548 C336 704, 445 820, 512 820 C579 820, 688 704, 688 548 C688 370, 568 256, 512 160 Z"
    fill="url(#drop)"/>
  <path d="M384 602 C452 534, 534 664, 640 510" fill="none" stroke="#ffffff" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

function monochromeSvg(size) {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <path d="M512 160 C456 256, 336 370, 336 548 C336 704, 445 820, 512 820 C579 820, 688 704, 688 548 C688 370, 568 256, 512 160 Z"
    fill="#000000"/>
  <path d="M384 602 C452 534, 534 664, 640 510" fill="none" stroke="#ffffff" stroke-width="54" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

function splashSvg(width, height) {
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const logoSize = Math.round(Math.min(width, height) * 0.5);
  const logoHalf = Math.round(logoSize / 2);

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d2d4a"/>
      <stop offset="100%" stop-color="#1a4b7a"/>
    </linearGradient>
    <linearGradient id="drop" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#b8f0ff"/>
      <stop offset="100%" stop-color="#2db4de"/>
    </linearGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="url(#bg)"/>

  <g transform="translate(${cx - logoHalf}, ${cy - logoHalf - 40}) scale(${logoSize / 1024})">
    <path d="M512 180 C460 270, 350 380, 350 540 C350 678, 446 780, 512 780 C578 780, 674 678, 674 540 C674 380, 564 270, 512 180 Z"
      fill="url(#drop)"/>
    <path d="M390 590 C460 520, 540 650, 634 500" fill="none" stroke="#ffffff" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <text x="${cx}" y="${cy + logoHalf + 40}" text-anchor="middle" fill="#d7f3ff" font-size="78" font-family="Arial, Helvetica, sans-serif" font-weight="700">H2oDigiGraph</text>
</svg>
`;
}

async function writePng(fileName, svg, width, height = width) {
  await sharp(Buffer.from(svg))
    .resize(width, height)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(assetsDir, fileName));
}

async function main() {
  await writePng('icon.png', baseIconSvg(1024), 1024, 1024);
  await writePng('favicon.png', baseIconSvg(256), 256, 256);
  await writePng('android-icon-background.png', '<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432"><rect width="432" height="432" fill="#1a4b7a"/></svg>', 432, 432);
  await writePng('android-icon-foreground.png', foregroundSvg(432), 432, 432);
  await writePng('android-icon-monochrome.png', monochromeSvg(432), 432, 432);
  await writePng('splash-icon.png', splashSvg(1242, 2436), 1242, 2436);

  console.log('Icon assets generated in ./assets');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
