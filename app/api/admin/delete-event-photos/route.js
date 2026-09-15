import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const EVENT_SLUG = 'sam-college-2026';
const BUCKETS = ['fm-originals', 'fm-previews'];
const REMOVE_CHUNK = 1000;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration missing.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function checkAdmin(request) {
  const supplied = String(request.headers.get('x-admin-code') || '').trim();
  const expected = String(process.env.ADMIN_ACCESS_CODE || '').trim();
  return supplied && expected && supplied === expected;
}

async function listAllPaths(supabase, bucket, prefix) {
  const paths = [];
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) throw error;
  for (const item of data || []) {
    if (item?.name) paths.push(`${prefix}/${item.name}`);
  }
  return paths;
}

async function removePaths(supabase, bucket, paths) {
  let removed = 0;
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + REMOVE_CHUNK);
    const { error } = await supabase.storage.from(bucket).remove(chunk);
    if (error) throw error;
    removed += chunk.length;
  }
  return removed;
}

export async function POST(request) {
  try {
    if (!checkAdmin(request)) {
      return NextResponse.json({ error: 'Invalid admin access code.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const eventSlug = String(body.eventSlug || '').trim();
    const confirm = body.confirm === true;
    if (eventSlug !== EVENT_SLUG || !confirm) {
      return NextResponse.json({ error: 'Confirmation required.' }, { status: 400 });
    }

    const supabase = getAdminClient();
    const { data: event, error: eventError } = await supabase
      .from('fm_events')
      .select('id,name')
      .eq('slug', EVENT_SLUG)
      .single();
    if (eventError || !event) return NextResponse.json({ error: 'Event not found.' }, { status: 404 });

    const counts = {};
    for (const bucket of BUCKETS) {
      const paths = await listAllPaths(supabase, bucket, event.id);
      counts[bucket] = paths.length;
      await removePaths(supabase, bucket, paths);
    }

    const { error: deleteRowsError } = await supabase.from('fm_photos').delete().eq('event_id', event.id);
    if (deleteRowsError) throw deleteRowsError;

    const { error: updateEventError } = await supabase
      .from('fm_events')
      .update({ photos_count: 0 })
      .eq('id', event.id);
    if (updateEventError) throw updateEventError;

    return NextResponse.json({
      ok: true,
      event: event.name,
      deleted: { originals: counts['fm-originals'] || 0, previews: counts['fm-previews'] || 0 },
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || 'Could not delete event photos.' }, { status: 500 });
  }
}
