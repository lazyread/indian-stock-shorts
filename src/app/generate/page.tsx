'use client';

import { useState, useRef, useCallback } from 'react';
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

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface PipelineStep {
  id:      string;
  label:   string;
  detail:  string;
  status:  StepStatus;
  elapsed: number | null;
}

type Stage = 'idle' | 'generating' | 'rendering' | 'done' | 'error';

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

const INITIAL_STEPS: Omit<PipelineStep, 'status' | 'elapsed'>[] = [
  { id: 'script', label: 'Generate Script',   detail: 'Building narration from your stock data' },
  { id: 'images', label: 'Generate Images',   detail: 'Stability AI creating 6 scene visuals' },
  { id: 'voice',  label: 'Generate Voice',    detail: 'Edge TTS synthesizing narration audio' },
  { id: 'render', label: 'Render Video',      detail: 'Browser canvas — Ken Burns, subtitles, encode' },
];

function initSteps(): PipelineStep[] {
  return INITIAL_STEPS.map((s) => ({ ...s, status: 'pending', elapsed: null }));
}

// ── Canvas video renderer ──────────────────────────────────────
const CANVAS_W = 768;
const CANVAS_H = 1344;

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function renderVideoOnCanvas(
  scenes: GeneratedScene[],
  images: (HTMLImageElement | null)[],
  audioBuffer: AudioBuffer,
  onProgress: (pct: number) => void
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d')!;

    // ── Audio setup ──────────────────────────────────────────
    const audioCtx    = new AudioContext();
    const srcNode     = audioCtx.createBufferSource();
    srcNode.buffer    = audioBuffer;
    const audioDest   = audioCtx.createMediaStreamDestination();
    srcNode.connect(audioDest);

    // ── MediaRecorder setup ──────────────────────────────────
    const videoStream    = canvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ]);

    // Prefer VP9 / VP8 in WebM; fall back to whatever browser supports
    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

    const recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      audioCtx.close();
      resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
    };
    recorder.onerror = (e) => { audioCtx.close(); reject(e); };

    // ── Animation loop ───────────────────────────────────────
    const totalDuration = audioBuffer.duration; // seconds
    const sceneDuration = totalDuration / scenes.length;

    let startTime: number | null = null;
    let lastReportedPct = 0;

    function drawFrame(now: number) {
      if (startTime === null) startTime = now;
      const elapsed = (now - startTime) / 1000; // seconds

      if (elapsed >= totalDuration) {
        // Draw final frame, then stop
        const lastIdx = scenes.length - 1;
        drawScene(ctx, scenes[lastIdx], images[lastIdx], 1);
        recorder.stop();
        srcNode.stop();
        onProgress(100);
        return;
      }

      const pct = Math.min(100, Math.round((elapsed / totalDuration) * 100));
      if (pct > lastReportedPct) { lastReportedPct = pct; onProgress(pct); }

      const sceneIdx  = Math.min(Math.floor(elapsed / sceneDuration), scenes.length - 1);
      const sceneT    = (elapsed - sceneIdx * sceneDuration) / sceneDuration; // 0→1 within scene

      drawScene(ctx, scenes[sceneIdx], images[sceneIdx], sceneT);

      requestAnimationFrame(drawFrame);
    }

    // ── Draw one frame ───────────────────────────────────────
    function drawScene(
      ctx: CanvasRenderingContext2D,
      scene: GeneratedScene,
      img: HTMLImageElement | null,
      progress: number // 0→1
    ) {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      if (img) {
        // Ken Burns: slow zoom 1.0 → 1.08 + subtle pan
        const zoom = 1 + progress * 0.08;
        const panX  = (scene.sceneNumber % 2 === 0 ? 1 : -1) * progress * 20;
        const panY  = progress * -15;

        const sw = CANVAS_W * zoom;
        const sh = CANVAS_H * zoom;
        const sx = (CANVAS_W - sw) / 2 + panX;
        const sy = (CANVAS_H - sh) / 2 + panY;

        ctx.drawImage(img, sx, sy, sw, sh);
      } else {
        // Black fallback
        ctx.fillStyle = '#08090e';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }

      // Dark gradient at bottom for subtitle readability
      const grad = ctx.createLinearGradient(0, CANVAS_H * 0.6, 0, CANVAS_H);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Subtitle text
      const subtitle = scene.subtitleText;
      ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      const lines = wrapText(ctx, subtitle, CANVAS_W - 80);

      const lineH  = 56;
      const totalH = lines.length * lineH;
      const baseY  = CANVAS_H - 120 - totalH;

      // Text shadow
      ctx.shadowColor   = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur    = 12;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#FFFFFF';
      lines.forEach((line, i) => {
        ctx.fillText(line, CANVAS_W / 2, baseY + i * lineH);
      });
      ctx.shadowBlur = 0;

      // Scene number indicator (tiny dots at bottom)
      const totalScenes = scenes.length;
      const dotW  = 6;
      const gap   = 10;
      const totalW = totalScenes * (dotW + gap) - gap;
      const startX = (CANVAS_W - totalW) / 2;
      const dotY   = CANVAS_H - 40;
      for (let i = 0; i < totalScenes; i++) {
        ctx.beginPath();
        ctx.arc(startX + i * (dotW + gap) + dotW / 2, dotY, dotW / 2, 0, Math.PI * 2);
        ctx.fillStyle = i === scene.sceneNumber - 1
          ? '#FFFFFF'
          : 'rgba(255,255,255,0.35)';
        ctx.fill();
      }
    }

    // ── Start ────────────────────────────────────────────────
    recorder.start(100); // collect chunks every 100ms
    srcNode.start(0);

    requestAnimationFrame(drawFrame);
  });
}

// ── Spinner SVG ────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// ── Step icon ──────────────────────────────────────────────────
function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done')
    return <span className="text-emerald-400 text-lg">✓</span>;
  if (status === 'active')
    return <Spinner />;
  if (status === 'error')
    return <span className="text-red-400 text-lg">✗</span>;
  return <span className="w-4 h-4 rounded-full border border-slate-600 inline-block" />;
}

// ── Main Page ──────────────────────────────────────────────────
export default function GeneratePage() {
  // Form fields
  const [stockName, setStockName] = useState('');
  const [ticker,    setTicker]    = useState('');
  const [stockInfo, setStockInfo] = useState('');
  const [price,     setPrice]     = useState('');
  const [tone,      setTone]      = useState('VIRAL');
  const [voice,     setVoice]     = useState('en-IN-NeerjaNeural');

  // Pipeline
  const [stage,    setStage]    = useState<Stage>('idle');
  const [steps,    setSteps]    = useState<PipelineStep[]>(initSteps);
  const [renderPct, setRenderPct] = useState(0);
  const [logs,     setLogs]     = useState<string[]>([]);
  const stepTimes = useRef<Record<string, number>>({});

  // Result
  const [videoUrl,  setVideoUrl]  = useState<string | null>(null);
  const [seoData,   setSeoData]   = useState<GeneratedSEO | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);

  // ── Helpers ────────────────────────────────────────────────
  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-80), msg]);
  }, []);

  const updateStep = useCallback((id: string, status: StepStatus) => {
    const now = Date.now();
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const elapsed = status === 'done' && stepTimes.current[id]
          ? now - stepTimes.current[id]
          : s.elapsed;
        return { ...s, status, elapsed };
      })
    );
    if (status === 'active') stepTimes.current[id] = now;
  }, []);

  // ── Submit handler ─────────────────────────────────────────
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockName.trim() || !stockInfo.trim()) {
      toast.error('Stock name and info are required');
      return;
    }

    setStage('generating');
    setSteps(initSteps());
    setLogs([]);
    setVideoUrl(null);
    setSeoData(null);
    setVideoBlob(null);
    setRenderPct(0);
    stepTimes.current = {};

    try {
      // ── Step 1: Script ───────────────────────────────────
      updateStep('script', 'active');
      addLog('Generating script and scenes…');

      const scriptRes = await fetch('/api/generate/script', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stockName, ticker, stockInfo, price, tone }),
      });
      if (!scriptRes.ok) {
        const err = await scriptRes.json().catch(() => ({}));
        throw new Error(err.error || `Script API failed (${scriptRes.status})`);
      }
      const { script, scenes, seo } = await scriptRes.json() as {
        script: { fullScript: string };
        scenes: GeneratedScene[];
        seo:    GeneratedSEO;
      };

      setSeoData(seo);
      updateStep('script', 'done');
      addLog(`Script ready — ${scenes.length} scenes, ${script.fullScript.split(' ').length} words`);

      // ── Step 2: Images (parallel) ────────────────────────
      updateStep('images', 'active');
      addLog(`Generating ${scenes.length} images in parallel…`);

      const imageBase64s: (string | null)[] = new Array(scenes.length).fill(null);

      const imagePromises = scenes.map(async (scene, idx) => {
        try {
          addLog(`  Scene ${idx + 1}: ${scene.imagePrompt.slice(0, 60)}…`);
          const res = await fetch('/api/generate/image', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ prompt: scene.imagePrompt, index: idx }),
          });
          if (!res.ok) throw new Error(`Image ${idx + 1} failed: ${res.status}`);
          const data = await res.json() as { base64: string; index: number };
          imageBase64s[data.index] = data.base64;
          addLog(`  ✓ Scene ${idx + 1} image done`);
        } catch (err) {
          addLog(`  ✗ Scene ${idx + 1} image failed — using black frame`);
          console.error(err);
        }
      });

      await Promise.all(imagePromises);
      updateStep('images', 'done');
      const gotImages = imageBase64s.filter(Boolean).length;
      addLog(`Images done — ${gotImages}/${scenes.length} successful`);

      // ── Step 3: Voice ────────────────────────────────────
      updateStep('voice', 'active');
      addLog('Synthesizing voiceover…');

      const voiceRes = await fetch('/api/generate/voice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: script.fullScript, voice }),
      });
      if (!voiceRes.ok) {
        const err = await voiceRes.json().catch(() => ({}));
        throw new Error(err.error || `Voice API failed (${voiceRes.status})`);
      }
      const { base64: audioBase64 } = await voiceRes.json() as { base64: string };
      updateStep('voice', 'done');
      addLog('Voiceover ready');

      // ── Step 4: Render in browser ────────────────────────
      updateStep('render', 'active');
      setStage('rendering');
      addLog('Rendering video in browser…');

      // Load images
      const imgElements: (HTMLImageElement | null)[] = await Promise.all(
        imageBase64s.map((b64) => {
          if (!b64) return Promise.resolve(null);
          return new Promise<HTMLImageElement | null>((res) => {
            const img = new Image();
            img.onload  = () => res(img);
            img.onerror = () => res(null);
            img.src = `data:image/png;base64,${b64}`;
          });
        })
      );

      // Decode audio
      const audioBytes    = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      const tempAudioCtx  = new AudioContext();
      const audioBuffer   = await tempAudioCtx.decodeAudioData(audioBytes.buffer);
      await tempAudioCtx.close();

      addLog(`Audio duration: ${audioBuffer.duration.toFixed(1)}s`);

      // Render
      const blob = await renderVideoOnCanvas(
        scenes,
        imgElements,
        audioBuffer,
        (pct) => {
          setRenderPct(pct);
          if (pct % 20 === 0) addLog(`  Render progress: ${pct}%`);
        }
      );

      const url = URL.createObjectURL(blob);
      setVideoBlob(blob);
      setVideoUrl(url);
      updateStep('render', 'done');
      addLog(`Video rendered — ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
      setStage('done');
      toast.success('Video ready!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`ERROR: ${msg}`);
      setStage('error');
      // Mark the active step as error
      setSteps((prev) =>
        prev.map((s) => (s.status === 'active' ? { ...s, status: 'error' } : s))
      );
      toast.error(msg);
    }
  }, [stockName, ticker, stockInfo, price, tone, voice, updateStep, addLog]);

  const isRunning = stage === 'generating' || stage === 'rendering';

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-sm font-bold">IS</div>
          <span className="font-semibold text-lg tracking-tight">Indian Stock Shorts</span>
          <span className="ml-auto text-xs text-slate-500 bg-slate-800 px-3 py-1 rounded-full">AI Video Generator</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* ── LEFT: Form ─────────────────────────────────────── */}
        <section className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Generate Stock Short</h1>
            <p className="text-slate-400 text-sm mt-1">Fill in your stock details and choose a style. Video renders right in your browser.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Stock Name + Ticker */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Stock Name *</label>
                <input
                  value={stockName}
                  onChange={(e) => setStockName(e.target.value)}
                  placeholder="e.g. Reliance Industries"
                  required
                  disabled={isRunning}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Ticker</label>
                <input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  placeholder="e.g. RELIANCE"
                  disabled={isRunning}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition"
                />
              </div>
            </div>

            {/* Stock Info */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Stock Info & Analysis *</label>
              <textarea
                value={stockInfo}
                onChange={(e) => setStockInfo(e.target.value)}
                placeholder="Paste key metrics, recent news, earnings, sector trends, or any analysis you want covered in the video…"
                rows={5}
                required
                disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 resize-none transition"
              />
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Current Price (₹)</label>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="e.g. 2840"
                disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition"
              />
            </div>

            {/* Tone */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">Video Tone</label>
              <div className="grid grid-cols-5 gap-2">
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={isRunning}
                    onClick={() => setTone(t.id)}
                    title={t.desc}
                    className={`rounded-lg py-2.5 px-1 text-center transition-all text-xs font-medium border ${
                      tone === t.id
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/30'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    } disabled:opacity-50`}
                  >
                    <div>{t.label.split(' ')[0]}</div>
                    <div className="mt-0.5 opacity-80">{t.label.split(' ').slice(1).join(' ')}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Voice */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Narrator Voice</label>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isRunning}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-900/30 text-sm"
            >
              {isRunning ? (
                <>
                  <Spinner />
                  {stage === 'rendering' ? `Rendering… ${renderPct}%` : 'Generating…'}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Generate Video
                </>
              )}
            </button>
          </form>
        </section>

        {/* ── RIGHT: Pipeline + Result ────────────────────────── */}
        <section className="space-y-6">

          {/* Pipeline steps */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Pipeline</h2>
            <div className="space-y-3">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
                    step.status === 'active' ? 'bg-blue-950/50 border border-blue-800/40' :
                    step.status === 'done'   ? 'bg-emerald-950/30 border border-emerald-900/30' :
                    step.status === 'error'  ? 'bg-red-950/30 border border-red-900/30' :
                    'bg-slate-800/30 border border-transparent'
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <StepIcon status={step.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm font-medium ${
                        step.status === 'active' ? 'text-blue-300' :
                        step.status === 'done'   ? 'text-emerald-300' :
                        step.status === 'error'  ? 'text-red-300' :
                        'text-slate-400'
                      }`}>{step.label}</span>
                      {step.elapsed != null && (
                        <span className="text-xs text-slate-500 flex-shrink-0">{(step.elapsed / 1000).toFixed(1)}s</span>
                      )}
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
                        <span className="text-xs text-slate-500 mt-1">{renderPct}%</span>
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
                <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`} />
                <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Live Log</span>
              </div>
              <div className="p-4 max-h-48 overflow-y-auto space-y-1 font-mono text-xs text-slate-400 scroll-smooth">
                {logs.map((l, i) => (
                  <div key={i} className={l.startsWith('ERROR') ? 'text-red-400' : l.startsWith('  ✓') ? 'text-emerald-400' : undefined}>
                    {l}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result */}
          {stage === 'done' && videoUrl && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Result</h2>
                {seoData && (
                  <p className="text-xs text-slate-500 mt-1 truncate">{seoData.title}</p>
                )}
              </div>

              {/* Video player — 9:16 */}
              <div className="relative bg-black" style={{ aspectRatio: '9/16', maxHeight: '480px', overflow: 'hidden' }}>
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>

              {/* Actions */}
              <div className="p-4 flex flex-col gap-3">
                {videoBlob && (
                  <a
                    href={videoUrl}
                    download={`${stockName.replace(/\s+/g, '-')}-${tone.toLowerCase()}-short.webm`}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl py-3 text-sm text-center transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Video ({videoBlob ? `${(videoBlob.size / 1024 / 1024).toFixed(1)} MB` : ''})
                  </a>
                )}

                {seoData && (
                  <div className="bg-slate-800 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">YouTube SEO</p>
                    <p className="text-sm text-white font-medium">{seoData.title}</p>
                    <p className="text-xs text-slate-400 line-clamp-3">{seoData.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {seoData.hashtags?.slice(0, 8).map((h) => (
                        <span key={h} className="text-xs bg-slate-700 text-slate-300 rounded px-2 py-0.5">{h}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error state */}
          {stage === 'error' && (
            <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-5">
              <div className="flex gap-3 items-start">
                <span className="text-red-400 text-xl">✗</span>
                <div>
                  <p className="text-red-300 font-medium">Generation failed</p>
                  <p className="text-red-400/70 text-sm mt-1">Check the live log above for details. Make sure your STABILITY_API_KEY is set.</p>
                  <button
                    onClick={() => { setStage('idle'); setSteps(initSteps()); setLogs([]); }}
                    className="mt-3 text-sm text-red-300 hover:text-white underline transition-colors"
                  >
                    Try again
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Idle placeholder */}
          {stage === 'idle' && (
            <div className="bg-slate-900/50 border border-slate-800/50 border-dashed rounded-2xl p-10 text-center text-slate-600">
              <div className="text-4xl mb-3">🎬</div>
              <p className="text-sm">Fill in the form and hit <span className="text-slate-400 font-medium">Generate Video</span> to start</p>
              <p className="text-xs mt-2 text-slate-700">Images → Voice → Canvas render — all happens in real time</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
