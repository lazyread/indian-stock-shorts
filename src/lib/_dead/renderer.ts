import ffmpeg, { FfmpegCommand } from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';

ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH   || '/opt/homebrew/bin/ffmpeg');
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || '/opt/homebrew/bin/ffprobe');

// ============================================================
// Types
// ============================================================

export interface SceneInput {
  sceneNumber:  number;
  imagePath:    string;   // local file path to the JPEG
  narration:    string;
  subtitleText: string;
  duration:     number;
  transition:   string;
}

export interface RenderConfig {
  scenes:              SceneInput[];
  audioPath:           string;
  audioDuration:       number;
  outputPath:          string;
  addBackgroundMusic?: boolean;
  musicVolume?:        number;
  fps?:                number;
  onProgress?:         (step: string, pct: number) => void;
}

// ============================================================
// Promisify fluent-ffmpeg
// ============================================================
function runFFmpeg(cmd: FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd
      .on('end',   () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

// ============================================================
// ASS subtitle file
// ============================================================
function writeSubtitleFile(scenes: SceneInput[], outputPath: string): void {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,3,1,2,60,60,120,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];
  let t = 0;
  for (const scene of scenes) {
    const start = toASSTime(t);
    const end   = toASSTime(t + scene.duration);
    const text  = scene.subtitleText.replace(
      /\b([A-Z]{3,})\b/g,
      '{\\c&H0000FFFF&}$1{\\c&HFFFFFF&}'
    );
    events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
    t += scene.duration;
  }

  fs.writeFileSync(outputPath, [...header, ...events].join('\n'), 'utf-8');
}

function toASSTime(s: number): string {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${pad(m)}:${pad(sc)}.${pad(cs)}`;
}
function pad(n: number): string { return String(n).padStart(2, '0'); }

// ============================================================
// Ken Burns zoom per scene
// ============================================================
async function createKenBurnsSegment(
  imagePath: string,
  duration:  number,
  fps:       number,
  idx:       number,
  outPath:   string
): Promise<void> {
  const frames  = Math.round(duration * fps);
  const zoomIn  = idx % 2 === 0;
  const zf = zoomIn
    ? `zoompan=z='min(zoom+0.0015,1.3)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920`
    : `zoompan=z='if(lte(zoom,1.0),1.3,max(1.001,zoom-0.0015))':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920`;

  try {
    await runFFmpeg(
      ffmpeg()
        .input(imagePath)
        .inputOptions(['-loop', '1'])
        .outputOptions([
          '-vf', `${zf},format=yuv420p`,
          '-t',  String(duration),
          '-r',  String(fps),
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '20',
        ])
        .output(outPath)
    );
  } catch {
    // Fallback: static image
    await runFFmpeg(
      ffmpeg()
        .input(imagePath)
        .inputOptions(['-loop', '1'])
        .outputOptions([
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p',
          '-t',  String(duration),
          '-r',  String(fps),
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '20',
        ])
        .output(outPath)
    );
  }
}

// ============================================================
// Concatenate clip files
// ============================================================
async function concatSegments(segments: string[], outPath: string): Promise<void> {
  const listFile = outPath + '.list.txt';
  fs.writeFileSync(listFile, segments.map((p) => `file '${p}'`).join('\n'));
  await runFFmpeg(
    ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-movflags', '+faststart'])
      .output(outPath)
  );
  fs.unlinkSync(listFile);
}

// ============================================================
// Mix voiceover (+ optional background music)
// ============================================================
async function addAudio(
  videoPath:  string,
  audioPath:  string,
  musicVol:   number,
  workDir:    string
): Promise<string> {
  const out = path.join(workDir, 'with_audio.mp4');
  const cmd = ffmpeg().input(videoPath).input(audioPath);

  const musicFile = process.env.BACKGROUND_MUSIC_PATH
    ? path.join(process.env.BACKGROUND_MUSIC_PATH, 'background.mp3')
    : null;

  if (musicVol > 0 && musicFile && fs.existsSync(musicFile)) {
    cmd
      .input(musicFile)
      .complexFilter([
        '[1:a]volume=1.0[voice]',
        `[2:a]volume=${musicVol}[music]`,
        '[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]',
      ])
      .outputOptions(['-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart']);
  } else {
    cmd.outputOptions(['-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart']);
  }

  await runFFmpeg(cmd.output(out));
  return out;
}

// ============================================================
// Burn subtitles
// ============================================================
async function burnSubs(videoPath: string, subPath: string, workDir: string): Promise<string> {
  const out = path.join(workDir, 'with_subs.mp4');
  const escaped = subPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  try {
    await runFFmpeg(
      ffmpeg()
        .input(videoPath)
        .outputOptions([`-vf`, `ass='${escaped}'`, `-c:v`, 'libx264', `-preset`, 'fast', `-crf`, '18', `-c:a`, 'copy', `-movflags`, '+faststart'])
        .output(out)
    );
  } catch {
    fs.copyFileSync(videoPath, out);
  }
  return out;
}

// ============================================================
// Fade in
// ============================================================
async function addFade(videoPath: string, workDir: string): Promise<string> {
  const out = path.join(workDir, 'with_fade.mp4');
  try {
    await runFFmpeg(
      ffmpeg()
        .input(videoPath)
        .outputOptions(['-vf', 'fade=t=in:st=0:d=0.4', '-af', 'afade=t=in:ss=0:d=0.3', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-movflags', '+faststart'])
        .output(out)
    );
  } catch {
    fs.copyFileSync(videoPath, out);
  }
  return out;
}

// ============================================================
// Final H.264 encode
// ============================================================
async function finalEncode(inputPath: string, outputPath: string): Promise<void> {
  await runFFmpeg(
    ffmpeg()
      .input(inputPath)
      .outputOptions([
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
        '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
  );
}

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (_err, meta) => {
      resolve(meta?.format?.duration ?? 60);
    });
  });
}

// ============================================================
// Main entry point
// ============================================================
export async function renderVideo(config: RenderConfig): Promise<{ duration: number; fileSize: number }> {
  const { scenes, audioPath, outputPath, onProgress } = config;
  const fps      = config.fps ?? 30;
  const musicVol = config.addBackgroundMusic ? (config.musicVolume ?? 0.15) : 0;
  const workDir  = path.dirname(outputPath);

  const segPaths: string[] = [];

  try {
    // 1. Ken Burns per scene
    onProgress?.('Creating slideshow', 5);
    for (let i = 0; i < scenes.length; i++) {
      const segPath = path.join(workDir, `seg_${i}.mp4`);
      await createKenBurnsSegment(scenes[i].imagePath, scenes[i].duration, fps, i, segPath);
      segPaths.push(segPath);
      onProgress?.('Creating slideshow', 5 + Math.round((i / scenes.length) * 30));
    }

    // 2. Concat
    onProgress?.('Concatenating scenes', 36);
    const slideshowPath = path.join(workDir, 'slideshow.mp4');
    await concatSegments(segPaths, slideshowPath);

    // 3. Add audio
    onProgress?.('Mixing audio', 50);
    const withAudio = await addAudio(slideshowPath, audioPath, musicVol, workDir);

    // 4. Burn subtitles
    onProgress?.('Burning subtitles', 65);
    const subPath = path.join(workDir, 'subs.ass');
    writeSubtitleFile(scenes, subPath);
    const withSubs = await burnSubs(withAudio, subPath, workDir);

    // 5. Fade
    onProgress?.('Adding fade', 78);
    const withFade = await addFade(withSubs, workDir);

    // 6. Final encode
    onProgress?.('Final encoding', 85);
    await finalEncode(withFade, outputPath);

    const [duration, stats] = await Promise.all([
      getVideoDuration(outputPath),
      Promise.resolve(fs.statSync(outputPath)),
    ]);

    onProgress?.('Done', 100);
    return { duration, fileSize: stats.size };

  } finally {
    // Clean up intermediate files
    const temp = ['slideshow.mp4', 'with_audio.mp4', 'with_subs.mp4', 'with_fade.mp4', 'subs.ass'];
    [...temp.map((f) => path.join(workDir, f)), ...segPaths].forEach((f) => {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ok */ }
    });
  }
}
