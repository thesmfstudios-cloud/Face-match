import sharp from 'sharp';

const TARGET_BYTES = 25 * 1024;
const MAX_BYTES = 35 * 1024;
const START_WIDTH = 900;
const MIN_WIDTH = 420;
const BLUR_RADIUS = 12;

export async function createCustomerPreview(input) {
  let width = START_WIDTH;
  let quality = 48;
  let best = null;

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const output = await sharp(input)
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .blur(BLUR_RADIUS)
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();

    best = output;
    if (output.length <= TARGET_BYTES) return output;

    if (quality > 30) {
      quality -= 3;
    } else {
      width = Math.max(MIN_WIDTH, Math.round(width * 0.82));
      quality = 44;
    }
  }

  return best;
}
