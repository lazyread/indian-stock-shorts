// Netlify Edge Function (Deno runtime, CDN IPs, 30s wall-clock limit).
// We proxy to Google Translate TTS because:
//   - CDN IPs pass Google's allowlist (Lambda IPs do not)
//   - Browser cannot call translate.google.com directly (no CORS headers)
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

// ── Language map ───────────────────────────────────────────────
const LANG_MAP: Record<string, string> = {
  'en-IN-NeerjaNeural':  'en-IN',
  'en-IN-PrabhatNeural': 'en-IN',
  'hi-IN-SwaraNeural':   'hi',
  'hi-IN-MadhurNeural':  'hi',
  'en-US-GuyNeural':     'en-US',
  'en-US-JennyNeural':   'en-US',
};

// ── Timing budget ─────────────────────────────────────────────
// Netlify Edge wall-clock limit: 30 s.
// We keep 5 s of margin for cold-start + JSON serialisation.
const EDGE_BUDGET_MS  = 25_000;
// Per-chunk timeout.  No retry on timeout — timing out costs the same
// time budget as a second attempt, so we skip and preserve the budget.
const CHUNK_TIMEOUT_MS = 6_000;
// Retry only for non-timeout errors (429, 503 might resolve on retry).
const RETRY_DELAY_MS   = 400;

// ── Chunk splitting ───────────────────────────────────────────
// Raw limit per chunk.  encodeURIComponent triples byte-length for Unicode
// (Hindi, ₹ …) so we cap raw chars conservatively.
// 280 chars raw → ~3 chunks for a typical 150-word English script.
// This keeps total sequential requests ≤ 3–4, well within budget.
const MAX_CHUNK_CHARS = 280;

function splitIntoChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let buf = '';

  for (const s of sentences) {
    if (buf.length + s.length > MAX_CHUNK_CHARS && buf.length > 0) {
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }

  const tail = buf.trim();
  if (tail) {
    // Merge tiny trailing fragment into last chunk rather than making a new one.
    if (chunks.length > 0 && tail.length < 30) {
      chunks[chunks.length - 1] += ' ' + tail;
    } else {
      chunks.push(tail);
    }
  }

  return chunks.filter(c => c.length > 0);
}

// ── Single chunk fetch ────────────────────────────────────────
// Returns null instead of throwing when the chunk fails so the caller can
// collect partial results rather than aborting the whole request.
interface ChunkResult {
  data:    Uint8Array | null;
  error:   string | null;
  ms:      number;
}

async function fetchChunkSafe(
  chunk:      string,
  lang:       string,
  idx:        number,
  deadlineMs: number,   // absolute Date.now() deadline
): Promise<ChunkResult> {
  const t0 = Date.now();

  // Honour both per-chunk timeout and overall deadline.
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) {
    return { data: null, error: 'budget exhausted before chunk started', ms: 0 };
  }

  const effectiveTimeout = Math.min(CHUNK_TIMEOUT_MS, remaining);
  const url =
    'https://translate.google.com/translate_tts' +
    `?ie=UTF-8&client=gtx&ttsspeed=0.9&tl=${lang}` +
    `&q=${encodeURIComponent(chunk)}`;

  let lastError = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    // Re-check deadline before each attempt.
    const budgetLeft = deadlineMs - Date.now();
    if (budgetLeft <= 0) {
      return { data: null, error: 'budget exhausted mid-retry', ms: Date.now() - t0 };
    }

    try {
      const res = await fetch(url, {
        headers: {
          // Google TTS rejects non-browser User-Agents.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Referer': 'https://translate.google.com/',
          'Accept':  'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(Math.min(effectiveTimeout, budgetLeft)),
      });

      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        // On a 429 / 503 it may be worth retrying once; on 4xx others, skip.
        if (res.status === 429 || res.status === 503) {
          if (attempt === 1 && (deadlineMs - Date.now()) > RETRY_DELAY_MS + effectiveTimeout) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
        }
        return { data: null, error: lastError, ms: Date.now() - t0 };
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) {
        lastError = 'empty audio response';
        return { data: null, error: lastError, ms: Date.now() - t0 };
      }

      return { data: bytes, error: null, ms: Date.now() - t0 };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError  = msg;

      // AbortError means we hit the timeout — do NOT retry (costs same time).
      if (msg.includes('AbortError') || msg.includes('signal') || msg.includes('timeout')) {
        return { data: null, error: `timeout after ${effectiveTimeout}ms`, ms: Date.now() - t0 };
      }

      // Network error on attempt 1 — retry once if budget allows.
      if (attempt === 1 && (deadlineMs - Date.now()) > RETRY_DELAY_MS + effectiveTimeout) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }

      return { data: null, error: lastError, ms: Date.now() - t0 };
    }
  }

  return { data: null, error: lastError || 'unknown', ms: Date.now() - t0 };
}

// ── Base64 encoder (chunked to avoid call-stack overflow) ─────
function toBase64(data: Uint8Array): string {
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < data.length; i += CHUNK) {
    out += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

// ── Route handler ─────────────────────────────────────────────
export async function POST(req: Request) {
  const startMs = Date.now();

  try {
    const { text, voice = 'en-IN-NeerjaNeural' } = await req.json() as {
      text?: string;
      voice?: string;
    };

    if (!text?.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }

    const lang     = LANG_MAP[voice] ?? 'en-IN';
    const chunks   = splitIntoChunks(text.trim());
    const deadline = startMs + EDGE_BUDGET_MS;

    if (chunks.length === 0) {
      return Response.json({ error: 'No text chunks produced from input' }, { status: 400 });
    }

    // ── Fetch all chunks sequentially within budget ─────────
    const results: ChunkResult[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const result = await fetchChunkSafe(chunks[i], lang, i, deadline);
      results.push(result);

      // Log timing so the Netlify function log shows progress.
      const elapsed = Date.now() - startMs;
      console.log(
        `[voice] chunk ${i + 1}/${chunks.length}` +
        ` (${chunks[i].length} chars)` +
        ` → ${result.error ?? `${result.data!.byteLength} bytes`}` +
        ` in ${result.ms}ms | total ${elapsed}ms`
      );

      // Hard stop if we are past the deadline regardless of remaining chunks.
      if (Date.now() >= deadline) {
        console.warn(`[voice] budget exhausted after chunk ${i + 1} — stopping early`);
        break;
      }
    }

    // ── Categorise results ────────────────────────────────
    const successful   = results.filter(r => r.data !== null);
    const failed       = results.filter(r => r.data === null);
    const failureLog   = failed.map((r, i) => `chunk ${i}: ${r.error}`);

    if (successful.length === 0) {
      // All chunks failed — give the client a specific error message.
      const reason = results[0]?.error ?? 'unknown';
      console.error('[voice] all chunks failed. First error:', reason);
      return Response.json(
        {
          error:    `Google TTS failed: ${reason}`,
          details:  failureLog,
          chunks:   chunks.length,
          elapsed:  Date.now() - startMs,
        },
        { status: 500 }
      );
    }

    // ── Concatenate successful parts ──────────────────────
    // MP3 is a frame-stream format — concatenated frames decode correctly
    // because each frame has independent sync markers (0xFF 0xFB…).
    const totalBytes = successful.reduce((n, r) => n + r.data!.byteLength, 0);
    const merged     = new Uint8Array(totalBytes);
    let off = 0;
    for (const r of successful) { merged.set(r.data!, off); off += r.data!.byteLength; }

    const partial = failed.length > 0;

    console.log(
      `[voice] done — ${successful.length}/${results.length} chunks OK` +
      ` | ${totalBytes} bytes | partial=${partial}` +
      ` | elapsed=${Date.now() - startMs}ms`
    );

    return Response.json({
      base64:   toBase64(merged),
      mimeType: 'audio/mpeg',
      chunks:   chunks.length,
      ok:       successful.length,
      failed:   failed.length,
      partial,
      bytes:    totalBytes,
      elapsed:  Date.now() - startMs,
      // Surface failure details so the client can log them.
      failureDetails: failureLog.length > 0 ? failureLog : undefined,
    });

  } catch (err: unknown) {
    const msg     = err instanceof Error ? err.message : String(err);
    const elapsed = Date.now() - startMs;
    console.error('[voice] unhandled error:', msg, `(${elapsed}ms)`);
    return Response.json({ error: msg, elapsed }, { status: 500 });
  }
}
