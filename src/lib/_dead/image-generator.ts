import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs';

const STABILITY_API   = 'https://api.stability.ai';
const STABILITY_MODEL = 'stable-diffusion-xl-1024-v1-0';

const NEGATIVE_PROMPT =
  'blurry, distorted, low quality, watermark, text overlay, text, words, letters, logo, ugly, deformed, ' +
  'cartoon, anime, drawing, painting, sketch, low resolution, grainy, noise, pixelated, ' +
  'bad anatomy, nsfw, western stock market, NYSE, Wall Street, horizontal, landscape orientation';

function enhancePrompt(base: string): string {
  return `${base}, ultra realistic photorealistic 8k resolution, cinematic lighting, masterpiece, ` +
    'sharp focus, depth of field, professional photography, vertical portrait 9:16 aspect ratio, ' +
    'no text, no watermarks, no logos';
}

// ============================================================
// Generate one scene image and save to outputPath
// ============================================================
export async function generateSceneImage(prompt: string, outputPath: string): Promise<void> {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error('STABILITY_API_KEY not set in .env.local');

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
      steps:        20,
      style_preset: 'photographic',
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept:         'application/json',
        Authorization:  `Bearer ${apiKey}`,
      },
      timeout: 40000,
    }
  );

  if (!response.data?.artifacts?.[0]) throw new Error('No image returned from Stability AI');

  const buffer = Buffer.from(response.data.artifacts[0].base64, 'base64');
  const processed = await sharp(buffer)
    .resize(1080, 1920, { fit: 'cover', position: 'center' })
    .jpeg({ quality: 90, progressive: true })
    .toBuffer();

  fs.writeFileSync(outputPath, processed);
}

// ============================================================
// Black fallback frame (used when image generation fails)
// ============================================================
export async function createBlackFrame(outputPath: string): Promise<void> {
  await sharp({
    create: { width: 1080, height: 1920, channels: 3, background: { r: 8, g: 10, b: 18 } },
  })
    .jpeg({ quality: 90 })
    .toFile(outputPath);
}
