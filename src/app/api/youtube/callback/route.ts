import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/youtube';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) {
    return new Response('<h2>Error: missing code</h2>', { headers: { 'Content-Type': 'text/html' } });
  }
  try {
    await exchangeCode(code);
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center">
          <h2 style="color:#4ade80">YouTube Connected!</h2>
          <p>You can close this tab and return to the app.</p>
          <script>window.opener?.postMessage('yt-auth-done','*');setTimeout(()=>window.close(),1500)</script>
        </div>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (err) {
    return new Response(
      `<h2>Auth error: ${err instanceof Error ? err.message : String(err)}</h2>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
}
