import { NextResponse } from 'next/server';
import {
  CreateCollectionCommand,
  DescribeCollectionCommand,
  IndexFacesCommand,
  ListFacesCommand,
  SearchFacesByImageCommand,
} from '@aws-sdk/client-rekognition';
import { createClient } from '@supabase/supabase-js';
import { getCollectionId, getRekognitionClient } from '../../../lib/aws-rekognition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MATCH_THRESHOLD = 75;

async function ensureCollection(client, collectionId) {
  try {
    const result = await client.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
    return result;
  } catch (error) {
    if (error?.name !== 'ResourceNotFoundException') throw error;
    await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
    return { FaceCount: 0 };
  }
}

async function getReadyPhotos(eventSlug) {
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

  return { supabase, photos: photos || [] };
}

async function listIndexedPhotoIds(client, collectionId) {
  const ids = new Set();
  let nextToken;

  do {
    const result = await client.send(new ListFacesCommand({
      CollectionId: collectionId,
      MaxResults: 1000,
      NextToken: nextToken,
    }));

    for (const face of result.Faces || []) {
      if (face.ExternalImageId) ids.add(String(face.ExternalImageId));
    }
    nextToken = result.NextToken;
  } while (nextToken);

  return ids;
}

async function indexMissingPhotos(client, collectionId, eventSlug, force = false) {
  const { supabase, photos } = await getReadyPhotos(eventSlug);
  const indexedIds = force ? new Set() : await listIndexedPhotoIds(client, collectionId);
  let indexedPhotos = 0;
  let indexedFaces = 0;
  let failedPhotos = 0;

  for (const photo of photos) {
    if (!photo.preview_path || (!force && indexedIds.has(String(photo.id)))) continue;

    try {
      const { data: file, error: downloadError } = await supabase.storage
        .from('fm-previews')
        .download(photo.preview_path);
      if (downloadError || !file) {
        failedPhotos += 1;
        continue;
      }

      const result = await client.send(new IndexFacesCommand({
        CollectionId: collectionId,
        Image: { Bytes: Buffer.from(await file.arrayBuffer()) },
        ExternalImageId: String(photo.id),
        QualityFilter: 'NONE',
        MaxFaces: 100,
        DetectionAttributes: [],
      }));

      indexedPhotos += 1;
      indexedFaces += result.FaceRecords?.length || 0;
    } catch (error) {
      failedPhotos += 1;
      console.error('Could not index photo', photo.id, error);
    }
  }

  return {
    photos: photos.length,
    indexedPhotos,
    indexedFaces,
    failedPhotos,
  };
}

async function search(client, collectionId, bytes) {
  return client.send(new SearchFacesByImageCommand({
    CollectionId: collectionId,
    Image: { Bytes: bytes },
    FaceMatchThreshold: MATCH_THRESHOLD,
    MaxFaces: 200,
    QualityFilter: 'NONE',
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

    // Make sure the collection exists and contains every currently-ready gallery
    // photo before searching. This fixes the common case where the collection
    // exists but is empty because photos were uploaded after the index was built.
    await ensureCollection(client, collectionId);
    const indexResult = await indexMissingPhotos(client, collectionId, eventSlug);
    if (indexResult.indexedPhotos || indexResult.failedPhotos) {
      console.log('Synced Rekognition index:', { eventSlug, ...indexResult });
    }

    let response = await search(client, collectionId, bytes);

    // If nothing matched, do one full re-index. This handles an index created
    // with older filtering/settings while avoiding a rebuild on every request.
    if (!(response.FaceMatches || []).length) {
      const rebuilt = await indexMissingPhotos(client, collectionId, eventSlug, true);
      console.log('Rebuilt Rekognition index after zero matches:', { eventSlug, ...rebuilt });
      response = await search(client, collectionId, bytes);
    }

    const matches = (response.FaceMatches || [])
      .map((match) => ({
        photoId: match.Face?.ExternalImageId || null,
        similarity: Number(match.Similarity || 0),
      }))
      .filter((match) => match.photoId)
      .sort((a, b) => b.similarity - a.similarity);

    return NextResponse.json({
      ok: true,
      matches,
      threshold: MATCH_THRESHOLD,
      indexedPhotos: indexResult.indexedPhotos,
      indexedFaces: indexResult.indexedFaces,
    });
  } catch (error) {
    console.error('Rekognition face match failed:', error);
    const name = error?.name || '';
    if (name === 'InvalidParameterException') {
      return NextResponse.json({ error: 'No clear face was detected in the selfie.' }, { status: 422 });
    }
    return NextResponse.json({ error: error?.message || 'Face matching failed.' }, { status: 500 });
  }
}
