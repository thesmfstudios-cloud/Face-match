import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const body = await request.json();
    const eventSlug = String(body.eventSlug || '');
    const photoIds = Array.isArray(body.selectedPhotoIds) ? body.selectedPhotoIds.filter(Boolean) : [];
    const utr = String(body.utr || '').trim();
    const total = Number(body.total || 0);
    if (!eventSlug || !photoIds.length || !utr || !Number.isFinite(total) || total <= 0) {
      return NextResponse.json({ error: 'Invalid payment submission.' }, { status: 400 });
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return NextResponse.json({ error: 'Supabase configuration missing.' }, { status: 500 });
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data: event, error: eventError } = await supabase.from('fm_events').select('id').eq('slug', eventSlug).eq('status', 'live').single();
    if (eventError || !event) return NextResponse.json({ error: 'Event unavailable.' }, { status: 400 });
    const { data: order, error } = await supabase.from('fm_orders').insert({
      event_id: event.id,
      total,
      utr,
      selected_photo_ids: photoIds,
      status: 'payment_submitted',
    }).select('id,status,total,utr,created_at').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json({ error: error?.message || 'Could not submit order.' }, { status: 500 });
  }
}
