import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const orderId = params?.orderId;
    if (!orderId) return NextResponse.json({ error: 'Missing order ID.' }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );

    const { data: order, error } = await supabase
      .from('fm_orders')
      .select('id,status,total,selected_photo_ids,updated_at')
      .eq('id', orderId)
      .single();

    if (error || !order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json({ error: error?.message || 'Could not check order status.' }, { status: 500 });
  }
}
