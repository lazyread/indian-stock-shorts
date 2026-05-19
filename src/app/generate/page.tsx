'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────
interface GeneratedScene {
  sceneNumber:  number;
  narration:    string;
  subtitleText: string;
  imagePrompt:  string;
  duration:     number;
}
interface GeneratedSEO {
  title:       string;
  description: string;
  tags:        string[];
  hashtags:    string[];
}
type StepStatus = 'pending' | 'active' | 'done' | 'warn' | 'error';
interface PipelineStep { id: string; label: string; detail: string; status: StepStatus; elapsed: number | null; }
type Stage = 'idle' | 'generating' | 'rendering' | 'done' | 'error';

// Token used to signal cancellation into the render loop and fetch chain.
interface RunToken { cancelled: boolean; rafId?: number; }

// ── Constants ──────────────────────────────────────────────────
const VOICES = [
  { id: 'en-IN-NeerjaNeural',  label: 'Neerja — Indian Female' },
  { id: 'en-IN-PrabhatNeural', label: 'Prabhat — Indian Male' },
  { id: 'hi-IN-SwaraNeural',   label: 'Swara — Hindi Female' },
  { id: 'hi-IN-MadhurNeural',  label: 'Madhur — Hindi Male' },
  { id: 'en-US-GuyNeural',     label: 'Guy — US Male' },
  { id: 'en-US-JennyNeural',   label: 'Jenny — US Female' },
];
const TONES = [
  { id: 'VIRAL',        label: '🔥 Viral',       desc: 'Shocking hook, curiosity-driven' },
  { id: 'AGGRESSIVE',   label: '🚀 Aggressive',   desc: 'Bold, FOMO-driven, urgent' },
  { id: 'PROFESSIONAL', label: '📊 Professional', desc: 'Analytical, data-driven' },
  { id: 'EDUCATIONAL',  label: '📚 Educational',  desc: 'Clear, beginner-friendly' },
  { id: 'URGENT',       label: '⚡ Urgent',       desc: 'Breaking news style' },
];
const STEPS_DEF: Omit<PipelineStep, 'status' | 'elapsed'>[] = [
  { id: 'script', label: 'Generate Script', detail: 'Template engine builds narration' },
  { id: 'images', label: 'Generate Images', detail: 'Pollinations.ai Turbo — sequential' },
  { id: 'voice',  label: 'Generate Voice',  detail: 'Google TTS proxy (silent fallback)' },
  { id: 'render', label: 'Render Video',    detail: 'Canvas + MediaRecorder (browser)' },
];
function initSteps(): PipelineStep[] {
  return STEPS_DEF.map(s => ({ ...s, status: 'pending', elapsed: null }));
}

// ── Canvas dimensions ──────────────────────────────────────────
const W = 768, H = 1344;

// ── Helpers ────────────────────────────────────────────────────
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (ctx.measureText(candidate).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ── Silent audio buffer — uses AudioBuffer constructor (no AudioContext needed)
// FIX: Previously created a never-closed AudioContext to get sampleRate, hitting
//      the browser's 6-context limit on repeated runs.
function makeSilentBuffer(seconds: number): AudioBuffer {
  const sampleRate = 48000;
  return new AudioBuffer({
    numberOfChannels: 1,
    length: Math.max(1, Math.ceil(seconds * sampleRate)),
    sampleRate,
  });
}

// ── Pollinations image fetch (browser-side) ────────────────────
async function fetchImage(
  prompt: string,
  idx: number,
  signal: AbortSignal,
): Promise<string> {
  const enhanced =
    `${prompt}, photorealistic, cinematic lighting, vertical portrait 9:16, ` +
    `Indian financial context, no text, no logos, no watermarks`;
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}` +
    `?width=768&height=1344&nologo=true&model=turbo&seed=${idx * 17 + 3}`;

  // Honour both the run-level abort signal and a per-request 40s timeout.
  const timeoutSignal = AbortSignal.timeout(40_000);
  const combined = AbortSignal.any
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal; // graceful fallback for older browsers

  const res = await fetch(url, { signal: combined });
  if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);

  const blob    = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  // Draw into an off-screen canvas to strip CORS headers before toDataURL.
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c   = document.createElement('canvas');
        c.width   = W;
        c.height  = H;
        c.getContext('2d')!.drawImage(img, 0, 0, W, H);
        URL.revokeObjectURL(blobUrl);
        resolve(c.toDataURL('image/jpeg', 0.88).split(',')[1]);
      } catch (e) {
        URL.revokeObjectURL(blobUrl);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Image element failed to load blob'));
    };
    img.src = blobUrl;
  });
}

// ── Canvas video renderer ──────────────────────────────────────
// FIX 1: await audioCtx.resume() — AudioContexts created after async hops are
//         auto-suspended by the browser. A suspended context produces silence
//         regardless of what the AudioBufferSourceNode plays. This was the
//         primary cause of no-audio renders.
// FIX 2: try/catch around src.stop() — calling stop() on a source that has
//         already finished naturally throws InvalidStateError, freezing the UI.
// FIX 3: Honour the RunToken.cancelled flag so the caller can abort mid-render.
// FIX 4: Track rafId on the token so cancelAnimationFrame can be called externally.
async function renderVideo(
  scenes:     GeneratedScene[],
  images:     (HTMLImageElement | null)[],
  audioBuffer: AudioBuffer,
  onProgress: (pct: number) => void,
  token:      RunToken,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // ── Audio setup ────────────────────────────────────────────
  const audioCtx = new AudioContext();

  // CRITICAL: Resume the context. AudioContexts created mid-async-chain start
  // suspended. Without this, audioDest.stream produces silence.
  try { await audioCtx.resume(); } catch { /* best-effort; non-fatal */ }

  const src      = audioCtx.createBufferSource();
  src.buffer     = audioBuffer;
  const audioDest = audioCtx.createMediaStreamDestination();
  src.connect(audioDest);

  // ── Stream / recorder setup ────────────────────────────────
  const mimeType = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find(m => MediaRecorder.isTypeSupported(m)) ?? '';

  const videoStream  = canvas.captureStream(30);
  const videoTrack   = videoStream.getVideoTracks()[0];
  const audioTrack   = audioDest.stream.getAudioTracks()[0];

  if (!audioTrack) throw new Error('Browser produced no audio track from AudioContext');

  const stream = new MediaStream([videoTrack, audioTrack]);

  // ── Draw helpers ───────────────────────────────────────────
  function drawScene(scene: GeneratedScene, img: HTMLImageElement | null, t: number): void {
    ctx.clearRect(0, 0, W, H);

    if (img) {
      const z  = 1 + t * 0.08;
      const px = (scene.sceneNumber % 2 === 0 ? 1 : -1) * t * 20;
      ctx.drawImage(img, (W - W * z) / 2 + px, (H - H * z) / 2 - t * 15, W * z, H * z);
    } else {
      ctx.fillStyle = '#08090e';
      ctx.fillRect(0, 0, W, H);
    }

    // Gradient overlay
    const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Subtitle
    ctx.font      = 'bold 44px "Segoe UI",Arial,sans-serif';
    ctx.textAlign = 'center';
    const lines = wrapText(ctx, scene.subtitleText, W - 80);
    const baseY = H - 120 - lines.length * 56;
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur  = 12;
    ctx.fillStyle   = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, baseY + i * 56));
    ctx.shadowBlur  = 0;

    // Scene indicator dots
    const dotR = 3, gap = 10;
    const totalDotW = scenes.length * (dotR * 2 + gap) - gap;
    const sx = (W - totalDotW) / 2;
    for (let i = 0; i < scenes.length; i++) {
      ctx.beginPath();
      ctx.arc(sx + i * (dotR * 2 + gap) + dotR, H - 40, dotR, 0, Math.PI * 2);
      ctx.fillStyle = i === scene.sceneNumber - 1 ? '#fff' : 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
  }

  // ── Main promise ───────────────────────────────────────────
  return new Promise<Blob>((resolve, reject) => {
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = () => {
      audioCtx.close().catch(() => {});
      videoTrack.stop();
      resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
    };

    recorder.onerror = (e: Event) => {
      audioCtx.close().catch(() => {});
      videoTrack.stop();
      const msg = (e instanceof ErrorEvent) ? e.message : 'MediaRecorder error';
      reject(new Error(msg));
    };

    const total    = audioBuffer.duration;
    const perScene = total / scenes.length;
    let t0: number | null = null;
    let lastPct = 0;

    // Unified stop: always guard src.stop() — it throws if the source already
    // ended naturally (InvalidStateError), which is normal for real audio.
    function stopAll(): void {
      if (token.rafId !== undefined) {
        cancelAnimationFrame(token.rafId);
        token.rafId = undefined;
      }
      try { src.stop(); } catch { /* source may have already ended — safe to ignore */ }
      if (recorder.state !== 'inactive') recorder.stop();
    }

    function drawFrame(now: number): void {
      // Check cancellation on every frame.
      if (token.cancelled) {
        stopAll();
        audioCtx.close().catch(() => {});
        videoTrack.stop();
        reject(new Error('Render cancelled'));
        return;
      }

      if (t0 === null) t0 = now;
      const elapsed = (now - t0) / 1000;

      if (elapsed >= total) {
        // Draw the final frame before stopping so the last scene is fully visible.
        drawScene(scenes[scenes.length - 1], images[scenes.length - 1], 1);
        stopAll();
        onProgress(100);
        return; // recorder.onstop will resolve the promise
      }

      const pct = Math.min(99, Math.round((elapsed / total) * 100));
      if (pct > lastPct) { lastPct = pct; onProgress(pct); }

      const si = Math.min(Math.floor(elapsed / perScene), scenes.length - 1);
      const sceneT = (elapsed - si * perScene) / perScene;
      drawScene(scenes[si], images[si], sceneT);

      token.rafId = requestAnimationFrame(drawFrame);
    }

    // Start playback and recording together.
    recorder.start(100);
    src.start(0);
    token.rafId = requestAnimationFrame(drawFrame);
  });
}

// ── UI components ──────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done')   return <span className="text-emerald-400 text-lg leading-none">✓</span>;
  if (status === 'warn')   return <span className="text-yellow-400 text-lg leading-none">⚠</span>;
  if (status === 'active') return <Spinner />;
  if (status === 'error')  return <span className="text-red-400 text-lg leading-none">✗</span>;
  return <span className="w-4 h-4 rounded-full border border-slate-600 inline-block"/>;
}

// ── Page ───────────────────────────────────────────────────────
export default function GeneratePage() {
  const [stockName, setStockName] = useState('');
  const [ticker,    setTicker]    = useState('');
  const [stockInfo, setStockInfo] = useState('');
  const [price,     setPrice]     = useState('');
  const [tone,      setTone]      = useState('VIRAL');
  const [voice,     setVoice]     = useState('en-IN-NeerjaNeural');

  const [stage,     setStage]     = useState<Stage>('idle');
  const [steps,     setSteps]     = useState<PipelineStep[]>(initSteps);
  const [renderPct, setRenderPct] = useState(0);
  const [logs,      setLogs]      = useState<string[]>([]);

  const [videoUrl,  setVideoUrl]  = useState<string | null>(null);
  const [seoData,   setSeoData]   = useState<GeneratedSEO | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);

  // Refs for run lifecycle management
  const stepTimes   = useRef<Record<string, number>>({});
  const abortCtrl   = useRef<AbortController | null>(null);
  const runToken    = useRef<RunToken>({ cancelled: false });
  const videoUrlRef = useRef<string | null>(null); // tracks current URL for cleanup

  // ── Cleanup on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      abortCtrl.current?.abort();
      runToken.current.cancelled = true;
      if (runToken.current.rafId !== undefined) {
        cancelAnimationFrame(runToken.current.rafId);
      }
      if (videoUrlRef.current) {
        URL.revokeObjectURL(videoUrlRef.current);
      }
    };
  }, []);

  const addLog = useCallback((msg: string) =>
    setLogs(p => [...p.slice(-80), `[${new Date().toLocaleTimeString()}] ${msg}`]),
  []);

  const setStep = useCallback((id: string, status: StepStatus) => {
    const now = Date.now();
    setSteps(p => p.map(s => {
      if (s.id !== id) return s;
      const elapsed = (status === 'done' || status === 'warn' || status === 'error')
        && stepTimes.current[id]
        ? now - stepTimes.current[id]
        : s.elapsed;
      return { ...s, status, elapsed };
    }));
    if (status === 'active') stepTimes.current[id] = now;
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockName.trim() || !stockInfo.trim()) {
      toast.error('Stock name and info are required');
      return;
    }

    // ── Cancel any in-progress run ─────────────────────────
    abortCtrl.current?.abort();
    runToken.current.cancelled = true;
    if (runToken.current.rafId !== undefined) {
      cancelAnimationFrame(runToken.current.rafId);
    }

    // Revoke previous video blob URL to free memory.
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }

    // ── New run state ─────────────────────────────────────
    const ac    = new AbortController();
    abortCtrl.current = ac;
    const token: RunToken = { cancelled: false };
    runToken.current = token;

    setStage('generating');
    setSteps(initSteps());
    setLogs([]);
    setVideoUrl(null);
    setSeoData(null);
    setVideoBlob(null);
    setRenderPct(0);
    stepTimes.current = {};

    try {
      // ── 1. Script ─────────────────────────────────────────
      setStep('script', 'active');
      addLog('Generating script…');
      const t0Script = Date.now();

      const sRes = await fetch('/api/generate/script', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stockName, ticker, stockInfo, price, tone }),
        signal:  ac.signal,
      });
      if (!sRes.ok) {
        const e = await sRes.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? `Script API ${sRes.status}`);
      }
      const { script, scenes, seo } = await sRes.json() as {
        script: { fullScript: string; estimatedDuration: number };
        scenes: GeneratedScene[];
        seo:    GeneratedSEO;
      };
      setSeoData(seo);
      setStep('script', 'done');
      addLog(`Script ready — ${scenes.length} scenes, ${script.fullScript.split(' ').length} words (~${script.estimatedDuration}s) in ${((Date.now() - t0Script) / 1000).toFixed(1)}s`);

      // ── 2. Images ─────────────────────────────────────────
      setStep('images', 'active');
      addLog(`Generating ${scenes.length} images via Pollinations (sequential)…`);
      const t0Images = Date.now();
      const imageBase64s: (string | null)[] = new Array(scenes.length).fill(null);

      for (let i = 0; i < scenes.length; i++) {
        if (token.cancelled) throw new Error('Cancelled');
        try {
          addLog(`  [${i + 1}/${scenes.length}] ${scenes[i].imagePrompt.slice(0, 55)}…`);
          imageBase64s[i] = await fetchImage(scenes[i].imagePrompt, i, ac.signal);
          addLog(`  ✓ Image ${i + 1} done`);
        } catch (err) {
          // A failed image is non-fatal — scene renders black background.
          const msg = err instanceof Error ? err.message : 'unknown';
          if (msg === 'Cancelled' || ac.signal.aborted) throw new Error('Cancelled');
          addLog(`  ✗ Image ${i + 1} failed (${msg}) — will use black frame`);
        }
        if (i < scenes.length - 1) await new Promise(r => setTimeout(r, 400));
      }

      const imgOk = imageBase64s.filter(Boolean).length;
      setStep('images', imgOk === 0 ? 'warn' : 'done');
      addLog(`Images: ${imgOk}/${scenes.length} OK in ${((Date.now() - t0Images) / 1000).toFixed(1)}s`);

      // ── 3. Voice ──────────────────────────────────────────
      setStep('voice', 'active');
      addLog('Requesting TTS via edge proxy…');
      const t0Voice = Date.now();
      let audioBuffer: AudioBuffer;
      let voiceOk = false;

      try {
        if (token.cancelled) throw new Error('Cancelled');

        const vRes = await fetch('/api/generate/voice', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text: script.fullScript, voice }),
          // Hard timeout: edge function retries add up; 90s is generous but bounded.
          signal: AbortSignal.timeout(90_000),
        });

        if (!vRes.ok) {
          const e = await vRes.json().catch(() => ({})) as { error?: string };
          throw new Error(e.error ?? `TTS API ${vRes.status}`);
        }

        const { base64 } = await vRes.json() as { base64: string };
        if (!base64) throw new Error('TTS returned empty audio data');

        // Decode: detach via .slice(0) so decodeAudioData can take ownership.
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const tmp   = new AudioContext();
        try {
          audioBuffer = await tmp.decodeAudioData(bytes.buffer.slice(0));
          voiceOk = true;
        } finally {
          await tmp.close().catch(() => {});
        }

        setStep('voice', 'done');
        addLog(`Voice ready — ${audioBuffer.duration.toFixed(1)}s in ${((Date.now() - t0Voice) / 1000).toFixed(1)}s`);

      } catch (voiceErr) {
        if (token.cancelled || ac.signal.aborted) throw new Error('Cancelled');
        const msg = voiceErr instanceof Error ? voiceErr.message : String(voiceErr);
        addLog(`⚠ TTS failed (${msg})`);
        addLog(`  → Falling back to silent audio — video will have subtitles only`);
        // Synthesise a silent buffer matching the estimated script duration.
        audioBuffer = makeSilentBuffer(script.estimatedDuration || 45);
        setStep('voice', 'warn');
        addLog(`  Silent track: ${audioBuffer.duration.toFixed(0)}s`);
      }

      // ── 4. Decode images into HTMLImageElements ────────────
      if (token.cancelled) throw new Error('Cancelled');
      const imgEls: (HTMLImageElement | null)[] = await Promise.all(
        imageBase64s.map(b64 => {
          if (!b64) return Promise.resolve(null);
          return new Promise<HTMLImageElement | null>(res => {
            const img    = new Image();
            img.onload   = () => res(img);
            img.onerror  = () => res(null);
            img.src      = `data:image/jpeg;base64,${b64}`;
          });
        })
      );

      // ── 5. Render ─────────────────────────────────────────
      setStep('render', 'active');
      setStage('rendering');
      const t0Render = Date.now();
      addLog(`Rendering ${audioBuffer.duration.toFixed(1)}s video on canvas…`);
      if (!voiceOk) addLog('  (subtitles only — no audio)');
      addLog('  Keep this tab active — background tabs throttle rendering');

      const blob = await renderVideo(
        scenes,
        imgEls,
        audioBuffer,
        pct => {
          setRenderPct(pct);
          if (pct > 0 && pct % 20 === 0) addLog(`  Render ${pct}%…`);
        },
        token,
      );

      if (token.cancelled) throw new Error('Cancelled');

      // Revoke any previous URL, register the new one.
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      const url = URL.createObjectURL(blob);
      videoUrlRef.current = url;

      setVideoBlob(blob);
      setVideoUrl(url);
      setStep('render', 'done');
      addLog(`✓ Done — ${(blob.size / 1024 / 1024).toFixed(1)} MB in ${((Date.now() - t0Render) / 1000).toFixed(1)}s`);
      setStage('done');
      toast.success(voiceOk ? 'Video ready!' : 'Video ready (subtitles only — TTS unavailable)');

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Cancelled' || ac.signal.aborted) {
        addLog('Run cancelled.');
        setStage('idle');
        setSteps(initSteps());
        return;
      }
      addLog(`ERROR: ${msg}`);
      setStage('error');
      setSteps(p => p.map(s => s.status === 'active' ? { ...s, status: 'error' } : s));
      toast.error(msg);
    }
  }, [stockName, ticker, stockInfo, price, tone, voice, setStep, addLog]);

  const isRunning = stage === 'generating' || stage === 'rendering';

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-sm font-bold">IS</div>
          <span className="font-semibold text-lg tracking-tight">Indian Stock Shorts</span>
          <span className="ml-auto text-xs text-slate-500 bg-slate-800 px-3 py-1 rounded-full">AI Video Generator</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* ── Form ─────────────────────────────────────────── */}
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Generate Stock Short</h1>
            <p className="text-slate-400 text-sm mt-1">Video renders entirely in your browser. No API keys required.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Stock Name *</label>
                <input
                  value={stockName} onChange={e => setStockName(e.target.value)}
                  placeholder="e.g. Reliance Industries"
                  required disabled={isRunning}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Ticker</label>
                <input
                  value={ticker} onChange={e => setTicker(e.target.value)}
                  placeholder="e.g. RELIANCE" disabled={isRunning}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Stock Info & Analysis *</label>
              <textarea
                value={stockInfo} onChange={e => setStockInfo(e.target.value)}
                placeholder="Paste key metrics, news, earnings, sector trends…"
                rows={5} required disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Current Price (₹)</label>
              <input
                value={price} onChange={e => setPrice(e.target.value)}
                placeholder="e.g. 2840" disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">Video Tone</label>
              <div className="grid grid-cols-5 gap-2">
                {TONES.map(t => (
                  <button
                    key={t.id} type="button" disabled={isRunning}
                    onClick={() => setTone(t.id)} title={t.desc}
                    className={`rounded-lg py-2.5 px-1 text-center text-xs font-medium border transition-all ${
                      tone === t.id
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/30'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    } disabled:opacity-50`}>
                    <div>{t.label.split(' ')[0]}</div>
                    <div className="mt-0.5 opacity-80">{t.label.split(' ').slice(1).join(' ')}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Narrator Voice</label>
              <select
                value={voice} onChange={e => setVoice(e.target.value)} disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition">
                {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>

            <button
              type="submit" disabled={isRunning}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 flex items-center justify-center gap-2 transition-all shadow-lg text-sm">
              {isRunning
                ? <><Spinner />{stage === 'rendering' ? `Rendering… ${renderPct}%` : 'Generating…'}</>
                : <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    Generate Video
                  </>}
            </button>
          </form>
        </section>

        {/* ── Pipeline + Result ─────────────────────────────── */}
        <section className="space-y-6">

          {/* Pipeline steps */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Pipeline</h2>
            <div className="space-y-3">
              {steps.map(step => (
                <div key={step.id} className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
                  step.status === 'active' ? 'bg-blue-950/50 border border-blue-800/40' :
                  step.status === 'done'   ? 'bg-emerald-950/30 border border-emerald-900/30' :
                  step.status === 'warn'   ? 'bg-yellow-950/30 border border-yellow-900/30' :
                  step.status === 'error'  ? 'bg-red-950/30 border border-red-900/30' :
                  'bg-slate-800/30 border border-transparent'
                }`}>
                  <div className="mt-0.5 flex-shrink-0 w-5 flex items-center justify-center">
                    <StepIcon status={step.status}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm font-medium ${
                        step.status === 'active' ? 'text-blue-300' :
                        step.status === 'done'   ? 'text-emerald-300' :
                        step.status === 'warn'   ? 'text-yellow-300' :
                        step.status === 'error'  ? 'text-red-300' :
                        'text-slate-400'
                      }`}>{step.label}</span>
                      {step.elapsed != null &&
                        <span className="text-xs text-slate-500 tabular-nums">{(step.elapsed / 1000).toFixed(1)}s</span>}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{step.detail}</p>
                    {step.id === 'render' && step.status === 'active' && (
                      <div className="mt-2">
                        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300"
                            style={{ width: `${renderPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 mt-1 block">{renderPct}%</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live log */}
          {logs.length > 0 && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}/>
                <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Live Log</span>
              </div>
              <div className="p-4 max-h-60 overflow-y-auto space-y-0.5 font-mono text-xs text-slate-400">
                {logs.map((l, i) => (
                  <div key={i} className={
                    l.includes('ERROR') ? 'text-red-400' :
                    l.includes('⚠')    ? 'text-yellow-400' :
                    l.includes('✓')    ? 'text-emerald-400' :
                    l.includes('→')    ? 'text-slate-500' :
                    undefined
                  }>{l}</div>
                ))}
              </div>
            </div>
          )}

          {/* Result */}
          {stage === 'done' && videoUrl && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Result</h2>
                {seoData && <p className="text-xs text-slate-500 mt-1 truncate">{seoData.title}</p>}
              </div>
              <div className="relative bg-black" style={{ aspectRatio: '9/16', maxHeight: '480px', overflow: 'hidden' }}>
                <video src={videoUrl} controls autoPlay loop playsInline className="w-full h-full object-contain"/>
              </div>
              <div className="p-4 flex flex-col gap-3">
                {videoBlob && (
                  <a
                    href={videoUrl}
                    download={`${stockName.replace(/\s+/g, '-').toLowerCase()}-${tone.toLowerCase()}.webm`}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl py-3 text-sm text-center transition-colors flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    Download ({(videoBlob.size / 1024 / 1024).toFixed(1)} MB)
                  </a>
                )}
                {seoData && (
                  <div className="bg-slate-800 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">YouTube SEO</p>
                    <p className="text-sm text-white font-medium">{seoData.title}</p>
                    <p className="text-xs text-slate-400 line-clamp-3">{seoData.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {seoData.hashtags?.slice(0, 8).map(h => (
                        <span key={h} className="text-xs bg-slate-700 text-slate-300 rounded px-2 py-0.5">{h}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {stage === 'error' && (
            <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-5 flex gap-3 items-start">
              <span className="text-red-400 text-xl flex-shrink-0">✗</span>
              <div>
                <p className="text-red-300 font-medium">Generation failed</p>
                <p className="text-red-400/70 text-sm mt-1">See the live log above for details.</p>
                <button
                  onClick={() => { setStage('idle'); setSteps(initSteps()); setLogs([]); }}
                  className="mt-3 text-sm text-red-300 hover:text-white underline">
                  Reset and try again
                </button>
              </div>
            </div>
          )}

          {/* Idle placeholder */}
          {stage === 'idle' && (
            <div className="bg-slate-900/50 border border-slate-800/50 border-dashed rounded-2xl p-10 text-center">
              <div className="text-4xl mb-3">🎬</div>
              <p className="text-sm text-slate-500">Fill the form and hit <strong className="text-slate-400">Generate Video</strong></p>
              <p className="text-xs mt-2 text-slate-600">Images via Pollinations.ai · Voice via Google TTS · Rendered in browser</p>
            </div>
          )}

        </section>
      </main>
    </div>
  );
}
