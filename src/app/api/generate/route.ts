import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateScript, generateScenes, generateSEO } from '@/lib/ai/script-generator';
import { generateSceneImage, createBlackFrame } from '@/lib/ai/image-generator';
import { generateVoiceover } from '@/lib/tts/voice-generator';
import { renderVideo, SceneInput } from '@/lib/video/renderer';
import type { VideoTone, VideoStyle } from '@/types';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// ── SSE helpers ──────────────────────────────────────────────
function encode(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Route handler ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    stockName:  string;
    ticker:     string;
    stockInfo:  string;      // user-facing name; maps to stockData
    price?:     string;
    change?:    string;
    tone?:      string;
    voice?:     string;
    addMusic?:  boolean;
  };

  const {
    stockName,
    ticker      = '',
    stockInfo,
    price       = '',
    change      = '',
    tone        = 'VIRAL',
    voice       = 'en-IN-NeerjaNeural',
    addMusic    = false,
  } = body;

  if (!stockName?.trim() || !stockInfo?.trim()) {
    return new Response(
      JSON.stringify({ error: 'stockName and stockInfo are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const validTones: VideoTone[] = ['VIRAL', 'AGGRESSIVE', 'PROFESSIONAL', 'EDUCATIONAL', 'URGENT'];
  const safeTone: VideoTone = validTones.includes(tone as VideoTone) ? (tone as VideoTone) : 'VIRAL';
  const safeStyle: VideoStyle = 'DYNAMIC';

  // Work directory
  const jobId   = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workDir = path.join(os.tmpdir(), 'stock-shorts', jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const send = async (event: string, payload: Record<string, unknown> = {}) => {
    try { await writer.write(encode({ event, ...payload })); } catch { /* client gone */ }
  };

  // Run pipeline in background (non-blocking)
  (async () => {
    try {
      // ── 1. Script ──────────────────────────────────────────
      await send('progress', { step: 'Generating script...', pct: 2 });

      // Build a richer stockData string from the inputs
      const stockDataParts = [stockInfo];
      if (price)  stockDataParts.push(`Current price: ${price}`);
      if (change) stockDataParts.push(`Change: ${change}`);
      const stockData = stockDataParts.join('. ');

      const script = await generateScript({
        stockName,
        ticker,
        stockData,
        tone:  safeTone,
        style: safeStyle,
      });

      const allScenes = await generateScenes({
        fullScript: script.fullScript,
        stockName,
        ticker,
        tone:  safeTone,
        style: safeStyle,
        stockData,
      });
      // Cap at 6 scenes to keep generation fast (~30s total in parallel)
      const scenes = allScenes.slice(0, 6);

      const seo = await generateSEO({
        stockName,
        ticker,
        tone:          safeTone,
        keyHighlights: script.keyNumbers || stockData.slice(0, 200),
      });

      await send('progress', { step: 'Script ready', pct: 8 });

      // ── 2. Images — run all in parallel ────────────────────
      await send('progress', { step: `Generating ${scenes.length} images in parallel...`, pct: 10 });

      let completed = 0;
      const imagePaths = await Promise.all(
        scenes.map(async (scene, i) => {
          const imgPath = path.join(workDir, `scene_${i}.jpg`);
          try {
            await generateSceneImage(scene.imagePrompt, imgPath);
          } catch (e) {
            console.error(`[Image ${i}] failed, using black frame:`, e);
            await createBlackFrame(imgPath);
          }
          completed++;
          await send('progress', {
            step: `Generating images (${completed}/${scenes.length})`,
            pct:  10 + Math.round((completed / scenes.length) * 25),
          });
          return imgPath;
        })
      );

      // ── 3. Voiceover ───────────────────────────────────────
      await send('progress', { step: 'Generating voiceover...', pct: 36 });
      const audioPath = path.join(workDir, 'narration.mp3');
      const fullNarration = scenes.map((s) => s.narration).join(' ');
      const { duration: audioDuration } = await generateVoiceover(fullNarration, voice, audioPath);
      await send('progress', { step: 'Voiceover ready', pct: 45 });

      // ── 4. Build per-scene durations ───────────────────────
      const totalChars = scenes.reduce((sum, sc) => sum + sc.narration.length, 0) || 1;
      const sceneInputs: SceneInput[] = scenes.map((sc, i) => ({
        sceneNumber:  sc.sceneNumber,
        imagePath:    imagePaths[i],
        narration:    sc.narration,
        subtitleText: sc.subtitleText,
        duration:     Math.max(3, (sc.narration.length / totalChars) * audioDuration),
        transition:   sc.transition,
      }));

      // ── 5. Render ──────────────────────────────────────────
      await send('progress', { step: 'Rendering video...', pct: 48 });
      const outputPath = path.join(workDir, 'final.mp4');
      const { duration, fileSize } = await renderVideo({
        scenes:             sceneInputs,
        audioPath,
        audioDuration,
        outputPath,
        addBackgroundMusic: addMusic,
        onProgress: async (step, pct) => {
          await send('progress', { step, pct: 48 + Math.round(pct * 0.48) });
        },
      });

      // ── 6. Save metadata ───────────────────────────────────
      fs.writeFileSync(
        path.join(workDir, 'meta.json'),
        JSON.stringify(seo, null, 2)
      );

      // ── 7. Done ────────────────────────────────────────────
      await send('done', {
        jobId,
        videoUrl:    `/api/video?id=${jobId}`,
        duration:    Math.round(duration),
        fileSize,
        title:       seo.title,
        description: seo.description,
        hashtags:    seo.hashtags.join(' '),
        tags:        seo.tags,
      });

    } catch (err) {
      console.error('[generate] pipeline error:', err);
      await send('error', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      try { await writer.close(); } catch { /* ok */ }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
}
