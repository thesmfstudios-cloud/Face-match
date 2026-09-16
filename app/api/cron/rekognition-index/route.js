import { NextResponse } from 'next/server';
import { indexMissingPhotos } from '../../../../lib/rekognition-indexer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get('authorization') || '';
  return authorization === `Bearer ${secret}`;
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  try {
    const eventSlug = String(process.env.FACE_MATCH_EVENT_SLUG || 'sam-college-2026');
    const result = await indexMissingPhotos(eventSlug, { limit: 50, concurrency: 5 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('Background Rekognition index worker failed:', error);
    return NextResponse.json({ error: error?.message || 'Background index failed.' }, { status: 500 });
  }
}
