// Edge runtime = Netlify CDN node, not AWS Lambda.
// Google TTS works from CDN IPs; Lambda IPs are often blocked.
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

const TTS_BASE =
  'https://translate.google.com/translate_tts' +
  '?ie=UTF-8&client=gtx&ttsspeed=0.9';

function toBase64(data: Uint8Array): string {
  let out = '';
  // Process in 8 KB chunks to avoid call-stack overflow on large audio.
  const CHUNK = 8192;
  for (let i = 0; i < data.length; i += CHUNK) {
    out += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

// Split text into URL-safe chunks.
// We limit raw text to 100 chars because encodeURIComponent can triple byte
// length for Unicode (Hindi Devanagari, ₹ symbol), pushing short strings past
// the effective URL limit we want to stay under (~400 encoded chars).
function splitIntoChunks(text: string): string[] {
  const MAX       = 100;
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let buf = '';

  for (const s of sentences) {
    if (buf.length + s.length > MAX && buf.length > 0) {
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }

  // Append trailing fragment — merge into last chunk if tiny.
  const tail = buf.trim();
  if (tail) {
    if (chunks.length > 0 && tail.length < 20) {
      chunks[chunks.length - 1] += ' ' + tail;
    } else {
      chunks.push(tail);
    }
  }

  return chunks.filter(c => c.length > 0);
}

// Fetch one TTS chunk with a single retry on transient error.
async function fetchChunk(chunk: string, lang: string, idx: number): Promise<Uint8Array> {
  const url = `${TTS_BASE}&q=${encodeURIComponent(chunk)}&tl=${lang}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          // Google rejects requests without a browser User-Agent.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Referer': 'https://translate.google.com/',
          'Accept':  'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) throw new Error(`Google TTS ${res.status} (chunk ${idx + 1})`);

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new Error(`Empty audio from Google TTS (chunk ${idx + 1})`);
      }

      return bytes;

    } catch (err) {
      if (attempt === 2) throw err;
      // Brief back-off before retry.
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // TypeScript path — unreachable.
  throw new Error(`TTS chunk ${idx + 1} exhausted retries`);
}

export async function POST(req: Request) {
  try {
    const { text, voice = 'en-IN-NeerjaNeural' } = await req.json() as {
      text?: string;
      voice?: string;
    };

    if (!text?.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }

    const lang   = LANG_MAP[voice] ?? 'en-IN';
    const chunks = splitIntoChunks(text.trim());

    if (chunks.length === 0) {
      return Response.json({ error: 'No text chunks produced' }, { status: 400 });
    }

    // Fetch all chunks sequentially to avoid rate-limiting.
    const parts: Uint8Array[] = [];
    for (let i = 0; i < chunks.length; i++) {
      parts.push(await fetchChunk(chunks[i], lang, i));
    }

    // Concatenate raw MP3 frames.
    // MP3 is a frame-stream format — per-frame sync bytes allow browsers to
    // decode concatenated segments as a continuous stream.
    const total  = parts.reduce((n, p) => n + p.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { merged.set(p, off); off += p.byteLength; }

    return Response.json({
      base64:   toBase64(merged),
      mimeType: 'audio/mpeg',
      chunks:   chunks.length,
      bytes:    total,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[voice/edge]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
