import { NextResponse } from 'next/server';
import { CreateCollectionCommand, DescribeCollectionCommand, IndexFacesCommand, SearchFacesByImageCommand } from '@aws-sdk/client-rekognition';
import { createClient } from '@supabase/supabase-js';
import { getCollectionId, getRekognitionClient } from '../../../lib/aws-rekognition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ensureCollection(client, collectionId) {
  try {
    await client.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
  } catch (error) {
    if (error?.name !== 'ResourceNotFoundException') throw error;
    await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
  }
}

async function buildIndexIfMissing(client, collectionId, eventSlug) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase server configuration is missing.');

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: event, error: eventError } = await supabase
    .from('fm_events')
    .select('id')
    .eq('slug', eventSlug)
    .single();
  if (eventError || !event) throw new Error('Event not found.');

  const { data: photos, error: photosError } = await supabase
    .from('fm_photos')
    .select('id,preview_path')
    .eq('event_id', event.id)
    .eq('processing_status', 'ready')
    .order('created_at', { ascending: true });
  if (photosError) throw photosError;

  let indexedFaces = 0;
  for (const photo of photos || []) {
    if (!photo.preview_path) continue;
    try {
      const { data: file, error: downloadError } = await supabase.storage
        .from('fm-previews')
        .download(photo.preview_path);
      if (downloadError || !file) continue;
      const result = await client.send(new IndexFacesCommand({
        CollectionId: collectionId,
        Image: { Bytes: Buffer.from(await file.arrayBuffer()) },
        ExternalImageId: photo.id,
        QualityFilter: 'AUTO',
        MaxFaces: 100,
        DetectionAttributes: [],
      }));
      indexedFaces += result.FaceRecords?.length || 0;
    } catch (error) {
      console.error('Could not index photo', photo.id, error);
    }
  }
  return { photos: photos?.length || 0, indexedFaces };
}

async function search(client, collectionId, bytes) {
  return client.send(new SearchFacesByImageCommand({
    CollectionId: collectionId,
    Image: { Bytes: bytes },
    FaceMatchThreshold: 85,
    MaxFaces: 200,
    QualityFilter: 'AUTO',
  }));
}

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

    let response;
    try {
      response = await search(client, collectionId, bytes);
    } catch (error) {
      if (error?.name !== 'ResourceNotFoundException') throw error;
      await ensureCollection(client, collectionId);
      const indexResult = await buildIndexIfMissing(client, collectionId, eventSlug);
      console.log('Auto-built Rekognition index:', { eventSlug, ...indexResult });
      response = await search(client, collectionId, bytes);
    }

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
    if (name === 'InvalidParameterException') {
      return NextResponse.json({ error: 'No clear face was detected in the selfie.' }, { status: 422 });
    }
    return NextResponse.json({ error: error?.message || 'Face matching failed.' }, { status: 500 });
  }
}
