import { NextRequest } from 'next/server';
import axios from 'axios';

export const maxDuration = 25;
export const dynamic = 'force-dynamic';

const STABILITY_API   = 'https://api.stability.ai';
const STABILITY_MODEL = 'stable-diffusion-xl-1024-v1-0';

const NEGATIVE_PROMPT =
  'blurry, distorted, low quality, watermark, text overlay, text, words, letters, logo, ugly, deformed, ' +
  'cartoon, anime, drawing, painting, sketch, low resolution, grainy, noise, pixelated, ' +
  'bad anatomy, nsfw, western stock market, NYSE, Wall Street, horizontal, landscape orientation';

function enhancePrompt(base: string): string {
  return (
    `${base}, ultra realistic photorealistic 8k resolution, cinematic lighting, masterpiece, ` +
    'sharp focus, depth of field, professional photography, vertical portrait 9:16 aspect ratio, ' +
    'no text, no watermarks, no logos'
  );
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, index = 0 } = await req.json() as { prompt: string; index?: number };

    if (!prompt?.trim()) {
      return Response.json({ error: 'prompt is required' }, { status: 400 });
    }

    const apiKey = process.env.STABILITY_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'STABILITY_API_KEY not configured' }, { status: 500 });
    }

    const response = await axios.post(
      `${STABILITY_API}/v1/generation/${STABILITY_MODEL}/text-to-image`,
      {
        text_prompts: [
          { text: enhancePrompt(prompt), weight: 1.0 },
          { text: NEGATIVE_PROMPT,       weight: -1.0 },
        ],
        cfg_scale:    7,
        height:       1344,
        width:        768,
        samples:      1,
        steps:        8,   // 20 → 8: keeps Netlify free-tier under 10s timeout
        style_preset: 'photographic',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept:         'application/json',
          Authorization:  `Bearer ${apiKey}`,
        },
        timeout: 9000,   // hard cap under Netlify's 10s free-tier limit
      }
    );

    if (!response.data?.artifacts?.[0]?.base64) {
      return Response.json({ error: 'No image returned from Stability AI' }, { status: 500 });
    }

    return Response.json({
      base64: response.data.artifacts[0].base64,
      index,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[image route]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
