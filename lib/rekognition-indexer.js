import { CreateCollectionCommand, DescribeCollectionCommand, IndexFacesCommand } from '@aws-sdk/client-rekognition';
import { createClient } from '@supabase/supabase-js';
import { getCollectionId, getRekognitionClient } from './aws-rekognition';

const DEFAULT_CONCURRENCY = 5;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase server configuration is missing.');
  return createClient(url, serviceKey, { auth: { persistSession: false } });
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

export async function indexMissingPhotos(eventSlug, { limit = 25, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const supabase = getSupabase();
  const client = getRekognitionClient();
  const collectionId = getCollectionId(eventSlug);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 25));

  const { data: event, error: eventError } = await supabase
    .from('fm_events')
    .select('id')
    .eq('slug', eventSlug)
    .single();
  if (eventError || !event) throw new Error('Event not found.');

  const { count: totalReady, error: totalError } = await supabase
    .from('fm_photos')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)
    .eq('processing_status', 'ready');
  if (totalError) throw totalError;

  const { count: indexedReadyBefore, error: indexedCountError } = await supabase
    .from('fm_photos')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)
    .eq('processing_status', 'ready')
    .not('ai_indexed_at', 'is', null);
  if (indexedCountError) throw indexedCountError;

  await ensureCollection(client, collectionId);

  const { data: photos, error: photosError } = await supabase
    .from('fm_photos')
    .select('id,preview_path')
    .eq('event_id', event.id)
    .eq('processing_status', 'ready')
    .is('ai_indexed_at', null)
    .order('created_at', { ascending: true })
    .limit(safeLimit);
  if (photosError) throw photosError;

  const results = await mapWithConcurrency(photos || [], async (photo) => {
    try {
      if (!photo.preview_path) throw new Error('Preview file is missing.');
      const { data: file, error: downloadError } = await supabase.storage
        .from('fm-previews')
        .download(photo.preview_path);
      if (downloadError || !file) throw new Error(downloadError?.message || 'Could not read preview.');

      const indexed = await client.send(new IndexFacesCommand({
        CollectionId: collectionId,
        Image: { Bytes: Buffer.from(await file.arrayBuffer()) },
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
        .eq('id', photo.id)
        .is('ai_indexed_at', null);
      if (markError) throw markError;

      return { photoId: photo.id, indexedFaces, unindexedFaces };
    } catch (error) {
      const message = error?.message || 'Indexing failed.';
      await supabase.from('fm_photos').update({ ai_index_error: message }).eq('id', photo.id);
      return { photoId: photo.id, error: message };
    }
  }, concurrency);

  const successfulPhotos = results.filter((item) => !item.error).length;
  const failedPhotos = results.filter((item) => item.error).length;
  const indexedFaces = results.reduce((sum, item) => sum + Number(item.indexedFaces || 0), 0);
  const indexedTotal = Math.min(Number(totalReady || 0), Number(indexedReadyBefore || 0) + successfulPhotos);
  const remaining = Math.max(0, Number(totalReady || 0) - indexedTotal);

  return {
    eventSlug,
    collectionId,
    batchSize: results.length,
    indexedPhotos: successfulPhotos,
    indexedFaces,
    failedPhotos,
    totalReady: totalReady || 0,
    indexedTotal,
    remaining,
    done: remaining === 0,
    results,
  };
}
