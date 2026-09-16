import sharp from 'sharp';

const TARGET_BYTES = 5 * 1024;
const MAX_BYTES = 8 * 1024;
const START_WIDTH = 700;
const MIN_WIDTH = 220;
const BLUR_RADIUS = 18;

export async function createCustomerPreview(input) {
  let width = START_WIDTH;
  let quality = 42;
  let best = null;

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const output = await sharp(input)
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .blur(BLUR_RADIUS)
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();

    best = output;
    if (output.length <= TARGET_BYTES) return output;

    if (quality > 20) {
      quality -= 2;
    } else {
      width = Math.max(MIN_WIDTH, Math.round(width * 0.78));
      quality = 36;
    }
  }

  return best;
}
