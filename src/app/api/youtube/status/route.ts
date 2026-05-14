import { NextResponse } from 'next/server';
import { loadTokens, getChannelInfo } from '@/lib/youtube';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tokens = loadTokens();
  if (!tokens) {
    return NextResponse.json({ connected: false });
  }
  const channel = await getChannelInfo();
  return NextResponse.json({ connected: true, channel });
}
