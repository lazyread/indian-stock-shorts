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
interface PipelineStep { id: string; label: string; detail: string; status: StepStatus; elapsed: number | null; }
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
  { id: 'script', label: 'Generate Script', detail: 'Template engine builds narration' },
  { id: 'images', label: 'Generate Images', detail: 'Pollinations.ai Turbo — 6 scenes, sequential' },
  { id: 'voice',  label: 'Generate Voice',  detail: 'Google TTS via edge proxy (silent fallback if blocked)' },
  { id: 'render', label: 'Render Video',    detail: 'Canvas — Ken Burns, subtitles, MediaRecorder' },
];
function initSteps(): PipelineStep[] {
  return INITIAL_STEPS.map(s => ({ ...s, status: 'pending', elapsed: null }));
}

// ── Browser-side image (Pollinations.ai turbo, sequential) ─────
async function fetchImage(prompt: string, idx: number): Promise<string> {
  const enhanced =
    `${prompt}, photorealistic, cinematic lighting, vertical portrait 9:16, ` +
    `Indian financial context, no text, no logos, no watermarks`;
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(enhanced)}` +
    `?width=768&height=1344&nologo=true&model=turbo&seed=${idx * 17 + 3}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const blob    = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 768; c.height = 1344;
        c.getContext('2d')!.drawImage(img, 0, 0, 768, 1344);
        URL.revokeObjectURL(blobUrl);
        resolve(c.toDataURL('image/jpeg', 0.88).split(',')[1]);
      } catch (e) { URL.revokeObjectURL(blobUrl); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('img load failed')); };
    img.src = blobUrl;
  });
}

// ── Canvas video renderer ──────────────────────────────────────
const W = 768, H = 1344;

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' '); const lines: string[] = []; let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line); return lines;
}

function makeSilentBuffer(seconds: number): AudioBuffer {
  const ctx = new AudioContext();
  return ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
}

async function renderVideo(
  scenes: GeneratedScene[],
  images: (HTMLImageElement | null)[],
  audioBuffer: AudioBuffer,
  onProgress: (pct: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    const audioCtx  = new AudioContext();
    const src       = audioCtx.createBufferSource();
    src.buffer      = audioBuffer;
    const audioDest = audioCtx.createMediaStreamDestination();
    src.connect(audioDest);

    const mimeType = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find(m => MediaRecorder.isTypeSupported(m)) ?? '';

    const stream   = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop  = () => { audioCtx.close(); resolve(new Blob(chunks, { type: mimeType || 'video/webm' })); };
    recorder.onerror = e  => { audioCtx.close(); reject(e); };

    const total  = audioBuffer.duration;
    const perScene = total / scenes.length;
    let t0: number | null = null; let lastPct = 0;

    function drawFrame(now: number) {
      if (t0 === null) t0 = now;
      const elapsed = (now - t0) / 1000;
      if (elapsed >= total) {
        drawScene(ctx, scenes[scenes.length - 1], images[scenes.length - 1], 1);
        recorder.stop(); src.stop(); onProgress(100); return;
      }
      const pct = Math.min(100, Math.round((elapsed / total) * 100));
      if (pct > lastPct) { lastPct = pct; onProgress(pct); }
      const si = Math.min(Math.floor(elapsed / perScene), scenes.length - 1);
      drawScene(ctx, scenes[si], images[si], (elapsed - si * perScene) / perScene);
      requestAnimationFrame(drawFrame);
    }

    function drawScene(ctx: CanvasRenderingContext2D, scene: GeneratedScene, img: HTMLImageElement | null, t: number) {
      ctx.clearRect(0, 0, W, H);
      if (img) {
        const z = 1 + t * 0.08;
        const px = (scene.sceneNumber % 2 === 0 ? 1 : -1) * t * 20;
        ctx.drawImage(img, (W - W * z) / 2 + px, (H - H * z) / 2 - t * 15, W * z, H * z);
      } else {
        ctx.fillStyle = '#08090e'; ctx.fillRect(0, 0, W, H);
      }
      const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 44px "Segoe UI",Arial,sans-serif'; ctx.textAlign = 'center';
      const lines = wrapText(ctx, scene.subtitleText, W - 80);
      const baseY  = H - 120 - lines.length * 56;
      ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 12; ctx.fillStyle = '#fff';
      lines.forEach((l, i) => ctx.fillText(l, W / 2, baseY + i * 56));
      ctx.shadowBlur = 0;
      const dotW = 6, gap = 10, totalDotW = scenes.length * (dotW + gap) - gap;
      const sx = (W - totalDotW) / 2;
      for (let i = 0; i < scenes.length; i++) {
        ctx.beginPath();
        ctx.arc(sx + i * (dotW + gap) + dotW / 2, H - 40, dotW / 2, 0, Math.PI * 2);
        ctx.fillStyle = i === scene.sceneNumber - 1 ? '#fff' : 'rgba(255,255,255,0.35)';
        ctx.fill();
      }
    }

    recorder.start(100); src.start(0); requestAnimationFrame(drawFrame);
  });
}

// ── UI helpers ─────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
}
function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done')   return <span className="text-emerald-400 text-lg">✓</span>;
  if (status === 'active') return <Spinner />;
  if (status === 'error')  return <span className="text-red-400 text-lg">✗</span>;
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
  const stepTimes = useRef<Record<string, number>>({});

  const [videoUrl,  setVideoUrl]  = useState<string | null>(null);
  const [seoData,   setSeoData]   = useState<GeneratedSEO | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);

  const addLog = useCallback((msg: string) => setLogs(p => [...p.slice(-80), msg]), []);

  const setStep = useCallback((id: string, status: StepStatus) => {
    const now = Date.now();
    setSteps(p => p.map(s => {
      if (s.id !== id) return s;
      const elapsed = status === 'done' && stepTimes.current[id] ? now - stepTimes.current[id] : s.elapsed;
      return { ...s, status, elapsed };
    }));
    if (status === 'active') stepTimes.current[id] = now;
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockName.trim() || !stockInfo.trim()) { toast.error('Stock name and info required'); return; }

    setStage('generating'); setSteps(initSteps()); setLogs([]);
    setVideoUrl(null); setSeoData(null); setVideoBlob(null); setRenderPct(0);
    stepTimes.current = {};

    try {
      // ── 1. Script ─────────────────────────────────────────
      setStep('script', 'active');
      addLog('Generating script…');
      const sRes = await fetch('/api/generate/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockName, ticker, stockInfo, price, tone }),
      });
      if (!sRes.ok) {
        const e = await sRes.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error || `Script failed (${sRes.status})`);
      }
      const { script, scenes, seo } = await sRes.json() as {
        script: { fullScript: string; estimatedDuration: number };
        scenes: GeneratedScene[];
        seo:    GeneratedSEO;
      };
      setSeoData(seo);
      setStep('script', 'done');
      addLog(`Script ready — ${scenes.length} scenes, ${script.fullScript.split(' ').length} words (~${script.estimatedDuration}s)`);

      // ── 2. Images (sequential, turbo model) ───────────────
      setStep('images', 'active');
      addLog(`Generating ${scenes.length} images (Pollinations turbo)…`);
      const imageBase64s: (string | null)[] = new Array(scenes.length).fill(null);

      for (let i = 0; i < scenes.length; i++) {
        try {
          addLog(`  [${i + 1}/${scenes.length}] ${scenes[i].imagePrompt.slice(0, 50)}…`);
          imageBase64s[i] = await fetchImage(scenes[i].imagePrompt, i);
          addLog(`  ✓ Scene ${i + 1} done`);
        } catch (err) {
          addLog(`  ✗ Scene ${i + 1}: ${err instanceof Error ? err.message : 'failed'}`);
        }
        // Brief pause between requests to avoid rate-limiting
        if (i < scenes.length - 1) await new Promise(r => setTimeout(r, 400));
      }

      setStep('images', 'done');
      addLog(`Images: ${imageBase64s.filter(Boolean).length}/${scenes.length} OK`);

      // ── 3. Voice (server edge proxy → silent fallback) ────
      setStep('voice', 'active');
      addLog('Generating voice via edge TTS proxy…');
      let audioBuffer: AudioBuffer;

      try {
        const vRes = await fetch('/api/generate/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: script.fullScript, voice }),
        });
        if (!vRes.ok) {
          const e = await vRes.json().catch(() => ({})) as { error?: string };
          throw new Error(e.error || `Voice failed (${vRes.status})`);
        }
        const { base64 } = await vRes.json() as { base64: string };
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const tmp   = new AudioContext();
        audioBuffer = await tmp.decodeAudioData(bytes.buffer.slice(0));
        await tmp.close();
        setStep('voice', 'done');
        addLog(`Voice ready — ${audioBuffer.duration.toFixed(1)}s`);
      } catch (voiceErr) {
        // Always fall through — generate a silent video rather than failing entirely
        const msg = voiceErr instanceof Error ? voiceErr.message : 'unknown';
        addLog(`⚠ Voice unavailable (${msg}) — rendering with subtitles only`);
        audioBuffer = makeSilentBuffer(script.estimatedDuration || 40);
        setStep('voice', 'done');
        addLog(`Using ${audioBuffer.duration.toFixed(0)}s silent track`);
      }

      // ── 4. Render ─────────────────────────────────────────
      setStep('render', 'active');
      setStage('rendering');
      addLog('Rendering video on canvas…');

      const imgEls: (HTMLImageElement | null)[] = await Promise.all(
        imageBase64s.map(b64 => {
          if (!b64) return Promise.resolve(null);
          return new Promise<HTMLImageElement | null>(res => {
            const img = new Image();
            img.onload  = () => res(img);
            img.onerror = () => res(null);
            img.src = `data:image/jpeg;base64,${b64}`;
          });
        })
      );

      const blob = await renderVideo(scenes, imgEls, audioBuffer, pct => {
        setRenderPct(pct);
        if (pct % 25 === 0) addLog(`  Render ${pct}%`);
      });

      const url = URL.createObjectURL(blob);
      setVideoBlob(blob); setVideoUrl(url);
      setStep('render', 'done');
      addLog(`Done — ${(blob.size / 1024 / 1024).toFixed(1)} MB`);
      setStage('done');
      toast.success('Video ready!');

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`ERROR: ${msg}`);
      setStage('error');
      setSteps(p => p.map(s => s.status === 'active' ? { ...s, status: 'error' } : s));
      toast.error(msg);
    }
  }, [stockName, ticker, stockInfo, price, tone, voice, setStep, addLog]);

  const isRunning = stage === 'generating' || stage === 'rendering';

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
            <p className="text-slate-400 text-sm mt-1">Video renders in your browser. No API keys required.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Stock Name *</label>
                <input value={stockName} onChange={e => setStockName(e.target.value)} placeholder="e.g. Reliance Industries"
                  required disabled={isRunning}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Ticker</label>
                <input value={ticker} onChange={e => setTicker(e.target.value)} placeholder="e.g. RELIANCE" disabled={isRunning}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition"/>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Stock Info & Analysis *</label>
              <textarea value={stockInfo} onChange={e => setStockInfo(e.target.value)}
                placeholder="Paste key metrics, news, earnings, sector trends…"
                rows={5} required disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none transition"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Current Price (₹)</label>
              <input value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 2840" disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wide">Video Tone</label>
              <div className="grid grid-cols-5 gap-2">
                {TONES.map(t => (
                  <button key={t.id} type="button" disabled={isRunning} onClick={() => setTone(t.id)} title={t.desc}
                    className={`rounded-lg py-2.5 px-1 text-center text-xs font-medium border transition-all ${
                      tone === t.id ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/30'
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
              <select value={voice} onChange={e => setVoice(e.target.value)} disabled={isRunning}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition">
                {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>
            <button type="submit" disabled={isRunning}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3.5 flex items-center justify-center gap-2 transition-all shadow-lg text-sm">
              {isRunning
                ? <><Spinner/>{stage === 'rendering' ? `Rendering… ${renderPct}%` : 'Generating…'}</>
                : <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>Generate Video
                  </>}
            </button>
          </form>
        </section>

        {/* ── Pipeline + Result ─────────────────────────────── */}
        <section className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Pipeline</h2>
            <div className="space-y-3">
              {steps.map(step => (
                <div key={step.id} className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
                  step.status === 'active' ? 'bg-blue-950/50 border border-blue-800/40' :
                  step.status === 'done'   ? 'bg-emerald-950/30 border border-emerald-900/30' :
                  step.status === 'error'  ? 'bg-red-950/30 border border-red-900/30' :
                  'bg-slate-800/30 border border-transparent'}`}>
                  <div className="mt-0.5 flex-shrink-0"><StepIcon status={step.status}/></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm font-medium ${
                        step.status === 'active' ? 'text-blue-300' :
                        step.status === 'done'   ? 'text-emerald-300' :
                        step.status === 'error'  ? 'text-red-300' : 'text-slate-400'}`}>{step.label}</span>
                      {step.elapsed != null && <span className="text-xs text-slate-500">{(step.elapsed/1000).toFixed(1)}s</span>}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{step.detail}</p>
                    {step.id === 'render' && step.status === 'active' && (
                      <div className="mt-2">
                        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300" style={{ width: `${renderPct}%` }}/>
                        </div>
                        <span className="text-xs text-slate-500 mt-1">{renderPct}%</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {logs.length > 0 && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-800 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}/>
                <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Live Log</span>
              </div>
              <div className="p-4 max-h-56 overflow-y-auto space-y-1 font-mono text-xs text-slate-400">
                {logs.map((l, i) => (
                  <div key={i} className={
                    l.startsWith('ERROR') ? 'text-red-400' :
                    l.startsWith('⚠')    ? 'text-yellow-400' :
                    l.includes('✓')      ? 'text-emerald-400' : undefined}>{l}</div>
                ))}
              </div>
            </div>
          )}

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
                  <a href={videoUrl} download={`${stockName.replace(/\s+/g,'-')}-${tone.toLowerCase()}.webm`}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl py-3 text-sm text-center transition-colors flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    Download ({(videoBlob.size/1024/1024).toFixed(1)} MB)
                  </a>
                )}
                {seoData && (
                  <div className="bg-slate-800 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">YouTube SEO</p>
                    <p className="text-sm text-white font-medium">{seoData.title}</p>
                    <p className="text-xs text-slate-400 line-clamp-3">{seoData.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {seoData.hashtags?.slice(0,8).map(h => (
                        <span key={h} className="text-xs bg-slate-700 text-slate-300 rounded px-2 py-0.5">{h}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {stage === 'error' && (
            <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-5 flex gap-3 items-start">
              <span className="text-red-400 text-xl">✗</span>
              <div>
                <p className="text-red-300 font-medium">Generation failed</p>
                <p className="text-red-400/70 text-sm mt-1">Check the live log above.</p>
                <button onClick={() => { setStage('idle'); setSteps(initSteps()); setLogs([]); }}
                  className="mt-3 text-sm text-red-300 hover:text-white underline">Try again</button>
              </div>
            </div>
          )}

          {stage === 'idle' && (
            <div className="bg-slate-900/50 border border-slate-800/50 border-dashed rounded-2xl p-10 text-center text-slate-600">
              <div className="text-4xl mb-3">🎬</div>
              <p className="text-sm text-slate-500">Fill the form and hit <strong className="text-slate-400">Generate Video</strong></p>
              <p className="text-xs mt-2">Images via Pollinations.ai · Voice via Google TTS · Rendered in browser</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
