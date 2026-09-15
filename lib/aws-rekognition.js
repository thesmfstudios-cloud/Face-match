import { RekognitionClient } from '@aws-sdk/client-rekognition';

const region = process.env.AWS_REGION || 'ap-northeast-1';

export function getRekognitionClient() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Amazon Rekognition is not configured. Add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in Vercel.');
  }
  return new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function getCollectionId(eventSlug) {
  const prefix = (process.env.AWS_REKOGNITION_COLLECTION_PREFIX || 'smf-face').replace(/[^a-zA-Z0-9_.-]/g, '-');
  const slug = String(eventSlug || '').replace(/[^a-zA-Z0-9_.-]/g, '-');
  if (!slug) throw new Error('Missing event slug.');
  return `${prefix}-${slug}`.slice(0, 255);
}
