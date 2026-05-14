import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TOKEN_PATH = path.join(os.homedir(), '.stock-shorts-yt-token.json');

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/api/youtube/callback'
  );
}

export function getAuthUrl(): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent',
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

export function loadTokens(): Record<string, unknown> | null {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')) as Record<string, unknown>;
    }
  } catch { /* no tokens */ }
  return null;
}

export async function getAuthedClient() {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Not authenticated with YouTube');
  const client = getOAuthClient();
  client.setCredentials(tokens);
  return client;
}

export async function getChannelInfo(): Promise<{ name: string; id: string } | null> {
  try {
    const auth = await getAuthedClient();
    const yt = google.youtube({ version: 'v3', auth });
    const res = await yt.channels.list({ part: ['snippet'], mine: true });
    const ch = res.data.items?.[0];
    if (!ch) return null;
    return {
      name: ch.snippet?.title ?? 'Unknown',
      id:   ch.id ?? '',
    };
  } catch {
    return null;
  }
}

export interface UploadParams {
  videoPath:   string;
  title:       string;
  description: string;
  tags:        string[];
}

export async function uploadToYouTube(params: UploadParams): Promise<string> {
  const auth = await getAuthedClient();
  const yt   = google.youtube({ version: 'v3', auth });

  const res = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title:       params.title,
        description: params.description,
        tags:        params.tags,
        categoryId:  '25', // News & Politics
      },
      status: { privacyStatus: 'public' },
    },
    media: {
      body: fs.createReadStream(params.videoPath),
    },
  });

  return `https://youtu.be/${res.data.id}`;
}
