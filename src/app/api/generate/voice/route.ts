// ── Edge runtime — runs on CDN nodes, not AWS Lambda ─────────
// CDN IPs bypass Microsoft's Lambda blocklist that causes 403s.
// Native WebSocket is available globally in Deno/Edge runtime.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const TTS_HOST  = 'speech.platform.bing.com';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function synthesize(text: string, voice: string): Promise<Uint8Array> {
  const connId = crypto.randomUUID().replace(/-/g, '').toUpperCase();
  const reqId  = crypto.randomUUID().replace(/-/g, '').toUpperCase();
  const ts     = new Date().toISOString();

  const url =
    `wss://${TTS_HOST}/consumer/speech/synthesize/readaloud/edge/v1` +
    `?TrustedClientToken=${TTS_TOKEN}&ConnectionId=${connId}`;

  return new Promise((resolve, reject) => {
    // Use the globally available WebSocket (Deno / Edge runtime)
    const ws = new WebSocket(url);
    (ws as WebSocket & { binaryType: string }).binaryType = 'arraybuffer';

    const chunks: Uint8Array[] = [];
    let done = false;

    const timer = setTimeout(() => {
      done = true; ws.close();
      reject(new Error('Edge TTS timeout (20s)'));
    }, 20_000);

    ws.onopen = () => {
      // 1 — speech config
      ws.send(
        `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        })
      );

      // 2 — SSML
      const ssml =
        `<speak version='1.0' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody rate='+5%' volume='+10%'>${escapeXml(text)}</prosody>` +
        `</voice></speak>`;

      ws.send(
        `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`
      );
    };

    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') {
        if (e.data.includes('Path:turn.end')) {
          done = true;
          clearTimeout(timer);
          ws.close(1000);
          const total  = chunks.reduce((n, c) => n + c.byteLength, 0);
          const result = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { result.set(c, off); off += c.byteLength; }
          resolve(result);
        }
      } else if (e.data instanceof ArrayBuffer) {
        // Binary frame: [2-byte big-endian header length][header][audio]
        const buf       = new Uint8Array(e.data);
        if (buf.byteLength < 2) return;
        const headerLen = (buf[0] << 8) | buf[1];
        if (buf.byteLength <= 2 + headerLen) return;
        const header    = new TextDecoder().decode(buf.slice(2, 2 + headerLen));
        if (header.includes('Path:audio')) {
          chunks.push(buf.slice(2 + headerLen));
        }
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      if (!done) { done = true; reject(new Error('Edge TTS WebSocket error')); }
    };

    ws.onclose = (e: CloseEvent) => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        reject(new Error(`Edge TTS closed early — code ${e.code}${e.reason ? ': ' + e.reason : ''}`));
      }
    };
  });
}

export async function POST(req: Request) {
  try {
    const { text, voice = 'en-IN-NeerjaNeural' } = await req.json() as {
      text:   string;
      voice?: string;
    };

    if (!text || typeof text !== 'string' || !text.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }

    const audio  = await synthesize(text.trim(), voice);
    const base64 = toBase64(audio);
    return Response.json({ base64, mimeType: 'audio/mpeg' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[voice/edge]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
