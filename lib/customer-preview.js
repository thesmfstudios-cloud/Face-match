import sharp from 'sharp';

const TARGET_BYTES = 5 * 1024;
const MAX_BYTES = 8 * 1024;
const START_WIDTH = 700;
const MIN_WIDTH = 220;
const BLUR_RADIUS = 14;

function watermarkSvg(width, height) {
  const fontSize = Math.max(28, Math.round(Math.min(width, height) * 0.085));
  const maxTextWidth = Math.round(width * 0.78);
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="11%" y="45%" width="78%" height="10%" rx="${Math.max(8, Math.round(fontSize * 0.28))}" fill="black" fill-opacity="0.28"/>
      <text x="50%" y="50.8%"
        font-family="DejaVu Sans, sans-serif"
        font-size="${fontSize}px"
        font-weight="700"
        fill="white"
        fill-opacity="0.88"
        text-anchor="middle"
        dominant-baseline="middle"
        textLength="${maxTextWidth}"
        lengthAdjust="spacingAndGlyphs">SMF PHOTO MATCH</text>
    </svg>
  `);
}

export async function createCustomerPreview(input) {
  let width = START_WIDTH;
  let quality = 42;
  let best = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const base = await sharp(input)
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .blur(BLUR_RADIUS)
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();

    const meta = await sharp(base).metadata();
    const stamped = await sharp(base)
      .composite([{ input: watermarkSvg(meta.width || width, meta.height || width) }])
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();

    best = stamped;
    if (stamped.length <= TARGET_BYTES) return stamped;

    if (quality > 20) {
      quality -= 2;
    } else {
      width = Math.max(MIN_WIDTH, Math.round(width * 0.78));
      quality = 36;
    }
  }

  return best;
}
