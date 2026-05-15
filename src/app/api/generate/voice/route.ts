import { NextRequest } from 'next/server';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const edgeTtsModule = require('edge-tts-universal');
const EdgeTTSClass: new () => {
  synthesize: (
    text: string,
    voice: string,
    opts: Record<string, string>
  ) => Promise<{ audio?: Uint8Array | Buffer | null }>;
} = edgeTtsModule.EdgeTTS ?? edgeTtsModule.default?.EdgeTTS ?? edgeTtsModule.default;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { text?: unknown; voice?: string };
    const text  = typeof body.text === 'string' ? body.text : String(body.text ?? '');
    const voice = typeof body.voice === 'string' ? body.voice : 'en-IN-NeerjaNeural';

    if (!text.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }

    if (!EdgeTTSClass || typeof EdgeTTSClass !== 'function') {
      throw new Error('edge-tts-universal could not be loaded');
    }

    const tts    = new EdgeTTSClass();
    const result = await tts.synthesize(text, voice, { rate: '+5%', volume: '+10%' });

    if (!result?.audio) {
      throw new Error('TTS returned no audio data');
    }

    const base64 = Buffer.from(result.audio as Uint8Array).toString('base64');
    return Response.json({ base64, mimeType: 'audio/mpeg' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[voice route]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
