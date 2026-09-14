import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ok(request) {
  return Boolean(process.env.ADMIN_ACCESS_CODE && request.headers.get('x-admin-code') === process.env.ADMIN_ACCESS_CODE);
}

export async function GET(request) {
  if (!ok(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase.from('fm_orders').select('id,total,status,utr,selected_photo_ids,created_at,updated_at').order('created_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data || [] });
}

export async function PATCH(request) {
  if (!ok(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id, status } = await request.json();
    if (!id || !['approved', 'rejected'].includes(status)) return NextResponse.json({ error: 'Invalid order update.' }, { status: 400 });
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await supabase.from('fm_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select('id,status').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, order: data });
  } catch (error) {
    return NextResponse.json({ error: error?.message || 'Update failed.' }, { status: 500 });
  }
}
