import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
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
  return { client: new Razorpay({ key_id, key_secret }), key_secret };
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a || ''), 'hex');
    const right = Buffer.from(String(b || ''), 'hex');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const razorpay_payment_id = String(body.razorpay_payment_id || '').trim();
    const razorpay_order_id = String(body.razorpay_order_id || '').trim();
    const razorpay_signature = String(body.razorpay_signature || '').trim();
    const eventSlug = String(body.eventSlug || '').trim();
    const photoIds = Array.isArray(body.selectedPhotoIds)
      ? [...new Set(body.selectedPhotoIds.filter(Boolean).map(String))]
      : [];
    const groupPhotoIds = new Set(
      Array.isArray(body.groupPhotoIds)
        ? body.groupPhotoIds.filter(Boolean).map(String)
        : []
    );

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !eventSlug || !photoIds.length) {
      return NextResponse.json({ error: 'Missing payment verification fields.' }, { status: 400 });
    }

    const { client: razorpay, key_secret } = getRazorpay();
    const expectedSignature = crypto
      .createHmac('sha256', key_secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (!safeEqualHex(expectedSignature, razorpay_signature)) {
      return NextResponse.json({ error: 'Payment signature verification failed.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: event, error: eventError } = await supabase
      .from('fm_events')
      .select('id,status')
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
    if (!photos || photos.length !== photoIds.length || photos.some((photo) => photo.processing_status !== 'ready')) {
      return NextResponse.json({ error: 'One or more selected photos are unavailable.' }, { status: 400 });
    }

    const total = photos.reduce((sum, photo) => sum + (groupPhotoIds.has(String(photo.id)) ? 15 : 5), 0);
    const expectedAmount = Math.round(total * 100);
    const order = await razorpay.orders.fetch(razorpay_order_id);

    if (!order || Number(order.amount) !== expectedAmount || String(order.currency) !== 'INR') {
      return NextResponse.json({ error: 'Payment amount validation failed.' }, { status: 400 });
    }

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (!payment || String(payment.order_id) !== razorpay_order_id || String(payment.status) !== 'captured') {
      return NextResponse.json({ error: 'Payment is not captured.' }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from('fm_orders')
      .select('id,status,total,selected_photo_ids')
      .eq('utr', razorpay_payment_id)
      .maybeSingle();

    if (existing?.id) return NextResponse.json({ ok: true, order: existing, already_processed: true });

    const { data: localOrder, error: orderError } = await supabase
      .from('fm_orders')
      .insert({
        event_id: event.id,
        total,
        utr: razorpay_payment_id,
        selected_photo_ids: photoIds,
        status: 'approved',
      })
      .select('id,status,total,selected_photo_ids,created_at')
      .single();

    if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      order: localOrder,
      payment_id: razorpay_payment_id,
      razorpay_order_id,
    });
  } catch (error) {
    const message = error?.error?.description || error?.message || 'Could not verify payment.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
