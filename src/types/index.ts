// ============================================================
// Core Types for Indian Stock Shorts AI
// ============================================================

export type VideoTone = 'AGGRESSIVE' | 'PROFESSIONAL' | 'VIRAL' | 'EDUCATIONAL' | 'URGENT';
export type VideoStyle = 'DYNAMIC' | 'MINIMAL' | 'CINEMATIC' | 'NEWS' | 'HYPE';
export type ProjectStatus =
  | 'QUEUED'
  | 'GENERATING_SCRIPT'
  | 'GENERATING_IMAGES'
  | 'CREATING_VOICE'
  | 'RENDERING_VIDEO'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'FAILED';
export type UploadStatus = 'PENDING' | 'SCHEDULED' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type YouTubeVisibility = 'PUBLIC' | 'PRIVATE' | 'UNLISTED';

// ============================================================
// Request / Form types
// ============================================================

export interface CreateVideoRequest {
  stockName: string;
  ticker: string;
  sector?: string;
  stockData: string;
  positiveNews?: string;
  negativeNews?: string;
  keyNumbers?: string;
  tone: VideoTone;
  style: VideoStyle;
  voice: string;
  autoUpload?: boolean;
  scheduleUploadAt?: string; // ISO date
  visibility?: YouTubeVisibility;
}

// ============================================================
// Script types
// ============================================================

export interface GeneratedScript {
  hook: string;
  mainContent: string;
  whyItMatters: string;
  keyNumbers: string;
  riskOpportunity: string;
  cta: string;
  fullScript: string;
  wordCount: number;
  estimatedDuration: number;
}

// ============================================================
// Scene types
// ============================================================

export interface GeneratedScene {
  sceneNumber: number;
  narration: string;
  subtitleText: string;
  imagePrompt: string;
  transition: string;
  visualStyle: string;
  duration: number;
}

// ============================================================
// SEO types
// ============================================================

export interface GeneratedSEO {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  category: string;
}

// ============================================================
// Job / Queue types
// ============================================================

export interface VideoJobData {
  projectId: string;
  userId: string;
  stockName: string;
  ticker: string;
  sector?: string;
  stockData: string;
  positiveNews?: string;
  negativeNews?: string;
  keyNumbers?: string;
  tone: VideoTone;
  style: VideoStyle;
  voice: string;
  autoUpload: boolean;
  visibility: YouTubeVisibility;
  scheduleUploadAt?: string;
}

export interface JobProgress {
  projectId: string;
  status: ProjectStatus;
  progress: number;
  message: string;
}

// ============================================================
// Video project with relations
// ============================================================

export interface VideoProjectWithRelations {
  id: string;
  userId: string;
  stockName: string;
  ticker: string;
  sector?: string | null;
  tone: VideoTone;
  style: VideoStyle;
  voice: string;
  status: ProjectStatus;
  progress: number;
  errorMessage?: string | null;
  youtubeVideoId?: string | null;
  youtubeUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  script?: ScriptData | null;
  scenes: SceneData[];
  voiceFile?: VoiceFileData | null;
  finalVideo?: FinalVideoData | null;
  seoMeta?: SEOMetaData | null;
  uploadQueue?: UploadQueueData | null;
}

export interface ScriptData {
  id: string;
  hook: string;
  mainContent: string;
  whyItMatters: string;
  keyNumbers: string;
  riskOpportunity: string;
  cta: string;
  fullScript: string;
  wordCount: number;
  estimatedDuration: number;
}

export interface SceneData {
  id: string;
  sceneNumber: number;
  narration: string;
  subtitleText: string;
  imagePrompt: string;
  transition: string;
  visualStyle: string;
  duration: number;
  selectedImageId?: string | null;
  images: SceneImageData[];
}

export interface SceneImageData {
  id: string;
  url: string;
  cloudinaryId?: string | null;
  isSelected: boolean;
  prompt: string;
}

export interface VoiceFileData {
  id: string;
  url: string;
  duration: number;
  voice: string;
  format: string;
  fileSize: number;
}

export interface FinalVideoData {
  id: string;
  url: string;
  thumbnailUrl?: string | null;
  duration: number;
  width: number;
  height: number;
  format: string;
  fileSize: number;
}

export interface SEOMetaData {
  id: string;
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  category: string;
}

export interface UploadQueueData {
  id: string;
  scheduledAt?: Date | null;
  uploadedAt?: Date | null;
  visibility: YouTubeVisibility;
  status: UploadStatus;
  youtubeVideoId?: string | null;
  youtubeUrl?: string | null;
}

// ============================================================
// Analytics types
// ============================================================

export interface AnalyticsData {
  totalVideos: number;
  completedVideos: number;
  totalViews: number;
  avgRetention: number;
  successRate: number;
  topStocks: { stock: string; count: number }[];
  weeklyUploads: { date: string; count: number }[];
  toneBreakdown: { tone: string; count: number }[];
}

// ============================================================
// YouTube types
// ============================================================

export interface YouTubeUploadRequest {
  projectId: string;
  visibility: YouTubeVisibility;
  scheduledAt?: string;
}

export interface YouTubeVideoMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: string;
  publishAt?: string;
}

// ============================================================
// Voice options
// ============================================================

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Female' | 'Male';
  locale: string;
  style?: string;
  preview?: string;
}

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'en-IN-NeerjaNeural', name: 'Neerja (Indian English)', gender: 'Female', locale: 'en-IN' },
  { id: 'en-IN-PrabhatNeural', name: 'Prabhat (Indian English)', gender: 'Male', locale: 'en-IN' },
  { id: 'en-US-JennyNeural', name: 'Jenny (US English)', gender: 'Female', locale: 'en-US' },
  { id: 'en-US-AriaNeural', name: 'Aria (US English)', gender: 'Female', locale: 'en-US' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia (British)', gender: 'Female', locale: 'en-GB' },
  { id: 'hi-IN-SwaraNeural', name: 'Swara (Hindi)', gender: 'Female', locale: 'hi-IN' },
];

// ============================================================
// Tone descriptions
// ============================================================

export const TONE_DESCRIPTIONS: Record<VideoTone, string> = {
  AGGRESSIVE: 'High energy, bold claims, FOMO-driven, urgent',
  PROFESSIONAL: 'Analytical, measured, data-driven, credible',
  VIRAL: 'Shocking hook, curiosity gap, highly shareable',
  EDUCATIONAL: 'Clear explanations, beginner-friendly, informative',
  URGENT: 'Breaking news style, time-sensitive, action-oriented',
};

export const STYLE_DESCRIPTIONS: Record<VideoStyle, string> = {
  DYNAMIC: 'Fast cuts, motion graphics, high energy',
  MINIMAL: 'Clean visuals, simple text, elegant',
  CINEMATIC: 'Movie-like, dramatic lighting, premium feel',
  NEWS: 'News broadcast style, formal, credible',
  HYPE: 'Extreme energy, viral meme style, Gen Z',
};

// ============================================================
// API Response types
// ============================================================

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
