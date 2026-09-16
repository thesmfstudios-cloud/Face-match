import { NextResponse } from 'next/server';
import { CreateCollectionCommand, DescribeCollectionCommand, IndexFacesCommand } from '@aws-sdk/client-rekognition';
import { createClient } from '@supabase/supabase-js';
import { getCollectionId, getRekognitionClient } from '../../../../lib/aws-rekognition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const CONCURRENCY = 5;

function authorized(request) {
  const expected = process.env.ADMIN_ACCESS_CODE;
  return Boolean(expected) && request.headers.get('x-admin-code') === expected;
}

async function ensureCollection(client, collectionId) {
  try {
    await client.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
  } catch (error) {
    if (error?.name !== 'ResourceNotFoundException') throw error;
    await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
  }
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

export async function POST(request) {
  try {
    if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const eventSlug = String(body.eventSlug || '');
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

    const { count: totalReady, error: countError } = await supabase
      .from('fm_photos')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('processing_status', 'ready');
    if (countError) throw countError;

    const { count: indexedReady, error: indexedCountError } = await supabase
      .from('fm_photos')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('processing_status', 'ready')
      .not('ai_indexed_at', 'is', null);
    if (indexedCountError) throw indexedCountError;

    const { data: photos, error: photosError } = await supabase
      .from('fm_photos')
      .select('id,preview_path')
      .eq('event_id', event.id)
      .eq('processing_status', 'ready')
      .is('ai_indexed_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (photosError) throw photosError;

    const client = getRekognitionClient();
    const collectionId = getCollectionId(eventSlug);
    await ensureCollection(client, collectionId);

    const results = await mapWithConcurrency(photos || [], async (photo) => {
      try {
        if (!photo.preview_path) throw new Error('Preview file is missing.');

        const { data: file, error: downloadError } = await supabase.storage
          .from('fm-previews')
          .download(photo.preview_path);
        if (downloadError || !file) throw new Error(downloadError?.message || 'Could not read preview.');

        const bytes = Buffer.from(await file.arrayBuffer());
        const indexed = await client.send(new IndexFacesCommand({
          CollectionId: collectionId,
          Image: { Bytes: bytes },
          ExternalImageId: String(photo.id),
          QualityFilter: 'NONE',
          MaxFaces: 100,
          DetectionAttributes: [],
        }));

        const indexedFaces = indexed.FaceRecords?.length || 0;
        const unindexedFaces = indexed.UnindexedFaces?.length || 0;
        const { error: markError } = await supabase
          .from('fm_photos')
          .update({
            ai_indexed_at: new Date().toISOString(),
            ai_indexed_faces: indexedFaces,
            ai_index_error: null,
            people_count: Math.max(1, indexedFaces),
          })
          .eq('id', photo.id);
        if (markError) throw markError;

        return {
          photoId: photo.id,
          indexedFaces,
          unindexedFaces,
        };
      } catch (error) {
        const message = error?.message || 'Indexing failed.';
        await supabase
          .from('fm_photos')
          .update({ ai_index_error: message })
          .eq('id', photo.id);
        return { photoId: photo.id, error: message };
      }
    }, CONCURRENCY);

    const successfulPhotos = results.filter((item) => !item.error).length;
    const indexedFaces = results.reduce((sum, item) => sum + Number(item.indexedFaces || 0), 0);
    const failed = results.filter((item) => item.error).length;
    const indexedTotal = Math.min(Number(totalReady || 0), Number(indexedReady || 0) + successfulPhotos);
    const remaining = Math.max(0, Number(totalReady || 0) - indexedTotal);

    return NextResponse.json({
      ok: true,
      eventSlug,
      collectionId,
      batchSize: results.length,
      indexedPhotos: successfulPhotos,
      indexedFaces,
      failedPhotos: failed,
      totalReady: totalReady || 0,
      indexedTotal,
      remaining,
      done: remaining === 0,
      results,
    });
  } catch (error) {
    console.error('Rekognition indexing failed:', error);
    return NextResponse.json({ error: error?.message || 'Could not build face index.' }, { status: 500 });
  }
}
