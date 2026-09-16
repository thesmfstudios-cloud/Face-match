import sharp from 'sharp';

const PREVIEW_WIDTH = 1024;
// Sharp .blur() uses Gaussian sigma. 1.6 gives a soft-focus look while
// keeping faces and the overall composition recognizable.
const BLUR_SIGMA = 1.6;
// Higher JPEG quality avoids compression mushiness and banding because blur
// already reduces the high-frequency detail that would otherwise cost bytes.
const JPEG_QUALITY = 85;

function watermarkSvg(width, height) {
  const largeSize = Math.max(52, Math.round(Math.min(width, height) * 0.085));
  const smallSize = Math.max(18, Math.round(largeSize * 0.28));
  const lineWidth = Math.round(width * 0.30);
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g text-anchor="middle">
        <text x="50%" y="49%"
          font-family="DejaVu Sans, sans-serif"
          font-size="${largeSize}px"
          font-weight="300"
          letter-spacing="${Math.round(largeSize * 0.16)}px"
          fill="white"
          fill-opacity="0.85">PREVIEW</text>
        <rect x="50%" y="54%" width="${lineWidth}" height="2" rx="1" transform="translate(-${lineWidth / 2},0)" fill="white" fill-opacity="0.65"/>
        <text x="50%" y="59%"
          font-family="DejaVu Sans, sans-serif"
          font-size="${smallSize}px"
          font-weight="500"
          letter-spacing="${Math.round(smallSize * 0.30)}px"
          fill="white"
          fill-opacity="0.85">SMF STUDIO</text>
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
