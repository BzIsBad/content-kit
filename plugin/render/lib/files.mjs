// A tiny read-only file server on 127.0.0.1. The composition loads local footage,
// logos, fonts and music over http://, which behaves the same on macOS, Windows
// and Linux (no file:// or drive-letter quirks, and big videos are never copied).
// Only files that were registered are reachable, by an opaque id.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

export async function startFileServer() {
  const registry = new Map();
  let counter = 0;

  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, cors); res.end(); return; }
    const m = /^\/f\/(\d+)\//.exec(req.url || '');
    const file = m ? registry.get(m[1]) : null;
    if (!file) { res.writeHead(404, cors); res.end(); return; }
    let stat;
    try { stat = fs.statSync(file); } catch { res.writeHead(404, cors); res.end(); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const base = { ...cors, 'Accept-Ranges': 'bytes', 'Content-Type': type };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (range && (range[1] !== '' || range[2] !== '')) {
      if (range[1] === '') { start = Math.max(0, stat.size - Number(range[2])); }
      else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { ...base, 'Content-Range': `bytes */${stat.size}` }); res.end(); return;
      }
      status = 206;
      base['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    base['Content-Length'] = end - start + 1;
    res.writeHead(status, base);
    if (req.method === 'HEAD' || stat.size === 0) { res.end(); return; }
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  return {
    urlFor(absFile) {
      const id = String(++counter);
      registry.set(id, absFile);
      return `http://127.0.0.1:${port}/f/${id}/${encodeURIComponent(path.basename(absFile))}`;
    },
    close() {
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
