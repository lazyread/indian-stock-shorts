import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/youtube';

export function GET() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'YouTube credentials not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env.local' }, { status: 503 });
  }
  return NextResponse.json({ url: getAuthUrl() });
}
