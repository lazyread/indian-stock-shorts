import { NextRequest } from 'next/server';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

// ── Direct Edge TTS WebSocket implementation ──────────────────
// Bypasses edge-tts-universal entirely — no bundling issues.
// Uses the same protocol that the MS Edge browser uses.
const TTS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
  '?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function synthesizeSpeech(text: string, voice: string): Promise<Buffer> {
  const connectionId = randomUUID().replace(/-/g, '').toUpperCase();
  const requestId    = randomUUID().replace(/-/g, '').toUpperCase();
  const ts           = new Date().toISOString();

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${TTS_URL}&ConnectionId=${connectionId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        Origin:          'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Pragma':        'no-cache',
        'Cache-Control': 'no-cache',
      },
    });

    const audioChunks: Buffer[] = [];
    let finished = false;

    const timeout = setTimeout(() => {
      if (!finished) { ws.terminate(); reject(new Error('Edge TTS timeout after 20s')); }
    }, 20_000);

    ws.on('open', () => {
      // 1 — Speech config
      ws.send(
        `X-Timestamp:${ts}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: false,
                  wordBoundaryEnabled:     false,
                },
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
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${ts}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml
      );
    });

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        // Binary frame: [2-byte header length][header bytes][audio bytes]
        const buf       = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        const headerLen = buf.readUInt16BE(0);
        const header    = buf.slice(2, 2 + headerLen).toString('utf8');
        if (header.includes('Path:audio')) {
          audioChunks.push(buf.slice(2 + headerLen));
        }
      } else {
        // Text frame
        const text = data.toString('utf8');
        if (text.includes('Path:turn.end')) {
          finished = true;
          clearTimeout(timeout);
          ws.close(1000);
          resolve(Buffer.concat(audioChunks));
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('close', (code) => {
      clearTimeout(timeout);
      if (!finished) {
        reject(new Error(`WebSocket closed early (code ${code})`));
      }
    });
  });
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

    const audioBuffer = await synthesizeSpeech(text.trim(), voice);

    if (!audioBuffer.length) {
      return Response.json({ error: 'TTS returned empty audio' }, { status: 500 });
    }

    const base64 = audioBuffer.toString('base64');
    return Response.json({ base64, mimeType: 'audio/mpeg' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[voice route]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
