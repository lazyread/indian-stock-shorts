'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────
interface DoneEvent {
  jobId:       string;
  videoUrl:    string;
  duration:    number;
  fileSize:    number;
  title:       string;
  description: string;
  hashtags:    string;
  tags:        string[];
}

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface PipelineStep {
  id:      string;
  label:   string;
  detail:  string;
  status:  StepStatus;
  elapsed: number | null; // ms
}

type Stage = 'idle' | 'generating' | 'done' | 'error';

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

// Keyword → pipeline step id mapping
const STEP_KEYWORDS: [RegExp, string][] = [
  [/script/i,           'script'],
  [/image/i,            'images'],
  [/voiceover|voice|tts|audio/i, 'voice'],
  [/slideshow|segment|concat|Ken Burns/i, 'render'],
  [/mix|subtitle|fade|encoding|final/i,   'render'],
  [/done/i,             'done'],
];

function detectStep(text: string): string {
  for (const [re, id] of STEP_KEYWORDS) {
    if (re.test(text)) return id;
  }
  return '';
}

const INITIAL_STEPS: Omit<PipelineStep, 'status' | 'elapsed'>[] = [
  { id: 'script', label: 'Generate Script',  detail: 'Building narration from your stock data' },
  { id: 'images', label: 'Generate Images',  detail: 'Stability AI creating 6 scene visuals' },
  { id: 'voice',  label: 'Generate Voice',   detail: 'Edge TTS synthesizing narration audio' },
  { id: 'render', label: 'Render Video',     detail: 'FFmpeg — Ken Burns, subtitles, final encode' },
];

function initSteps(): PipelineStep[] {
  return INITIAL_STEPS.map((s) => ({ ...s, status: 'pending', elapsed: null }));
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

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────
export default function GeneratePage() {
  const [stage, setStage]   = useState<Stage>('idle');
  const [steps, setSteps]   = useState<PipelineStep[]>(initSteps());
  const [pct, setPct]       = useState(0);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const [result, setResult] = useState<DoneEvent | null>(null);
  const [errMsg, setErrMsg] = useState('');

  // YouTube state
  const [ytConnected, setYtConnected]   = useState(false);
  const [ytChannel, setYtChannel]       = useState<{ name: string; id: string } | null>(null);
  const [ytUploading, setYtUploading]   = useState(false);
  const [ytUrl, setYtUrl]               = useState('');
  const [ytAvailable, setYtAvailable]   = useState(false);

  const abortRef    = useRef<AbortController | null>(null);
  const logRef      = useRef<HTMLDivElement>(null);
  const stepTimers  = useRef<Record<string, number>>({});

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [liveLog]);

  // YouTube setup
  useEffect(() => {
    fetch('/api/youtube/status')
      .then((r) => r.json())
      .then((d: { connected: boolean; channel?: { name: string; id: string } }) => {
        setYtConnected(d.connected);
        if (d.channel) setYtChannel(d.channel);
      }).catch(() => {});
    fetch('/api/youtube/auth-url')
      .then((r) => { if (r.ok) setYtAvailable(true); }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data !== 'yt-auth-done') return;
      fetch('/api/youtube/status').then((r) => r.json())
        .then((d: { connected: boolean; channel?: { name: string; id: string } }) => {
          setYtConnected(d.connected);
          if (d.channel) setYtChannel(d.channel);
          toast.success('YouTube connected!');
        });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── Update pipeline step ────────────────────────────────────
  const activateStep = useCallback((id: string) => {
    stepTimers.current[id] = Date.now();
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id === id)   return { ...s, status: 'active', elapsed: null };
        if (s.status === 'active') {
          const started = stepTimers.current[s.id] ?? Date.now();
          return { ...s, status: 'done', elapsed: Date.now() - started };
        }
        return s;
      })
    );
  }, []);

  const completeAllSteps = useCallback(() => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.status === 'active') {
          const started = stepTimers.current[s.id] ?? Date.now();
          return { ...s, status: 'done', elapsed: Date.now() - started };
        }
        return s;
      })
    );
  }, []);

  // ── Generate ────────────────────────────────────────────────
  const handleGenerate = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd   = new FormData(e.currentTarget);
    const body = {
      stockName: (fd.get('stockName') as string).trim(),
      ticker:    (fd.get('ticker')    as string).trim(),
      stockInfo: (fd.get('stockInfo') as string).trim(),
      price:     (fd.get('price')     as string).trim(),
      change:    (fd.get('change')    as string).trim(),
      tone:      fd.get('tone')      as string,
      voice:     fd.get('voice')     as string,
      addMusic:  fd.get('addMusic') === 'on',
    };

    if (!body.stockName || !body.stockInfo) {
      toast.error('Stock name and info are required');
      return;
    }

    // Reset state
    setStage('generating');
    setSteps(initSteps());
    setLiveLog([]);
    setPct(0);
    setResult(null);
    setErrMsg('');
    setYtUrl('');
    stepTimers.current = {};

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  ctrl.signal,
      });

      if (!resp.ok || !resp.body) throw new Error('Generation request failed');

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6)) as { event: string } & Record<string, unknown>;

          if (data.event === 'progress') {
            const stepText = data.step as string;
            const newPct   = data.pct  as number;

            setPct(newPct);
            setLiveLog((prev) => [...prev.slice(-60), stepText]);

            const stepId = detectStep(stepText);
            if (stepId && stepId !== 'done') activateStep(stepId);

          } else if (data.event === 'done') {
            completeAllSteps();
            setPct(100);
            setResult(data as unknown as DoneEvent);
            setStage('done');
            toast.success('🎬 Video generated!');

          } else if (data.event === 'error') {
            throw new Error(data.message as string);
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') { setStage('idle'); return; }
      const msg = err instanceof Error ? err.message : String(err);
      setErrMsg(msg);
      setStage('error');
      setSteps((prev) => prev.map((s) => s.status === 'active' ? { ...s, status: 'error' } : s));
      toast.error(msg);
    }
  }, [activateStep, completeAllSteps]);

  const handleAbort = () => { abortRef.current?.abort(); setStage('idle'); };

  const handleYouTubeConnect = async () => {
    const r = await fetch('/api/youtube/auth-url');
    const d = await r.json() as { url?: string; error?: string };
    if (!r.ok || d.error) { toast.error(d.error ?? 'Failed'); return; }
    window.open(d.url, '_blank', 'width=600,height=700');
  };

  const handleUpload = async () => {
    if (!result) return;
    setYtUploading(true);
    try {
      const r = await fetch('/api/youtube/upload', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId:       result.jobId,
          title:       result.title,
          description: result.description + '\n\n' + result.hashtags,
          tags:        result.tags,
        }),
      });
      const d = await r.json() as { youtubeUrl?: string; error?: string };
      if (!r.ok || d.error) throw new Error(d.error ?? 'Upload failed');
      setYtUrl(d.youtubeUrl ?? '');
      toast.success('Uploaded to YouTube!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setYtUploading(false);
    }
  };

  const isGenerating = stage === 'generating';

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080d1a] text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-12 grid md:grid-cols-2 gap-8 items-start">

        {/* ── LEFT: Form ──────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Header */}
          <div>
            <div className="inline-flex items-center gap-2 bg-blue-950/60 border border-blue-800/40 rounded-full px-3 py-1 text-xs text-blue-300 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Indian Stock Shorts AI
            </div>
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent leading-tight">
              Generate a<br />YouTube Short
            </h1>
            <p className="text-slate-500 text-sm mt-1">Enter stock details below and hit Generate</p>
          </div>

          <form onSubmit={handleGenerate} className="space-y-4">

            {/* Stock Name + Ticker */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Stock Name *</label>
                <input name="stockName" required placeholder="Reliance Industries"
                  disabled={isGenerating}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 disabled:opacity-50 transition" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">NSE Ticker</label>
                <input name="ticker" placeholder="RELIANCE"
                  disabled={isGenerating}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 disabled:opacity-50 transition" />
              </div>
            </div>

            {/* Stock Info */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Stock Info / Analysis *</label>
              <textarea name="stockInfo" required rows={5} disabled={isGenerating}
                placeholder="Paste news, analysis, key metrics...&#10;e.g. Q3 results beat estimates by 12%, revenue up 18% YoY, promoter buying, strong order book worth ₹2.3L cr..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 disabled:opacity-50 resize-none transition" />
            </div>

            {/* Price */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Price</label>
              <input name="price" placeholder="₹2,847" disabled={isGenerating}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 transition" />
            </div>

            {/* Tone */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Tone</label>
              <div className="grid grid-cols-5 gap-1.5">
                {TONES.map((t) => (
                  <label key={t.id} className="cursor-pointer">
                    <input type="radio" name="tone" value={t.id} defaultChecked={t.id === 'VIRAL'}
                      disabled={isGenerating} className="sr-only peer" />
                    <div className="text-center py-2 px-1 rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-400
                      peer-checked:border-blue-500 peer-checked:bg-blue-950/50 peer-checked:text-blue-300
                      hover:border-slate-600 transition cursor-pointer select-none">
                      {t.label}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Voice */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Voice</label>
              <select name="voice" defaultValue="en-IN-NeerjaNeural" disabled={isGenerating}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 transition">
                {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>

            {/* Submit / Cancel */}
            {isGenerating ? (
              <button type="button" onClick={handleAbort}
                className="w-full py-3 rounded-xl bg-red-900/40 border border-red-700/50 text-red-300 hover:bg-red-900/60 transition font-medium text-sm">
                ✕ Cancel
              </button>
            ) : (
              <button type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 font-bold text-sm transition shadow-lg shadow-blue-900/40 active:scale-[0.98]">
                {stage === 'error' ? '↺ Try Again' : '⚡ Generate Video'}
              </button>
            )}
          </form>
        </div>

        {/* ── RIGHT: Pipeline + Result ─────────────────────────── */}
        <div className="space-y-4">

          {/* Pipeline card — always visible */}
          <div className="bg-[#0f1629] border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Pipeline</span>
              {isGenerating && (
                <span className="text-xs text-blue-400 font-mono">{pct}%</span>
              )}
              {stage === 'done' && (
                <span className="text-xs text-green-400 font-semibold">✓ Complete</span>
              )}
            </div>

            {/* Progress bar */}
            {(isGenerating || stage === 'done') && (
              <div className="h-0.5 bg-slate-800">
                <div className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-700"
                  style={{ width: `${pct}%` }} />
              </div>
            )}

            {/* Steps */}
            <div className="p-5 space-y-3">
              {steps.map((step, idx) => (
                <div key={step.id}
                  className={`flex items-start gap-3 p-3 rounded-xl transition-all duration-300 ${
                    step.status === 'active' ? 'bg-blue-950/40 border border-blue-700/40' :
                    step.status === 'done'   ? 'bg-green-950/20 border border-green-800/20' :
                    step.status === 'error'  ? 'bg-red-950/30 border border-red-800/30' :
                    'bg-slate-900/40 border border-transparent'
                  }`}>

                  {/* Icon */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all ${
                    step.status === 'active' ? 'bg-blue-600/20 ring-2 ring-blue-500/50' :
                    step.status === 'done'   ? 'bg-green-900/40' :
                    step.status === 'error'  ? 'bg-red-900/40' :
                    'bg-slate-800 text-slate-500'
                  }`}>
                    {step.status === 'active' ? <Spinner /> :
                     step.status === 'done'   ? <CheckIcon /> :
                     step.status === 'error'  ? <ErrorIcon /> :
                     <span className="text-slate-600">{idx + 1}</span>}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold leading-tight ${
                      step.status === 'active' ? 'text-blue-200' :
                      step.status === 'done'   ? 'text-green-300' :
                      step.status === 'error'  ? 'text-red-300' :
                      'text-slate-500'
                    }`}>
                      {step.label}
                      {step.elapsed !== null && (
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          {(step.elapsed / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Live log */}
            {(isGenerating || liveLog.length > 0) && (
              <div className="border-t border-slate-700/50">
                <div ref={logRef}
                  className="px-5 py-3 h-28 overflow-y-auto space-y-0.5 font-mono text-xs scrollbar-thin">
                  {liveLog.length === 0 ? (
                    <span className="text-slate-600">Waiting for pipeline...</span>
                  ) : (
                    liveLog.map((line, i) => (
                      <div key={i}
                        className={`${i === liveLog.length - 1 ? 'text-cyan-300' : 'text-slate-500'} leading-relaxed`}>
                        {i === liveLog.length - 1 && <span className="text-blue-500 mr-1">›</span>}
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Error banner */}
          {stage === 'error' && (
            <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 text-sm text-red-300">
              <strong className="block text-red-400 mb-1">Generation failed</strong>
              {errMsg}
            </div>
          )}

          {/* Result card */}
          {stage === 'done' && result && (
            <div className="bg-[#0f1629] border border-green-800/30 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-green-400 text-sm font-semibold">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Video ready · {result.duration}s · {(result.fileSize / 1024 / 1024).toFixed(1)} MB
              </div>

              {/* Player */}
              <div className="flex justify-center">
                <video src={result.videoUrl} controls playsInline
                  className="rounded-xl bg-black aspect-[9/16] max-h-72 shadow-xl" />
              </div>

              {/* Title / tags */}
              <div className="space-y-1.5">
                <div className="text-sm font-semibold text-slate-200 leading-tight">{result.title}</div>
                <div className="text-xs text-blue-400 leading-relaxed">{result.hashtags}</div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2">
                <a href={result.videoUrl} download
                  className="text-center py-2.5 rounded-xl bg-slate-700/60 hover:bg-slate-700 text-sm font-medium transition">
                  ↓ Download
                </a>

                {ytAvailable ? (
                  ytUrl ? (
                    <a href={ytUrl} target="_blank" rel="noopener noreferrer"
                      className="text-center py-2.5 rounded-xl bg-red-700/80 hover:bg-red-700 text-sm font-medium transition">
                      ▶ View on YouTube
                    </a>
                  ) : ytConnected ? (
                    <button onClick={handleUpload} disabled={ytUploading}
                      className="py-2.5 rounded-xl bg-red-700/80 hover:bg-red-700 disabled:opacity-50 text-sm font-medium transition">
                      {ytUploading ? '⏳ Uploading...' : `▲ Post to YouTube`}
                    </button>
                  ) : (
                    <button onClick={handleYouTubeConnect}
                      className="py-2.5 rounded-xl bg-red-950/50 border border-red-800/50 hover:bg-red-950 text-red-300 text-sm font-medium transition">
                      Connect YouTube
                    </button>
                  )
                ) : (
                  <div className="py-2.5 rounded-xl bg-slate-800/50 text-slate-500 text-xs text-center flex items-center justify-center px-2">
                    Add YouTube creds to post
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Idle hint */}
          {stage === 'idle' && (
            <div className="bg-[#0f1629] border border-slate-700/30 rounded-2xl p-5 text-center space-y-2">
              <div className="text-4xl">🎬</div>
              <div className="text-slate-400 text-sm">Fill in the form and hit<br /><strong className="text-slate-200">Generate Video</strong> to start</div>
              <div className="text-xs text-slate-600 pt-1">
                Script → Images → Voice → Video<br />~2 min total
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
