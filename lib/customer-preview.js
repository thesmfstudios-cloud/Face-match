import sharp from 'sharp';

const TARGET_BYTES = 5 * 1024;
const MAX_BYTES = 8 * 1024;
const START_WIDTH = 700;
const MIN_WIDTH = 220;
const BLUR_RADIUS = 18;

function watermarkSvg(width, height) {
  const fontSize = Math.max(24, Math.round(Math.min(width, height) * 0.09));
  const tracking = Math.max(2, Math.round(fontSize * 0.12));
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>text{font-family:Arial,Helvetica,sans-serif;font-size:${fontSize}px;font-weight:700;letter-spacing:${tracking}px;}</style>
      <text x="50%" y="50%" fill="white" fill-opacity="0.78" text-anchor="middle" dominant-baseline="middle">SMF PHOTO MATCH</text>
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
