import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { uploadToYouTube } from '@/lib/youtube';

export async function POST(req: NextRequest) {
  const { jobId, title, description, tags } = await req.json() as {
    jobId:       string;
    title:       string;
    description: string;
    tags:        string[];
  };

  if (!jobId || !/^[\d]+-[a-z0-9]+$/.test(jobId)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  }

  const videoPath = path.join(os.tmpdir(), 'stock-shorts', jobId, 'final.mp4');
  if (!fs.existsSync(videoPath)) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  }

  try {
    const youtubeUrl = await uploadToYouTube({ videoPath, title, description, tags });
    return NextResponse.json({ youtubeUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
