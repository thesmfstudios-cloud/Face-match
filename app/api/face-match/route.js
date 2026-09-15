import { NextResponse } from 'next/server';
import { SearchFacesByImageCommand } from '@aws-sdk/client-rekognition';
import { getCollectionId, getRekognitionClient } from '../../../lib/aws-rekognition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const form = await request.formData();
    const eventSlug = String(form.get('eventSlug') || '');
    const file = form.get('selfie');
    if (!eventSlug || !file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Event and selfie are required.' }, { status: 400 });
    }

    const contentType = String(file.type || 'image/jpeg').toLowerCase();
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(contentType)) {
      return NextResponse.json({ error: 'Please upload a JPG or PNG selfie.' }, { status: 400 });
    }
    if (Number(file.size || 0) > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Selfie is too large. Maximum size is 10 MB.' }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const client = getRekognitionClient();
    const collectionId = getCollectionId(eventSlug);

    const response = await client.send(new SearchFacesByImageCommand({
      CollectionId: collectionId,
      Image: { Bytes: bytes },
      FaceMatchThreshold: 85,
      MaxFaces: 200,
      QualityFilter: 'AUTO',
    }));

    const matches = (response.FaceMatches || [])
      .map((match) => ({
        photoId: match.Face?.ExternalImageId || null,
        similarity: Number(match.Similarity || 0),
      }))
      .filter((match) => match.photoId)
      .sort((a, b) => b.similarity - a.similarity);

    return NextResponse.json({ ok: true, matches });
  } catch (error) {
    console.error('Rekognition face match failed:', error);
    const name = error?.name || '';
    if (name === 'ResourceNotFoundException') {
      return NextResponse.json({ error: 'The event face index has not been built yet.' }, { status: 503 });
    }
    if (name === 'InvalidParameterException') {
      return NextResponse.json({ error: 'No clear face was detected in the selfie.' }, { status: 422 });
    }
    return NextResponse.json({ error: error?.message || 'Face matching failed.' }, { status: 500 });
  }
}
