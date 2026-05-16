// Edge runtime = Netlify CDN node, not AWS Lambda
// Google TTS works from CDN IPs; Lambda IPs are often blocked
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const LANG_MAP: Record<string, string> = {
  'en-IN-NeerjaNeural':  'en-IN',
  'en-IN-PrabhatNeural': 'en-IN',
  'hi-IN-SwaraNeural':   'hi',
  'hi-IN-MadhurNeural':  'hi',
  'en-US-GuyNeural':     'en-US',
  'en-US-JennyNeural':   'en-US',
};

function toBase64(data: Uint8Array): string {
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < data.length; i += CHUNK) {
    out += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

export async function POST(req: Request) {
  try {
    const { text, voice = 'en-IN-NeerjaNeural' } = await req.json() as {
      text: string; voice?: string;
    };
    if (!text?.trim()) return Response.json({ error: 'text required' }, { status: 400 });

    const lang = LANG_MAP[voice] ?? 'en-IN';

    // Split into ≤180-char sentence chunks (Google TTS URL limit)
    const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
    const chunks: string[] = [];
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).length > 180 && buf) { chunks.push(buf.trim()); buf = s; }
      else buf += s;
    }
    if (buf.trim()) chunks.push(buf.trim());

    const parts: Uint8Array[] = [];
    for (const chunk of chunks) {
      const url =
        `https://translate.google.com/translate_tts` +
        `?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${lang}&client=gtx&ttsspeed=0.9`;

      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Referer': 'https://translate.google.com/',
          'Accept': 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(12_000),
      });

      if (!res.ok) throw new Error(`Google TTS ${res.status}`);
      parts.push(new Uint8Array(await res.arrayBuffer()));
    }

    const total  = parts.reduce((n, p) => n + p.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { merged.set(p, off); off += p.byteLength; }

    return Response.json({ base64: toBase64(merged), mimeType: 'audio/mpeg' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[voice/edge]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
