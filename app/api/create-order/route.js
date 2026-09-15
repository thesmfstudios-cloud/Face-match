import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration missing.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) throw new Error('Razorpay server configuration missing.');
  return new Razorpay({ key_id, key_secret });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const eventSlug = String(body.eventSlug || '').trim();
    const photoIds = Array.isArray(body.selectedPhotoIds)
      ? [...new Set(body.selectedPhotoIds.filter(Boolean).map(String))]
      : [];
    const groupPhotoIds = new Set(
      Array.isArray(body.groupPhotoIds)
        ? body.groupPhotoIds.filter(Boolean).map(String)
        : []
    );

    if (!eventSlug || !photoIds.length) {
      return NextResponse.json({ error: 'Select at least one photo.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: event, error: eventError } = await supabase
      .from('fm_events')
      .select('id')
      .eq('slug', eventSlug)
      .eq('status', 'live')
      .single();

    if (eventError || !event) return NextResponse.json({ error: 'Event unavailable.' }, { status: 400 });

    const { data: photos, error: photoError } = await supabase
      .from('fm_photos')
      .select('id,processing_status')
      .eq('event_id', event.id)
      .in('id', photoIds);

    if (photoError) return NextResponse.json({ error: photoError.message }, { status: 500 });
    if (!photos || photos.length !== photoIds.length) {
      return NextResponse.json({ error: 'One or more selected photos are unavailable.' }, { status: 400 });
    }
    if (photos.some((photo) => photo.processing_status !== 'ready')) {
      return NextResponse.json({ error: 'One or more selected photos are not ready.' }, { status: 400 });
    }

    const total = photos.reduce((sum, photo) => sum + (groupPhotoIds.has(String(photo.id)) ? 15 : 5), 0);
    const amount = Math.round(total * 100);
    if (!Number.isInteger(amount) || amount < 100) {
      return NextResponse.json({ error: 'Invalid payment amount.' }, { status: 400 });
    }

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt: `smf_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      notes: { event: eventSlug.slice(0, 256), photo_count: String(photoIds.length) },
    });

    return NextResponse.json({ order_id: order.id, amount: order.amount, currency: order.currency });
  } catch (error) {
    const status = Number(error?.statusCode || error?.status || 0);
    const message = error?.error?.description || error?.message || 'Could not create Razorpay order.';
    return NextResponse.json({ error: message }, { status: status === 401 ? 401 : 500 });
  }
}
