import { NextResponse } from 'next/server';
import { DescribeCollectionCommand, SearchFacesByImageCommand } from '@aws-sdk/client-rekognition';
import { createClient } from '@supabase/supabase-js';
import { getCollectionId, getRekognitionClient } from '../../../lib/aws-rekognition';
import { indexMissingPhotos } from '../../../lib/rekognition-indexer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MATCH_THRESHOLD = 75;
const CUSTOMER_INDEX_BATCH = 10;

async function getEventState(eventSlug) {
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

  const { count: totalPhotos, error: totalError } = await supabase
    .from('fm_photos')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)
    .eq('processing_status', 'ready');
  if (totalError) throw totalError;

  const { count: indexedPhotos, error: indexedError } = await supabase
    .from('fm_photos')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)
    .eq('processing_status', 'ready')
    .not('ai_indexed_at', 'is', null);
  if (indexedError) throw indexedError;

  return { totalPhotos: totalPhotos || 0, indexedPhotos: indexedPhotos || 0 };
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

    let state = await getEventState(eventSlug);
    if (state.totalPhotos > 0 && state.indexedPhotos < state.totalPhotos) {
      try {
        await indexMissingPhotos(eventSlug, {
          limit: CUSTOMER_INDEX_BATCH,
          concurrency: 5,
        });
        state = await getEventState(eventSlug);
      } catch (indexError) {
        console.error('Customer-triggered Rekognition indexing failed:', indexError);
      }

      if (state.indexedPhotos < state.totalPhotos) {
        return NextResponse.json({
          ok: false,
          status: 'indexing',
          indexedPhotos: state.indexedPhotos,
          totalPhotos: state.totalPhotos,
          remainingPhotos: state.totalPhotos - state.indexedPhotos,
          message: `Gallery is still being prepared. ${state.indexedPhotos}/${state.totalPhotos} photos are ready for AI search.`,
        }, { status: 409, headers: { 'Retry-After': '3' } });
      }
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const client = getRekognitionClient();
    const collectionId = getCollectionId(eventSlug);

    try {
      await client.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
    } catch (error) {
      if (error?.name === 'ResourceNotFoundException') {
        try {
          const build = await indexMissingPhotos(eventSlug, {
            limit: CUSTOMER_INDEX_BATCH,
            concurrency: 5,
          });
          state = {
            totalPhotos: build.totalReady || state.totalPhotos,
            indexedPhotos: build.indexedTotal || 0,
          };
        } catch (indexError) {
          console.error('Customer-triggered Rekognition collection bootstrap failed:', indexError);
        }
        return NextResponse.json({
          ok: false,
          status: 'indexing',
          indexedPhotos: state.indexedPhotos,
          totalPhotos: state.totalPhotos,
          remainingPhotos: Math.max(0, state.totalPhotos - state.indexedPhotos),
          message: 'Gallery AI index is starting. Please retry in a few seconds.',
        }, { status: 409, headers: { 'Retry-After': '3' } });
      }
      throw error;
    }

    const response = await search(client, collectionId, bytes);
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
      indexedPhotos: state.indexedPhotos,
      totalPhotos: state.totalPhotos,
    });
  } catch (error) {
    console.error('Rekognition face match failed:', error);
    const name = error?.name || '';
    if (name === 'InvalidParameterException') {
      return NextResponse.json({ error: 'No clear face was detected in the selfie.' }, { status: 422 });
    }
    if (name === 'ResourceNotFoundException') {
      return NextResponse.json({ error: 'AI gallery index is not ready yet. Please try again shortly.' }, { status: 409 });
    }
    return NextResponse.json({ error: error?.message || 'Face matching failed.' }, { status: 500 });
  }
}
