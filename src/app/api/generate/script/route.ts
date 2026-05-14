import { NextRequest } from 'next/server';
import { generateScript, generateScenes, generateSEO } from '@/lib/ai/script-generator';
import type { VideoTone, VideoStyle } from '@/types';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      stockName: string;
      ticker?:   string;
      stockInfo: string;
      price?:    string;
      tone?:     string;
    };

    const { stockName, ticker = '', stockInfo, price = '', tone = 'VIRAL' } = body;

    if (!stockName?.trim() || !stockInfo?.trim()) {
      return Response.json(
        { error: 'stockName and stockInfo are required' },
        { status: 400 }
      );
    }

    const validTones: VideoTone[] = ['VIRAL', 'AGGRESSIVE', 'PROFESSIONAL', 'EDUCATIONAL', 'URGENT'];
    const safeTone: VideoTone = validTones.includes(tone as VideoTone) ? (tone as VideoTone) : 'VIRAL';
    const safeStyle: VideoStyle = 'DYNAMIC';

    const stockData = [stockInfo.trim(), price ? `Current price: ₹${price}` : '']
      .filter(Boolean)
      .join('. ');

    const script = await generateScript({
      stockName,
      ticker,
      stockData,
      tone:  safeTone,
      style: safeStyle,
    });

    const allScenes = await generateScenes({
      fullScript: script.fullScript,
      stockName,
      ticker,
      tone:      safeTone,
      style:     safeStyle,
      stockData,
    });
    const scenes = allScenes.slice(0, 6);

    const seo = await generateSEO({
      stockName,
      ticker,
      tone:          safeTone,
      keyHighlights: script.keyNumbers || stockData.slice(0, 200),
    });

    return Response.json({ script, scenes, seo });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[script route]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
