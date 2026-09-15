import { NextResponse } from 'next/server';
import { CreateCollectionCommand, DescribeCollectionCommand, IndexFacesCommand } from '@aws-sdk/client-rekognition';
import { createClient } from '@supabase/supabase-js';
import { getCollectionId, getRekognitionClient } from '../../../../lib/aws-rekognition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function authorized(request) {
  const expected = process.env.ADMIN_ACCESS_CODE;
  return Boolean(expected) && request.headers.get('x-admin-code') === expected;
}

async function ensureCollection(client, collectionId) {
  try {
    await client.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
    return;
  } catch (error) {
    if (error?.name !== 'ResourceNotFoundException') throw error;
    await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
  }
}

export async function POST(request) {
  try {
    if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const eventSlug = String(body.eventSlug || '');
    const offset = Math.max(0, Number(body.offset || 0));
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit || DEFAULT_LIMIT)));
    if (!eventSlug) return NextResponse.json({ error: 'Event slug is required.' }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );

    const { data: event, error: eventError } = await supabase
      .from('fm_events')
      .select('id')
      .eq('slug', eventSlug)
      .single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found.' }, { status: 404 });

    const { data: photos, error: photosError, count } = await supabase
      .from('fm_photos')
      .select('id,preview_path,processing_status', { count: 'exact' })
      .eq('event_id', event.id)
      .eq('processing_status', 'ready')
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);
    if (photosError) return NextResponse.json({ error: photosError.message }, { status: 500 });

    const client = getRekognitionClient();
    const collectionId = getCollectionId(eventSlug);
    await ensureCollection(client, collectionId);

    const results = [];
    for (const photo of photos || []) {
      try {
        const { data: file, error: downloadError } = await supabase.storage
          .from('fm-previews')
          .download(photo.preview_path);
        if (downloadError || !file) throw new Error(downloadError?.message || 'Could not read preview.');

        const bytes = Buffer.from(await file.arrayBuffer());
        const indexed = await client.send(new IndexFacesCommand({
          CollectionId: collectionId,
          Image: { Bytes: bytes },
          ExternalImageId: photo.id,
          QualityFilter: 'AUTO',
          MaxFaces: 100,
          DetectionAttributes: [],
        }));

        results.push({
          photoId: photo.id,
          indexedFaces: indexed.FaceRecords?.length || 0,
          unindexedFaces: indexed.UnindexedFaces?.length || 0,
        });
      } catch (error) {
        results.push({ photoId: photo.id, error: error?.message || 'Indexing failed.' });
      }
    }

    const nextOffset = offset + (photos || []).length;
    return NextResponse.json({
      ok: true,
      eventSlug,
      collectionId,
      offset,
      nextOffset,
      batchSize: (photos || []).length,
      totalReady: count || 0,
      done: nextOffset >= (count || 0),
      results,
    });
  } catch (error) {
    console.error('Rekognition indexing failed:', error);
    return NextResponse.json({ error: error?.message || 'Could not build face index.' }, { status: 500 });
  }
}
