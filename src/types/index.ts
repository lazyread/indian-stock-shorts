// ============================================================
// Active types — only what is currently used by the pipeline.
// The original file contained a full DB-relation graph
// (VideoProjectWithRelations, JobProgress, VideoJobData, etc.)
// from an earlier server-side architecture. Those types have been
// moved to src/lib/_dead/ alongside the code that used them.
// ============================================================

export type VideoTone  = 'AGGRESSIVE' | 'PROFESSIONAL' | 'VIRAL' | 'EDUCATIONAL' | 'URGENT';
export type VideoStyle = 'DYNAMIC' | 'MINIMAL' | 'CINEMATIC' | 'NEWS' | 'HYPE';

// ── Script ────────────────────────────────────────────────────

export interface GeneratedScript {
  hook:            string;
  mainContent:     string;
  whyItMatters:    string;
  keyNumbers:      string;
  riskOpportunity: string;
  cta:             string;
  fullScript:      string;
  wordCount:       number;
  estimatedDuration: number; // seconds at ~150 wpm
}

// ── Scene ─────────────────────────────────────────────────────

export interface GeneratedScene {
  sceneNumber:  number;
  narration:    string;
  subtitleText: string;
  imagePrompt:  string;
  transition:   string;
  visualStyle:  string;
  duration:     number; // seconds
}

// ── SEO ───────────────────────────────────────────────────────

export interface GeneratedSEO {
  title:       string;
  description: string;
  tags:        string[];
  hashtags:    string[];
  category:    string;
}

// ── YouTube upload (kept — routes are wired but need auth) ────

export type YouTubeVisibility = 'PUBLIC' | 'PRIVATE' | 'UNLISTED';

export interface UploadParams {
  videoPath:   string;
  title:       string;
  description: string;
  tags:        string[];
}

// ── Voice options ─────────────────────────────────────────────

export const VOICE_OPTIONS = [
  { id: 'en-IN-NeerjaNeural',  name: 'Neerja (Indian English)', gender: 'Female' as const, locale: 'en-IN' },
  { id: 'en-IN-PrabhatNeural', name: 'Prabhat (Indian English)', gender: 'Male'   as const, locale: 'en-IN' },
  { id: 'en-US-JennyNeural',   name: 'Jenny (US English)',       gender: 'Female' as const, locale: 'en-US' },
  { id: 'hi-IN-SwaraNeural',   name: 'Swara (Hindi)',            gender: 'Female' as const, locale: 'hi-IN' },
  { id: 'hi-IN-MadhurNeural',  name: 'Madhur (Hindi)',           gender: 'Male'   as const, locale: 'hi-IN' },
];

export const TONE_DESCRIPTIONS: Record<VideoTone, string> = {
  AGGRESSIVE:   'High energy, bold claims, FOMO-driven',
  PROFESSIONAL: 'Analytical, measured, data-driven',
  VIRAL:        'Shocking hook, curiosity gap, highly shareable',
  EDUCATIONAL:  'Clear explanations, beginner-friendly',
  URGENT:       'Breaking news style, time-sensitive',
};

export const STYLE_DESCRIPTIONS: Record<VideoStyle, string> = {
  DYNAMIC:   'Fast cuts, motion graphics, high energy',
  MINIMAL:   'Clean visuals, simple text, elegant',
  CINEMATIC: 'Movie-like, dramatic lighting, premium',
  NEWS:      'News broadcast style, formal, credible',
  HYPE:      'Extreme energy, viral meme style',
};
