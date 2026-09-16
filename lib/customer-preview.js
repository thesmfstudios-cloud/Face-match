import sharp from 'sharp';

const PREVIEW_WIDTH = 1024;
// Lighter blur keeps the preview more natural and recognizable while still
// removing fine detail that should remain reserved for the paid original.
const BLUR_SIGMA = 1.0;
const JPEG_QUALITY = 85;

// Font rendering is intentionally avoided here. Vercel's server-side SVG
// renderer may not have browser fonts installed, which can turn text glyphs
// into square boxes. These simple vector glyphs are rendered from SVG paths,
// so the watermark is deterministic across environments.
const GLYPHS = {
  P: [[[0, 1], [0, 0], [0.72, 0], [1, 0.18], [1, 0.35], [0.72, 0.5], [0, 0.5]]],
  R: [[[0, 1], [0, 0], [0.72, 0], [1, 0.18], [1, 0.35], [0.72, 0.5], [0, 0.5]], [[0.55, 0.5], [1, 1]]],
  E: [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, 0.5], [0.78, 0.5]]],
  V: [[[0, 0], [0.5, 1], [1, 0]]],
  I: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]], [[0, 1], [1, 1]]],
  W: [[[0, 0], [0.25, 1], [0.5, 0.45], [0.75, 1], [1, 0]]],
  S: [[[1, 0.08], [0.82, 0], [0.18, 0], [0, 0.18], [0, 0.38], [1, 0.62], [1, 0.82], [0.82, 1], [0.18, 1], [0, 0.9]]],
  M: [[[0, 1], [0, 0], [0.5, 0.5], [1, 0], [1, 1]]],
  F: [[[1, 0], [0, 0], [0, 1]], [[0, 0.5], [0.78, 0.5]]],
  T: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]],
  U: [[[0, 0], [0, 0.8], [0.18, 1], [0.82, 1], [1, 0.8], [1, 0]]],
  D: [[[0, 0], [0.68, 0], [1, 0.2], [1, 0.8], [0.68, 1], [0, 1], [0, 0]]],
  O: [[[0.2, 0], [0.8, 0], [1, 0.2], [1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0]]]
};

function vectorTextSvg(text, width, yCenter, targetHeight, strokeWidth, opacity) {
  const unit = targetHeight;
  const glyphGap = targetHeight * 0.22;
  const glyphWidth = targetHeight * 0.72;
  const spaceWidth = targetHeight * 0.42;
  const advance = glyphWidth + glyphGap;
  const textWidth = [...text].reduce((sum, ch) => sum + (ch === ' ' ? spaceWidth : advance), 0) - glyphGap;
  let x = (width - textWidth) / 2;
  let paths = '';

  for (const ch of text) {
    if (ch === ' ') {
      x += spaceWidth;
      continue;
    }

    const strokes = GLYPHS[ch] || [];
    for (const stroke of strokes) {
      const d = stroke.map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${x + px * glyphWidth} ${yCenter - unit / 2 + py * unit}`).join(' ');
      paths += `<path d="${d}" fill="none" stroke="white" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    x += advance;
  }

  return paths;
}

function watermarkSvg(width, height) {
  const mainHeight = Math.max(46, Math.round(Math.min(width, height) * 0.075));
  const subHeight = Math.max(16, Math.round(mainHeight * 0.34));
  const lineWidth = Math.round(width * 0.30);
  const centerY = height * 0.50;

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g>
        ${vectorTextSvg('PREVIEW', width, centerY - mainHeight * 0.18, mainHeight, 2.1, 0.82)}
        <line x1="${(width - lineWidth) / 2}" y1="${centerY + mainHeight * 0.30}" x2="${(width + lineWidth) / 2}" y2="${centerY + mainHeight * 0.30}" stroke="white" stroke-width="2" stroke-opacity="0.62" stroke-linecap="round"/>
        ${vectorTextSvg('SMF STUDIO', width, centerY + mainHeight * 0.66, subHeight, 1.2, 0.82)}
      </g>
    </svg>
  `);
}

export async function createCustomerPreview(input) {
  const base = await sharp(input)
    .rotate()
    .resize({ width: PREVIEW_WIDTH, height: PREVIEW_WIDTH, fit: 'inside', withoutEnlargement: true })
    .blur(BLUR_SIGMA)
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
    .toBuffer();

  const meta = await sharp(base).metadata();
  return sharp(base)
    .composite([{ input: watermarkSvg(meta.width || PREVIEW_WIDTH, meta.height || PREVIEW_WIDTH) }])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
    .toBuffer();
}
