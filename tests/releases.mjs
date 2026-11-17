// Test fixtures for self-update: a small tar writer, release archives built from this repo's
// plugin/ folder, and a local web server that answers like GitHub does for releases/latest and
// tag archives. Only node: built-ins.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './helpers.mjs';

const PLUGIN = path.join(ROOT, 'plugin');
const SKIP = new Set(['node_modules', '.bundle', 'out', '.DS_Store']);

function header(name, { size = 0, type = '0', linkname = '' } = {}) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write(type === '5' ? '0000755\0' : '0000644\0', 100, 'ascii');
  h.write('0000000\0', 108, 'ascii');
  h.write('0000000\0', 116, 'ascii');
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 'ascii');
  h.write('        ', 148, 'ascii');
  h.write(type, 156, 'ascii');
  h.write(linkname, 157, 100, 'utf8');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return h;
}

function pad(buf) {
  const rest = buf.length % 512;
  return rest ? Buffer.concat([buf, Buffer.alloc(512 - rest)]) : buf;
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}

/**
 * Build a .tar.gz. entries: { name, data?, type? ('0' file, '5' dir, '2' symlink), linkname? }.
 * Long names get a pax header, like git archive writes. A global header comes first, as from git.
 */
export function makeTarGz(entries) {
  const blocks = [];
  const g = Buffer.from(paxRecord('comment', '0123456789abcdef0123456789abcdef01234567'));
  blocks.push(header('pax_global_header', { size: g.length, type: 'g' }), pad(g));
  for (const e of entries) {
    const data = e.data ? Buffer.from(e.data) : Buffer.alloc(0);
    let name = e.name;
    if (Buffer.byteLength(name) > 100) {
      const p = Buffer.from(paxRecord('path', name));
      blocks.push(header('PaxHeader', { size: p.length, type: 'x' }), pad(p));
      name = name.slice(0, 99);
    }
    blocks.push(header(name, { size: e.type === '5' || e.type === '2' ? 0 : data.length, type: e.type || '0', linkname: e.linkname || '' }));
    if (data.length && (e.type || '0') === '0') blocks.push(pad(data));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push({ rel: `${r}/`, dir: true });
      walk(dir, r, out);
    } else if (e.isFile()) out.push({ rel: r, file: path.join(dir, r) });
  }
  return out;
}

/**
 * A release archive like GitHub's for tag v<version>: content-kit-<version>/ holding the repo,
 * with plugin/ copied from this checkout and plugin.json set to `manifestVersion` (default: version).
 * `change` maps a path inside plugin/ to new contents; `extra` adds raw tar entries.
 */
export function makeRelease(version, { manifestVersion = version, change = {}, extra = [] } = {}) {
  const top = `content-kit-${version}`;
  const entries = [{ name: `${top}/`, type: '5' }, { name: `${top}/README.md`, data: '# Content Kit\n' }, { name: `${top}/plugin/`, type: '5' }];
  for (const f of walk(PLUGIN, '', [])) {
    const name = `${top}/plugin/${f.rel}`;
    if (f.dir) {
      entries.push({ name, type: '5' });
      continue;
    }
    let data = fs.readFileSync(f.file);
    if (f.rel === '.claude-plugin/plugin.json') {
      const m = JSON.parse(data.toString('utf8'));
      m.version = manifestVersion;
      data = Buffer.from(`${JSON.stringify(m, null, 2)}\n`);
    }
    if (f.rel in change) data = Buffer.from(change[f.rel]);
    entries.push({ name, data });
  }
  return makeTarGz([...entries, ...extra.map((e) => ({ ...e, name: e.name.replace('{top}', top) }))]);
}

/**
 * A local stand-in for github.com/<owner>/<repo>. Set `server.latest` to a tag (or null for "no
 * release"), and `server.archives[tag]` to a Buffer. `server.mode` = 'normal' | 'hang' | 'error'.
 * Archive downloads redirect once (like GitHub to codeload). `server.hits` counts requests.
 */
export async function releaseServer() {
  const state = { latest: null, archives: {}, mode: 'normal', hits: 0 };
  const srv = http.createServer((req, res) => {
    state.hits++;
    if (state.mode === 'hang') return; // never answers
    if (state.mode === 'error') {
      res.writeHead(500).end('oops');
      return;
    }
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/o/content-kit/releases/latest') {
      const loc = state.latest ? `/o/content-kit/releases/tag/${encodeURIComponent(state.latest)}` : '/o/content-kit/releases';
      res.writeHead(302, { location: `http://127.0.0.1:${srv.address().port}${loc}` }).end();
      return;
    }
    let m = /^\/o\/content-kit\/archive\/refs\/tags\/(.+)\.tar\.gz$/.exec(u.pathname);
    if (m) {
      res.writeHead(302, { location: `/codeload/${m[1]}` }).end();
      return;
    }
    m = /^\/codeload\/(.+)$/.exec(u.pathname);
    if (m && state.archives[m[1]]) {
      res.writeHead(200, { 'content-type': 'application/x-gzip' }).end(state.archives[m[1]]);
      return;
    }
    res.writeHead(404).end('not found');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  state.url = `http://127.0.0.1:${srv.address().port}/o/content-kit`;
  state.close = () => new Promise((r) => {
    srv.closeAllConnections?.();
    srv.close(() => r());
  });
  return state;
}
