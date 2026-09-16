import { NextResponse } from 'next/server';
import { indexMissingPhotos } from '../../../../lib/rekognition-indexer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function authorized(request) {
  const expected = process.env.ADMIN_ACCESS_CODE;
  return Boolean(expected) && request.headers.get('x-admin-code') === expected;
}

export async function POST(request) {
  try {
    if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const eventSlug = String(body.eventSlug || '');
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit || DEFAULT_LIMIT)));
    if (!eventSlug) return NextResponse.json({ error: 'Event slug is required.' }, { status: 400 });

    const result = await indexMissingPhotos(eventSlug, { limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('Rekognition indexing failed:', error);
    return NextResponse.json({ error: error?.message || 'Could not build face index.' }, { status: 500 });
  }
}
