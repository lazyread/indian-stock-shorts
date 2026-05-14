# 🎬 Indian Stock Shorts AI — Complete Automation Platform

Automatically generate, render, and upload viral YouTube Shorts about Indian stocks using AI.

## ✨ What It Does

1. **You enter:** stock name + market data
2. **AI generates:** a 60-second viral script (GPT-4o)
3. **AI creates:** cinematic images for every scene (Stability AI / DALL-E 3)
4. **AI narrates:** female Indian-accent voiceover (Edge TTS / Azure Speech)
5. **System renders:** 1080×1920 vertical video with Ken Burns effects, burned subtitles, music
6. **Auto-uploads:** directly to YouTube Shorts with SEO title, description, hashtags, tags
7. **Dashboard tracks:** all jobs, progress, analytics

---

## 🚀 Quick Start

### 1. Prerequisites

```bash
# Install system dependencies
brew install ffmpeg postgresql redis

# Start services
brew services start postgresql
brew services start redis

# Install Python edge-tts (free TTS fallback)
pip3 install edge-tts
```

### 2. Clone & Install

```bash
git clone <your-repo>
cd indian-stock-shorts
npm install --legacy-peer-deps
```

### 3. Environment Setup

```bash
cp .env.example .env.local
# Fill in your API keys (see Environment Variables section below)
```

### 4. Database Setup

```bash
# Create database
createdb stock_shorts_db

# Push schema & generate client
npm run db:push
npm run db:generate
```

### 5. Run Development

```bash
# Terminal 1: Web app
npm run dev:web

# Terminal 2: Background worker
npm run dev:worker

# Or run both together:
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis URL for BullMQ queue |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk auth public key |
| `CLERK_SECRET_KEY` | ✅ | Clerk auth secret key |
| `OPENAI_API_KEY` | ✅ | GPT-4o for script + SEO generation |
| `STABILITY_API_KEY` | ⭐ | Stability AI SDXL for images |
| `AZURE_SPEECH_KEY` | ⭐ | Azure Speech for high-quality TTS |
| `AZURE_SPEECH_REGION` | ⭐ | Azure region (e.g. `eastus`) |
| `CLOUDINARY_CLOUD_NAME` | ✅ | Cloudinary cloud storage |
| `CLOUDINARY_API_KEY` | ✅ | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | ✅ | Cloudinary secret |
| `YOUTUBE_CLIENT_ID` | ⭐ | Google OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | ⭐ | Google OAuth client secret |
| `YOUTUBE_REDIRECT_URI` | ⭐ | OAuth callback URL |
| `FFMPEG_PATH` | — | ffmpeg binary (auto-detected) |
| `FFPROBE_PATH` | — | ffprobe binary (auto-detected) |

> ✅ Required · ⭐ Required for full functionality (graceful fallbacks exist)

---

## 🏗 Architecture

```
indian-stock-shorts/
├── src/
│   ├── app/
│   │   ├── (auth)/               # Clerk sign-in / sign-up pages
│   │   ├── (dashboard)/          # Protected dashboard pages
│   │   │   ├── dashboard/        # Overview + stats
│   │   │   ├── create/           # 4-step creation form
│   │   │   ├── videos/           # Video grid + detail view
│   │   │   ├── queue/            # YouTube upload queue
│   │   │   ├── analytics/        # Charts & metrics
│   │   │   └── settings/         # API keys, voice, defaults
│   │   └── api/
│   │       ├── projects/         # CRUD + status polling
│   │       ├── queue/            # Upload queue management
│   │       ├── youtube/          # OAuth + upload
│   │       ├── analytics/        # Stats endpoint
│   │       ├── settings/         # User settings
│   │       └── webhooks/clerk/   # User sync
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── script-generator.ts   # GPT-4o: script, scenes, SEO
│   │   │   └── image-generator.ts    # Stability AI / DALL-E 3
│   │   ├── tts/
│   │   │   └── voice-generator.ts    # Azure Speech / edge-tts-universal
│   │   ├── video/
│   │   │   └── renderer.ts           # FFmpeg pipeline (Ken Burns, subs, encode)
│   │   ├── youtube/
│   │   │   └── uploader.ts           # YouTube Data API v3 upload
│   │   ├── storage/
│   │   │   └── index.ts              # Cloudinary upload helpers
│   │   ├── queue/
│   │   │   └── index.ts              # BullMQ queues
│   │   └── db/
│   │       └── client.ts             # Prisma singleton
│   ├── components/
│   │   ├── layout/                   # Sidebar + TopBar
│   │   ├── dashboard/                # Stats, video grid, queue cards
│   │   └── forms/                    # 4-step create form
│   ├── hooks/                        # useProjectStatus, useAnalytics
│   └── types/                        # Shared TypeScript types
├── worker/
│   └── src/
│       ├── index.ts                  # BullMQ worker entry point
│       └── processors/
│           └── video-pipeline.ts     # Full 5-step pipeline
├── prisma/
│   └── schema.prisma                 # PostgreSQL schema
├── docker-compose.yml
└── Dockerfile
```

### Pipeline Flow

```
User submits form
      │
      ▼
[POST /api/projects] → create DB record → addVideoJob() to BullMQ
      │
      ▼ (worker picks up job)
1. generateScript()     → OpenAI GPT-4o → DB: scripts + scenes + seo_meta
      │
      ▼
2. generateSceneImages() → Stability AI SDXL → Cloudinary → DB: scene_images
      │
      ▼
3. generateVoiceover()  → Azure/EdgeTTS → normalize → Cloudinary → DB: voice_files
      │
      ▼
4. renderVideo()        → FFmpeg (Ken Burns + subtitles + audio mix) → Cloudinary → DB: final_videos
      │
      ▼
5. uploadToYouTube()    → YouTube Data API v3 → DB: youtube_video_id
      │
      ▼
status: COMPLETED ✅
```

---

## 🐳 Docker Deployment

```bash
# Build and run everything
docker-compose up -d --build

# Run migrations
docker-compose exec web npx prisma db push

# View logs
docker-compose logs -f worker
docker-compose logs -f web
```

---

## ☁️ Production Deployment

### Frontend (Vercel)

```bash
# Deploy Next.js web app
vercel --prod

# Set environment variables in Vercel Dashboard
```

### Worker + Database (Railway)

```bash
# Deploy worker service separately
railway up

# Provision PostgreSQL and Redis via Railway
```

### Required Vercel Settings

- Framework: Next.js
- Build command: `npm run build`
- Install command: `npm install --legacy-peer-deps`
- Node version: 20.x

---

## 🎯 API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET | List all user projects (paginated) |
| `/api/projects` | POST | Create project + queue generation job |
| `/api/projects/:id` | GET | Get full project with all relations |
| `/api/projects/:id` | DELETE | Delete project + cloud assets |
| `/api/projects/:id/status` | GET | Lightweight status poll (3s interval) |
| `/api/projects/:id/retry` | POST | Re-queue a failed project |
| `/api/queue` | GET | Upload queue + BullMQ stats |
| `/api/queue` | POST | Manually queue upload for a project |
| `/api/youtube/connect` | GET | Start YouTube OAuth flow |
| `/api/youtube/callback` | GET | OAuth callback (set in Google Console) |
| `/api/youtube/status` | GET | Check YouTube connection |
| `/api/youtube/status` | DELETE | Disconnect YouTube account |
| `/api/analytics` | GET | Dashboard analytics data |
| `/api/settings` | GET | User settings |
| `/api/settings` | PATCH | Update user settings |

---

## 🔧 Useful Commands

```bash
# Database
npm run db:push          # Push schema changes
npm run db:migrate       # Create migration
npm run db:studio        # Open Prisma Studio GUI

# Development
npm run dev              # Start web + worker
npm run dev:web          # Web only
npm run dev:worker       # Worker only

# Production
npm run build            # Build Next.js
npm run start            # Start production web
npm run worker           # Start production worker
```

---

## 📈 Scaling for SaaS

This architecture is ready for multi-user SaaS:

1. **Authentication** — Clerk handles multi-tenant auth out of the box
2. **Job isolation** — Each user's jobs are isolated by `userId` in BullMQ
3. **Rate limiting** — Add per-user job limits in `addVideoJob()`
4. **Billing** — `APIUsage` table tracks per-user AI costs for metered billing
5. **Horizontal scaling** — Run multiple worker replicas; BullMQ handles coordination
6. **Storage** — Cloudinary folder structure is already per-user (`projects/{userId}/...`)

---

## 🛠 Troubleshooting

**Voice generation fails:** Install Python edge-tts: `pip3 install edge-tts`

**Image generation fails:** Ensure `STABILITY_API_KEY` or `OPENAI_API_KEY` is set

**Video render fails:** Ensure ffmpeg is installed: `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux)

**Redis connection error:** Start Redis: `brew services start redis` or `redis-server`

**YouTube upload fails:** Reconnect YouTube in Settings. Ensure OAuth redirect URI matches exactly.

---

Built with Next.js 14 · PostgreSQL · BullMQ · OpenAI · Stability AI · Azure Speech · FFmpeg · Cloudinary · YouTube API
