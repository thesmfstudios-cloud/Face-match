import sharp from 'sharp';

const TARGET_BYTES = 200 * 1024;
const START_WIDTH = 1280;
const MIN_WIDTH = 720;
const BLUR_RADIUS = 4;

export async function createCustomerPreview(input) {
  let width = START_WIDTH;
  let quality = 78;
  let best = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const output = await sharp(input)
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .blur(BLUR_RADIUS)
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();

    best = output;
    if (output.length <= TARGET_BYTES) return output;

    quality -= 5;
    if (quality < 58) {
      quality = 74;
      width = Math.max(MIN_WIDTH, Math.round(width * 0.88));
      if (width === MIN_WIDTH && quality <= 63) break;
    }
  }

  return best;
}
