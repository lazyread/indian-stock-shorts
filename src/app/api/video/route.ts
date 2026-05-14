import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^[\d]+-[a-z0-9]+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const filePath = path.join(os.tmpdir(), 'stock-shorts', id, 'final.mp4');
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  }

  const stat    = fs.statSync(filePath);
  const total   = stat.size;
  const range   = req.headers.get('range');

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : total - 1;
    const chunk = end - start + 1;

    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(stream as unknown as ReadableStream, {
      status:  206,
      headers: {
        'Content-Range':  `bytes ${start}-${end}/${total}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': String(chunk),
        'Content-Type':   'video/mp4',
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type':        'video/mp4',
      'Content-Length':      String(total),
      'Accept-Ranges':       'bytes',
      'Content-Disposition': `inline; filename="stock-short-${id}.mp4"`,
    },
  });
}
