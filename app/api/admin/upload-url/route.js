import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    const { eventSlug = 'sam-college-2026', files } = await request.json();
    if (!Array.isArray(files) || !files.length) return NextResponse.json({ error: 'No files requested.' }, { status: 400 });

    const { data: event, error: eventError } = await supabase.from('fm_events').select('id,slug').eq('slug', eventSlug).single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found.' }, { status: 400 });

    const uploads = [];
    for (const f of files.slice(0, 20)) {
      const safeName = String(f.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
      const base = `${event.id}/${crypto.randomUUID()}`;
      const originalPath = `${base}-${safeName}`;
      const previewPath = `${base}-preview.jpg`;
      const original = await supabase.storage.from('fm-originals').createSignedUploadUrl(originalPath);
      if (original.error) throw original.error;
      const preview = await supabase.storage.from('fm-previews').createSignedUploadUrl(previewPath);
      if (preview.error) throw preview.error;
      uploads.push({ name: safeName, originalPath, previewPath, originalToken: original.data.token, previewToken: preview.data.token });
    }
    return NextResponse.json({ ok: true, eventId: event.id, uploads });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error?.message || 'Could not create upload URLs.' }, { status: 500 });
  }
}
