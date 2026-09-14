import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  try {
    const orderId = params?.orderId;
    const photoId = new URL(request.url).searchParams.get('photoId');
    if (!orderId || !photoId) return NextResponse.json({ error: 'Missing order or photo.' }, { status: 400 });

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: order, error: orderError } = await supabase.from('fm_orders').select('id,status,selected_photo_ids').eq('id', orderId).single();
    if (orderError || !order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    if (!['approved','fulfilled'].includes(order.status)) return NextResponse.json({ error: 'Payment is not approved yet.' }, { status: 403 });
    if (!Array.isArray(order.selected_photo_ids) || !order.selected_photo_ids.includes(photoId)) return NextResponse.json({ error: 'Photo is not part of this order.' }, { status: 403 });

    const { data: photo, error: photoError } = await supabase.from('fm_photos').select('original_path').eq('id', photoId).single();
    if (photoError || !photo) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });
    const { data: signed, error: signedError } = await supabase.storage.from('fm-originals').createSignedUrl(photo.original_path, 300);
    if (signedError) return NextResponse.json({ error: signedError.message }, { status: 500 });
    return NextResponse.redirect(signed.signedUrl);
  } catch (error) {
    return NextResponse.json({ error: error?.message || 'Could not create download.' }, { status: 500 });
  }
}
