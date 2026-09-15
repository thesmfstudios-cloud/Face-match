import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function auth(request) {
  const expected = process.env.ADMIN_ACCESS_CODE;
  const supplied = request.headers.get('x-admin-code');
  return Boolean(expected && supplied && supplied === expected);
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

export async function POST(request) {
  try {
    if (!auth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return NextResponse.json({ error: 'Server Supabase variables are missing.' }, { status: 500 });

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { eventSlug = 'sam-college-2026' } = await request.json().catch(() => ({}));
    const { data: event, error: eventError } = await supabase.from('fm_events').select('id').eq('slug', eventSlug).single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found.' }, { status: 400 });

    const prefix = event.id;
    const [originals, previews] = await Promise.all([
      listAll(supabase, 'fm-originals', prefix),
      listAll(supabase, 'fm-previews', prefix),
    ]);

    const previewSet = new Set((previews || []).map((object) => object?.name).filter(Boolean));
    const { data: existing, error: existingError } = await supabase.from('fm_photos').select('original_path').eq('event_id', event.id);
    if (existingError) throw existingError;
    const existingSet = new Set((existing || []).map((row) => row.original_path));

    const rows = [];
    for (const object of originals || []) {
      const name = String(object?.name || '');
      if (!name || name.length < 38) continue;
      const uuidPart = name.slice(0, 36);
      const originalPath = `${prefix}/${name}`;
      if (existingSet.has(originalPath)) continue;

      const previewName = `${uuidPart}-preview.jpg`;
      const previewPath = previewSet.has(previewName) ? `${prefix}/${previewName}` : null;
      const filename = name.slice(37) || name;

      rows.push({
        event_id: event.id,
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

    await supabase.rpc('fm_refresh_event_photo_count', { p_event_id: event.id });

    return NextResponse.json({
      ok: true,
      original_objects: originals.length,
      preview_objects: previews.length,
      inserted,
      existing_rows: existingSet.size,
      photos_without_preview: (originals || []).filter((object) => {
        const name = String(object?.name || '');
        return name.length >= 36 && !previewSet.has(`${name.slice(0, 36)}-preview.jpg`);
      }).length,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error?.message || 'Could not reconcile storage.' }, { status: 500 });
  }
}
