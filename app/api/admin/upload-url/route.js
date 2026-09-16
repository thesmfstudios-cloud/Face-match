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
    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Server Supabase variables are missing.' }, { status: 500 });
    }

    // Admin routes use the server credential for both database and Storage access.
    // This avoids mixing anon/public RLS with privileged upload preparation.
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { eventSlug = 'sam-college-2026', files } = await request.json();
    if (!Array.isArray(files) || !files.length) return NextResponse.json({ error: 'No files requested.' }, { status: 400 });

    const { data: event, error: eventError } = await supabase
      .from('fm_events')
      .select('id,slug')
      .eq('slug', eventSlug)
      .eq('status', 'live')
      .single();

    if (eventError || !event) {
      console.error('Admin upload event lookup failed:', eventError);
      return NextResponse.json({ error: eventError?.message || `Event not found: ${eventSlug}` }, { status: 400 });
    }

    const incoming = files.slice(0, 20).map((f, index) => ({
      ...f,
      index,
      name: String(f.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_'),
      hash: String(f.hash || ''),
    }));
    const hashes = incoming.map((f) => f.hash).filter(Boolean);
    const names = incoming.map((f) => f.name).filter(Boolean);

    const existingHashes = new Set();
    if (hashes.length) {
      const { data, error } = await supabase
        .from('fm_photos')
        .select('file_hash')
        .eq('event_id', event.id)
        .in('file_hash', hashes);
      if (error) throw error;
      (data || []).forEach((row) => row.file_hash && existingHashes.add(row.file_hash));
    }

    const { data: existingNames, error: namesError } = await supabase
      .from('fm_photos')
      .select('original_filename')
      .eq('event_id', event.id)
      .in('original_filename', names);
    if (namesError) throw namesError;
    const existingFilenameSet = new Set((existingNames || []).map((row) => row.original_filename));

    const seenHashes = new Set();
    const uploads = [];
    const skipped = [];
    for (const f of incoming) {
      if ((f.hash && (existingHashes.has(f.hash) || seenHashes.has(f.hash))) || (!f.hash && existingFilenameSet.has(f.name))) {
        skipped.push({
          index: f.index,
          name: f.name,
          reason: existingHashes.has(f.hash) || existingFilenameSet.has(f.name) ? 'already uploaded' : 'duplicate in selection',
        });
        continue;
      }
      if (f.hash) seenHashes.add(f.hash);
      const base = `${event.id}/${crypto.randomUUID()}`;
      const originalPath = `${base}-${f.name}`;
      const previewPath = `${base}-preview.jpg`;
      const original = await supabase.storage.from('fm-originals').createSignedUploadUrl(originalPath);
      if (original.error) throw original.error;
      const preview = await supabase.storage.from('fm-previews').createSignedUploadUrl(previewPath);
      if (preview.error) throw preview.error;
      uploads.push({ index: f.index, name: f.name, fileHash: f.hash || null, originalPath, previewPath, originalToken: original.data.token, previewToken: preview.data.token });
    }

    return NextResponse.json({ ok: true, eventId: event.id, uploads, skipped });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error?.message || 'Could not create upload URLs.' }, { status: 500 });
  }
}
