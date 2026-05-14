import { NextRequest } from 'next/server';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { text, voice = 'en-IN-NeerjaNeural' } = await req.json() as {
      text:   string;
      voice?: string;
    };

    if (!text?.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }

    // Try edge-tts-universal
    const mod = await import('edge-tts-universal' as string);
    const EdgeTTS =
      (mod as Record<string, unknown>).EdgeTTS ??
      ((mod as Record<string, unknown>).default as Record<string, unknown>)?.EdgeTTS ??
      (mod as Record<string, unknown>).default;

    if (!EdgeTTS || typeof (EdgeTTS as { new(): unknown }) !== 'function') {
      throw new Error('edge-tts-universal module not available');
    }

    const tts = new (EdgeTTS as new () => {
      synthesize: (
        text: string,
        voice: string,
        opts: Record<string, string>
      ) => Promise<{ audio?: Uint8Array | Buffer | null }>;
    })();

    const result = await tts.synthesize(text, voice, { rate: '+5%', volume: '+10%' });

    if (!result?.audio) {
      throw new Error('TTS returned no audio');
    }

    const base64 = Buffer.from(result.audio as Uint8Array).toString('base64');

    return Response.json({ base64, mimeType: 'audio/mpeg' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[voice route]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
