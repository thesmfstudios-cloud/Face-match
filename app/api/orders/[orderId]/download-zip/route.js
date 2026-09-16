import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { zipSync } from 'fflate';

export const runtime = 'nodejs';

const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

function safeFilename(name, fallback) {
  const clean = String(name || fallback)
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return clean || fallback;
}

function uniqueName(name, used) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${n++})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const orderId = resolvedParams?.orderId;
    if (!orderId) return NextResponse.json({ error: 'Missing order.' }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );

    const { data: order, error: orderError } = await supabase
      .from('fm_orders')
      .select('id,status,selected_photo_ids')
      .eq('id', orderId)
      .single();

    if (orderError || !order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    if (!['approved', 'fulfilled'].includes(order.status)) {
      return NextResponse.json({ error: 'Payment is not approved yet.' }, { status: 403 });
    }

    const selectedIds = Array.isArray(order.selected_photo_ids) ? order.selected_photo_ids : [];
    if (!selectedIds.length) return NextResponse.json({ error: 'No photos were selected.' }, { status: 400 });
    if (selectedIds.length > MAX_FILES) return NextResponse.json({ error: 'Too many photos in one download.' }, { status: 400 });

    const { data: photos, error: photosError } = await supabase
      .from('fm_photos')
      .select('id,original_path,original_filename')
      .in('id', selectedIds);

    if (photosError) return NextResponse.json({ error: photosError.message }, { status: 500 });

    const byId = new Map((photos || []).map((photo) => [photo.id, photo]));
    const files = {};
    const usedNames = new Set();
    let totalBytes = 0;

    for (let index = 0; index < selectedIds.length; index++) {
      const photo = byId.get(selectedIds[index]);
      if (!photo?.original_path) return NextResponse.json({ error: 'A selected photo could not be found.' }, { status: 404 });

      const { data: file, error: downloadError } = await supabase.storage
        .from('fm-originals')
        .download(photo.original_path);
      if (downloadError || !file) {
        return NextResponse.json({ error: downloadError?.message || 'Could not read original photo.' }, { status: 500 });
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return NextResponse.json({ error: 'Selected originals are too large for one download. Please select fewer photos.' }, { status: 413 });
      }

      const fallback = `photo-${index + 1}.jpg`;
      const name = uniqueName(safeFilename(photo.original_filename, fallback), usedNames);
      files[name] = bytes;
    }

    const zip = zipSync(files, { level: 0 });
    const body = Buffer.from(zip);
    const filename = `SMF-Photos-${String(orderId).slice(0, 8)}.zip`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(body.byteLength),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || 'Could not prepare photo ZIP.' }, { status: 500 });
  }
}
