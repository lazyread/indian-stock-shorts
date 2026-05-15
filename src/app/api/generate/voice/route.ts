import { NextRequest } from 'next/server';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

// ── StreamElements TTS (free, no API key, plain HTTP) ─────────
// Uses Amazon Polly voices via StreamElements' public endpoint.
// Works from serverless/Lambda — no WebSocket, no IP blocking.
const SE_TTS = 'https://api.streamelements.com/kappa/v2/speech';

// Map Edge TTS voice IDs → StreamElements / Amazon Polly voices
const VOICE_MAP: Record<string, string> = {
  'en-IN-NeerjaNeural':  'Raveena',   // Indian English female
  'en-IN-PrabhatNeural': 'Raveena',   // closest Indian English (no male)
  'hi-IN-SwaraNeural':   'Aditi',     // Hindi female
  'hi-IN-MadhurNeural':  'Aditi',     // closest Hindi (no male)
  'en-US-GuyNeural':     'Matthew',   // US male
  'en-US-JennyNeural':   'Joanna',    // US female
};

async function synthesize(text: string, voice: string): Promise<Buffer> {
  const seVoice = VOICE_MAP[voice] ?? 'Matthew';

  // Split into sentences so each URL stays well under length limits
  const raw = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let buf = '';
  for (const s of raw) {
    if ((buf + s).length > 250 && buf) { chunks.push(buf.trim()); buf = s; }
    else buf += s;
  }
  if (buf.trim()) chunks.push(buf.trim());

  const parts: Buffer[] = [];
  for (const chunk of chunks) {
    const url = `${SE_TTS}?voice=${seVoice}&text=${encodeURIComponent(chunk)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal:  AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`TTS request failed (${res.status}): ${await res.text().catch(() => '')}`);
    parts.push(Buffer.from(await res.arrayBuffer()));
  }

  return Buffer.concat(parts);
}

// ── Route handler ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { text, voice = 'en-IN-NeerjaNeural' } = await req.json() as {
      text:   string;
      voice?: string;
    };

    if (!text || typeof text !== 'string' || !text.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }

    const audio  = await synthesize(text.trim(), voice);
    const base64 = audio.toString('base64');
    return Response.json({ base64, mimeType: 'audio/mpeg' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[voice route]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
