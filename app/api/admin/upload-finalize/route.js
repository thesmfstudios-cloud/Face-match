import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { indexMissingPhotos } from '../../../../lib/rekognition-indexer';

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
    const { eventSlug = 'sam-college-2026', uploads } = await request.json();
    if (!Array.isArray(uploads) || !uploads.length) return NextResponse.json({ ok: true, count: 0, skipped: true, photos: [] });
    const { data: event, error: eventError } = await supabase.from('fm_events').select('id').eq('slug', eventSlug).single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found.' }, { status: 400 });

    const rows = uploads.map((u) => ({
      event_id: event.id,
      original_path: u.originalPath,
      preview_path: u.previewPath,
      original_filename: u.name,
      file_hash: u.fileHash || null,
      processing_status: 'ready',
      people_count: 1,
      price: 5,
    }));

    const { data, error } = await supabase
      .from('fm_photos')
      .insert(rows)
      .select('id,original_filename,preview_path,people_count,price,processing_status');
    if (error) throw error;

    const { error: refreshError } = await supabase.rpc('fm_refresh_event_photo_count', { p_event_id: event.id });
    if (refreshError) throw refreshError;

    // Start indexing immediately, but only for a small batch. The remaining
    // photos continue through the admin AI index page without making a large
    // upload request run for the duration of the whole event.
    let index = null;
    try {
      index = await indexMissingPhotos(eventSlug, { limit: 10, concurrency: 5 });
    } catch (indexError) {
      console.error('Initial Rekognition indexing could not start:', indexError);
      index = { started: false, error: indexError?.message || 'AI indexing could not start yet.' };
    }

    return NextResponse.json({
      ok: true,
      count: data?.length || 0,
      photos: data || [],
      ai: index,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error?.message || 'Could not finalize uploads.' }, { status: 500 });
  }
}
