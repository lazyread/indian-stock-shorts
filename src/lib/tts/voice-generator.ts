import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

// ============================================================
// Generate narration and save to outputPath (local .mp3 file)
// Returns duration in seconds
// ============================================================
export async function generateVoiceover(
  text: string,
  voice: string,
  outputPath: string
): Promise<{ duration: number }> {
  const rawPath = outputPath.replace(/\.mp3$/, '_raw.mp3');

  // ── 1. Try edge-tts-universal npm package ─────────────────
  let generated = false;
  try {
    const mod = await import('edge-tts-universal' as string);
    const EdgeTTS = (mod as any).EdgeTTS ?? (mod as any).default?.EdgeTTS ?? (mod as any).default;
    if (EdgeTTS) {
      const tts = new EdgeTTS();
      const result: { audio?: Uint8Array | Buffer | null } =
        await tts.synthesize(text, voice, { rate: '+5%', volume: '+10%' });
      if (result?.audio) {
        fs.writeFileSync(rawPath, Buffer.from(result.audio as Uint8Array));
        generated = true;
        console.log('[TTS] edge-tts-universal success');
      }
    }
  } catch { /* fall through */ }

  // ── 2. Fallback: Python edge-tts CLI ───────────────────────
  if (!generated) {
    const escaped = text.replace(/"/g, '\\"').replace(/\n/g, ' ');
    await execAsync(
      `edge-tts --voice "${voice}" --text "${escaped}" --write-media "${rawPath}"`,
      { timeout: 60000 }
    );
    console.log('[TTS] Python edge-tts CLI success');
  }

  if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size === 0) {
    throw new Error(
      'Voice generation failed.\n' +
      'Fix: make sure edge-tts-universal is installed (npm install edge-tts-universal) ' +
      'or install the Python fallback (pip3 install edge-tts)'
    );
  }

  // ── 3. Normalize audio loudness ───────────────────────────
  const ff = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await execAsync(
      `${ff} -i "${rawPath}" -filter:a "loudnorm=I=-14:TP=-2:LRA=7" ` +
      `-ar 44100 -ac 1 -b:a 192k -y "${outputPath}"`,
      { timeout: 90000 }
    );
  } catch {
    // If loudnorm fails just copy
    fs.copyFileSync(rawPath, outputPath);
  }

  try { fs.unlinkSync(rawPath); } catch { /* ok */ }

  // ── 4. Get duration ────────────────────────────────────────
  const duration = await getAudioDuration(outputPath);
  return { duration };
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const fp = process.env.FFPROBE_PATH || 'ffprobe';
    const { stdout } = await execAsync(
      `${fp} -v quiet -print_format json -show_streams "${filePath}"`
    );
    const data = JSON.parse(stdout) as { streams?: { codec_type: string; duration?: string }[] };
    const audio = data.streams?.find((s) => s.codec_type === 'audio');
    return parseFloat(audio?.duration ?? '60');
  } catch {
    return 60;
  }
}
