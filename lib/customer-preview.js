import sharp from 'sharp';

const START_WIDTH = 900;
const BLUR_RADIUS = 10;
const JPEG_QUALITY = 74;

function watermarkSvg(width, height) {
  const largeSize = Math.max(52, Math.round(Math.min(width, height) * 0.11));
  const smallSize = Math.max(18, Math.round(largeSize * 0.31));
  const lineWidth = Math.round(width * 0.28);
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g text-anchor="middle">
        <text x="50%" y="49%"
          font-family="DejaVu Sans, sans-serif"
          font-size="${largeSize}px"
          font-weight="300"
          letter-spacing="${Math.round(largeSize * 0.18)}px"
          fill="white"
          fill-opacity="0.72">PREVIEW</text>
        <rect x="50%" y="54%" width="${lineWidth}" height="2" rx="1" transform="translate(-50%,0)" fill="white" fill-opacity="0.58"/>
        <text x="50%" y="59%"
          font-family="DejaVu Sans, sans-serif"
          font-size="${smallSize}px"
          font-weight="500"
          letter-spacing="${Math.round(smallSize * 0.32)}px"
          fill="white"
          fill-opacity="0.74">SMF STUDIO</text>
      </g>
    </svg>
  `);
}

export async function createCustomerPreview(input) {
  const base = await sharp(input)
    .rotate()
    .resize({ width: START_WIDTH, height: START_WIDTH, fit: 'inside', withoutEnlargement: true })
    .blur(BLUR_RADIUS)
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
    .toBuffer();

  const meta = await sharp(base).metadata();
  return sharp(base)
    .composite([{ input: watermarkSvg(meta.width || START_WIDTH, meta.height || START_WIDTH) }])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
    .toBuffer();
}
