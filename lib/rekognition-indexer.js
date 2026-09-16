import { CreateCollectionCommand, DeleteFacesCommand, DescribeCollectionCommand, IndexFacesCommand, ListFacesCommand } from '@aws-sdk/client-rekognition';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
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
    return await client.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
  } catch (error) {
    if (error?.name !== 'ResourceNotFoundException') throw error;
    await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
    return { FaceCount: 0 };
  }
}

async function clearCollection(client, collectionId) {
  const faceIds = [];
  let nextToken;
  do {
    const page = await client.send(new ListFacesCommand({ CollectionId: collectionId, MaxResults: 1000, NextToken: nextToken }));
    for (const face of page.Faces || []) if (face.FaceId) faceIds.push(face.FaceId);
    nextToken = page.NextToken;
  } while (nextToken);
  for (let i = 0; i < faceIds.length; i += 1000) {
    await client.send(new DeleteFacesCommand({ CollectionId: collectionId, FaceIds: faceIds.slice(i, i + 1000) }));
  }
  return faceIds.length;
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
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const claimId = crypto.randomUUID();

  const { data: event, error: eventError } = await supabase.from('fm_events').select('id').eq('slug', eventSlug).single();
  if (eventError || !event) throw new Error('Event not found.');

  const { count: totalReady, error: totalError } = await supabase.from('fm_photos').select('id', { count: 'exact', head: true }).eq('event_id', event.id).eq('processing_status', 'ready');
  if (totalError) throw totalError;

  const { count: indexedReadyBefore, error: indexedCountError } = await supabase.from('fm_photos').select('id', { count: 'exact', head: true }).eq('event_id', event.id).eq('processing_status', 'ready').not('ai_indexed_at', 'is', null);
  if (indexedCountError) throw indexedCountError;

  const collection = await ensureCollection(client, collectionId);
  if (Number(indexedReadyBefore || 0) === 0 && Number(collection?.FaceCount || 0) > 0) await clearCollection(client, collectionId);

  const { data: photos, error: photosError } = await supabase.rpc('fm_claim_index_batch', { p_event_id: event.id, p_limit: safeLimit, p_claim_id: claimId });
  if (photosError) throw photosError;

  const results = await mapWithConcurrency(photos || [], async (photo) => {
    try {
      if (!photo.original_path) throw new Error('Original file is missing.');
      const { data: file, error: downloadError } = await supabase.storage.from('fm-originals').download(photo.original_path);
      if (downloadError || !file) throw new Error(downloadError?.message || 'Could not read original.');

      const aiImage = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();

      const indexed = await client.send(new IndexFacesCommand({
        CollectionId: collectionId,
        Image: { Bytes: aiImage },
        ExternalImageId: String(photo.id),
        QualityFilter: 'NONE',
        MaxFaces: 100,
        DetectionAttributes: [],
      }));

      const indexedFaces = indexed.FaceRecords?.length || 0;
      const unindexedFaces = indexed.UnindexedFaces?.length || 0;
      const { error: markError } = await supabase.from('fm_photos').update({
        ai_indexed_at: new Date().toISOString(), ai_indexed_faces: indexedFaces, ai_index_error: null, people_count: Math.max(1, indexedFaces),
        ai_index_claimed_at: null, ai_index_claim_id: null,
      }).eq('id', photo.id).eq('ai_index_claim_id', claimId);
      if (markError) throw markError;
      return { photoId: photo.id, indexedFaces, unindexedFaces };
    } catch (error) {
      const message = error?.message || 'Indexing failed.';
      await supabase.from('fm_photos').update({ ai_index_error: message, ai_index_claimed_at: null, ai_index_claim_id: null }).eq('id', photo.id).eq('ai_index_claim_id', claimId);
      return { photoId: photo.id, error: message };
    }
  }, concurrency);

  const successfulPhotos = results.filter((item) => !item.error).length;
  const failedPhotos = results.filter((item) => item.error).length;
  const indexedFaces = results.reduce((sum, item) => sum + Number(item.indexedFaces || 0), 0);
  const { count: indexedTotal } = await supabase.from('fm_photos').select('id', { count: 'exact', head: true }).eq('event_id', event.id).eq('processing_status', 'ready').not('ai_indexed_at', 'is', null);
  const remaining = Math.max(0, Number(totalReady || 0) - Number(indexedTotal || 0));

  return { eventSlug, collectionId, batchSize: results.length, indexedPhotos: successfulPhotos, indexedFaces, failedPhotos, totalReady: totalReady || 0, indexedTotal: indexedTotal || 0, remaining, done: remaining === 0, results };
}
