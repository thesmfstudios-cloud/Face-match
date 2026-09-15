import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function auth(request) {
  const expected = process.env.ADMIN_ACCESS_CODE;
  const supplied = request.headers.get('x-admin-code');
  return Boolean(expected && supplied && supplied === expected);
}

function bytesFromObject(object) {
  const size = object?.metadata?.size ?? object?.metadata?.contentLength ?? object?.metadata?.['content-length'];
  const parsed = Number(size);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function listAll(supabase, bucket, prefix) {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

async function reconcileStorage(supabase, eventId, originals, previews) {
  const prefix = eventId;
  const previewSet = new Set((previews || []).map((object) => object?.name).filter(Boolean));
  const { data: existing, error: existingError } = await supabase.from('fm_photos').select('original_path').eq('event_id', eventId);
  if (existingError) throw existingError;
  const existingSet = new Set((existing || []).map((row) => row.original_path));
  const rows = [];

  for (const object of originals || []) {
    const name = String(object?.name || '');
    if (!name || name.length < 38) continue;
    const originalPath = `${prefix}/${name}`;
    if (existingSet.has(originalPath)) continue;

    const uuidPart = name.slice(0, 36);
    const previewName = `${uuidPart}-preview.jpg`;
    const previewPath = previewSet.has(previewName) ? `${prefix}/${previewName}` : null;
    const filename = name.slice(37) || name;

    rows.push({
      event_id: eventId,
      original_path: originalPath,
      preview_path: previewPath,
      original_filename: filename,
      people_count: 1,
      price: 5,
      processing_status: previewPath ? 'ready' : 'failed',
    });
  }

  let inserted = 0;
  if (rows.length) {
    const { data, error } = await supabase.from('fm_photos').insert(rows).select('id');
    if (error) throw error;
    inserted = data?.length || 0;
  }

  if (inserted || existingSet.size !== originals.length) {
    const { error: refreshError } = await supabase.rpc('fm_refresh_event_photo_count', { p_event_id: eventId });
    if (refreshError) console.error(refreshError);
  }

  return inserted;
}

export async function GET(request) {
  try {
    if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return NextResponse.json({ error: 'Server Supabase variables are missing.' }, { status: 500 });

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const eventSlug = request.nextUrl.searchParams.get('eventSlug') || 'sam-college-2026';

    const { data: event, error: eventError } = await supabase
      .from('fm_events')
      .select('id,slug,name,photos_count')
      .eq('slug', eventSlug)
      .single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found.' }, { status: 400 });

    const originalPrefix = `${event.id}`;
    const [originals, previews] = await Promise.all([
      listAll(supabase, 'fm-originals', originalPrefix),
      listAll(supabase, 'fm-previews', originalPrefix),
    ]);

    await reconcileStorage(supabase, event.id, originals, previews);

    const { data: photos, error: photoError } = await supabase
      .from('fm_photos')
      .select('id,original_path,preview_path,original_filename,people_count,price,processing_status,created_at')
      .eq('event_id', event.id)
      .order('created_at', { ascending: true });
    if (photoError) throw photoError;

    const originalBytes = (originals || []).reduce((sum, object) => sum + bytesFromObject(object), 0);
    const previewBytes = (previews || []).reduce((sum, object) => sum + bytesFromObject(object), 0);
    const usedBytes = originalBytes + previewBytes;

    const quotaGb = Number(process.env.SUPABASE_STORAGE_LIMIT_GB || 0);
    const quotaBytes = quotaGb > 0 ? quotaGb * 1024 * 1024 * 1024 : 0;
    const remainingBytes = quotaBytes > 0 ? Math.max(0, quotaBytes - usedBytes) : null;

    const mapped = (photos || []).map((photo) => ({
      ...photo,
      preview_url: photo.preview_path
        ? supabase.storage.from('fm-previews').getPublicUrl(photo.preview_path).data.publicUrl
        : null,
    }));

    return NextResponse.json({
      ok: true,
      event: { ...event, photos_count: mapped.length },
      photos: mapped,
      storage: {
        originals: { count: originals?.length || 0, bytes: originalBytes },
        previews: { count: previews?.length || 0, bytes: previewBytes },
        used_bytes: usedBytes,
        quota_bytes: quotaBytes || null,
        remaining_bytes: remainingBytes,
        quota_configured: quotaBytes > 0,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error?.message || 'Could not load photo library.' }, { status: 500 });
  }
}
