import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createCustomerPreview } from '../../../../lib/customer-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function adminOk(request) {
  const expected = process.env.ADMIN_ACCESS_CODE;
  const supplied = request.headers.get('x-admin-code');
  return Boolean(expected && supplied && supplied === expected);
}

export async function POST(request) {
  try {
    if (!adminOk(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return NextResponse.json({ error: 'Server Supabase variables are missing.' }, { status: 500 });

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const form = await request.formData();
    const eventSlug = String(form.get('eventSlug') || 'sam-college-2026');
    const files = form.getAll('photos').filter((f) => f && typeof f.arrayBuffer === 'function');
    if (!files.length) return NextResponse.json({ error: 'No photos received.' }, { status: 400 });

    const { data: event, error: eventError } = await supabase.from('fm_events').select('id,slug').eq('slug', eventSlug).single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found. Run the Supabase migration first.' }, { status: 400 });

    const results = [];
    for (const file of files) {
      const safeName = String(file.name || `photo-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const idBase = `${event.id}/${crypto.randomUUID()}`;
      const originalPath = `${idBase}-${safeName}`;
      const previewPath = `${idBase}-preview.jpg`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const preview = await createCustomerPreview(bytes);

      const up = await supabase.storage.from('fm-originals').upload(originalPath, bytes, { contentType: file.type || 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      const pp = await supabase.storage.from('fm-previews').upload(previewPath, preview, { contentType: 'image/jpeg', upsert: false });
      if (pp.error) throw pp.error;

      const { data: row, error: rowError } = await supabase.from('fm_photos').insert({
        event_id: event.id,
        original_path: originalPath,
        preview_path: previewPath,
        original_filename: safeName,
        processing_status: 'ready',
      }).select('id,original_filename,preview_path,price,people_count,processing_status').single();
      if (rowError) throw rowError;
      const { data: publicData } = supabase.storage.from('fm-previews').getPublicUrl(previewPath);
      results.push({ ...row, preview_url: publicData.publicUrl });
    }

    await supabase.rpc('fm_refresh_event_photo_count', { p_event_id: event.id }).catch(() => null);
    return NextResponse.json({ ok: true, count: results.length, photos: results });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error?.message || 'Upload failed.' }, { status: 500 });
  }
}
