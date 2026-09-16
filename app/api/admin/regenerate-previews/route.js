import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createCustomerPreview } from '../../../../lib/customer-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function auth(request) {
  const expected = process.env.ADMIN_ACCESS_CODE;
  const supplied = request.headers.get('x-admin-code');
  return Boolean(expected && supplied && supplied === expected);
}

export async function POST(request) {
  try {
    if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return NextResponse.json({ error: 'Server Supabase variables are missing.' }, { status: 500 });

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const body = await request.json().catch(() => ({}));
    const eventSlug = String(body.eventSlug || 'sam-college-2026');
    const limit = Math.min(100, Math.max(1, Number(body.limit) || 25));

    const { data: event, error: eventError } = await supabase.from('fm_events').select('id').eq('slug', eventSlug).single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found.' }, { status: 400 });

    const { data: photos, error: photoError } = await supabase
      .from('fm_photos')
      .select('id,original_path,preview_path')
      .eq('event_id', event.id)
      .eq('processing_status', 'ready')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (photoError) throw photoError;

    let processed = 0;
    const errors = [];
    for (const photo of photos || []) {
      try {
        if (!photo.original_path || !photo.preview_path) throw new Error('Photo paths are missing.');
        const { data: original, error: originalError } = await supabase.storage.from('fm-originals').download(photo.original_path);
        if (originalError || !original) throw new Error(originalError?.message || 'Could not read original.');
        const blurredPreview = await createCustomerPreview(Buffer.from(await original.arrayBuffer()));
        const { error: previewError } = await supabase.storage.from('fm-previews').upload(photo.preview_path, blurredPreview, {
          contentType: 'image/jpeg',
          upsert: true,
          cacheControl: '31536000',
        });
        if (previewError) throw previewError;
        processed += 1;
      } catch (error) {
        errors.push({ id: photo.id, error: error?.message || 'Preview regeneration failed.' });
      }
    }

    const { count: totalReady } = await supabase.from('fm_photos').select('id', { count: 'exact', head: true }).eq('event_id', event.id).eq('processing_status', 'ready');
    const { count: remainingBefore } = await supabase.from('fm_photos').select('id', { count: 'exact', head: true }).eq('event_id', event.id).eq('processing_status', 'ready');

    return NextResponse.json({
      ok: true,
      eventSlug,
      requested: limit,
      processed,
      errors,
      totalReady: totalReady || 0,
      note: 'Call this endpoint repeatedly to rewrite the existing public previews. Existing AI indexes are unaffected because Rekognition now indexes private originals.',
      remaining: Math.max(0, Number((totalReady || 0) - processed)),
      remainingBefore,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error?.message || 'Could not regenerate previews.' }, { status: 500 });
  }
}
