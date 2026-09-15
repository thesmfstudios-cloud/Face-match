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

    const { data: photos, error: photoError } = await supabase
      .from('fm_photos')
      .select('id,original_path,preview_path,original_filename,people_count,price,processing_status,created_at')
      .eq('event_id', event.id)
      .order('created_at', { ascending: true });
    if (photoError) throw photoError;

    const originalPrefix = `${event.id}`;
    const { data: originals, error: originalListError } = await supabase.storage
      .from('fm-originals')
      .list(originalPrefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (originalListError) throw originalListError;

    const { data: previews, error: previewListError } = await supabase.storage
      .from('fm-previews')
      .list(originalPrefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
    if (previewListError) throw previewListError;

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
      event,
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
