import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { KitError } from './errors.mjs';
import { startFileServer } from './files.mjs';
import { readJson, normaliseBrand, buildReelPlan, buildSmokePlan, resolveInside } from './plan.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

// The renderer packages are loaded on demand so `--help` and bad-argument errors are instant.
async function loadRemotion() {
  try {
    const [{ bundle }, renderer] = await Promise.all([import('@remotion/bundler'), import('@remotion/renderer')]);
    return { bundle, ...renderer };
  } catch (e) {
    throw new KitError('RENDER_TOOLS_MISSING', 'The video tools are not installed in the kit yet.',
      'Ask Claude to run the kit installer (it installs the video tools), then try again.' + (process.env.CONTENT_KIT_DEBUG ? ` (${e.message})` : ''));
  }
}

function hashDir(dir, h, skip = new Set()) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (skip.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) hashDir(p, h);
    else { h.update(name); h.update(String(st.size)); h.update(fs.readFileSync(p)); }
  }
}

/** Bundle the composition once and reuse the result until the source changes. */
async function ensureBundle(remotion) {
  const h = crypto.createHash('sha1');
  hashDir(path.join(ROOT, 'src'), h);
  hashDir(path.join(ROOT, 'public'), h);
  h.update(fs.readFileSync(path.join(ROOT, 'package-lock.json')));
  const key = h.digest('hex').slice(0, 16);
  const outDir = path.join(ROOT, '.bundle');
  const stamp = path.join(outDir, '.bundle-key');
  try {
    if (fs.readFileSync(stamp, 'utf8') === key) return outDir;
  } catch { /* build below */ }
  log('Getting the video tools ready (the first time takes a minute)...');
  fs.rmSync(outDir, { recursive: true, force: true });
  await remotion.bundle({ entryPoint: path.join(ROOT, 'src', 'index.jsx'), outDir, publicDir: path.join(ROOT, 'public'), onProgress: () => {} });
  fs.writeFileSync(stamp, key);
  return outDir;
}

async function probeSources(brandDir, edit, known = {}) {
  const map = new Map();
  // Durations the kit already measured (from --media) are used as they are; the raw file isn't opened.
  for (const s of edit.sources || []) {
    const abs = resolveInside(brandDir, s?.file);
    if (abs && known[s.id] && Number.isFinite(known[s.id].durationSec)) map.set(abs, { durationSec: known[s.id].durationSec });
  }
  if (edit.sources && edit.sources.every((s) => known[s?.id])) return (abs) => map.get(abs) || null;
  let parse;
  try {
    ({ parseMedia: parse } = await import('@remotion/media-parser'));
    var { nodeReader } = await import('@remotion/media-parser/node');
  } catch { return () => null; }
  for (const s of edit.sources || []) {
    const abs = resolveInside(brandDir, s?.file);
    if (!abs || !fs.existsSync(abs)) continue;
    try {
      const r = await parse({ src: abs, reader: nodeReader, acknowledgeRemotionLicense: true, fields: { durationInSeconds: true, dimensions: true } });
      map.set(abs, { durationSec: r.durationInSeconds ?? null, width: r.dimensions?.width, height: r.dimensions?.height });
    } catch { /* best effort only; the render will report a real problem */ }
  }
  return (abs) => map.get(abs) || null;
}

// Remotion is free for small teams. The kit counts the helper who set it up too, so a business of
// three or more is told once, at setup, that it may need its own licence later. A render never
// stops or nags over it: with a key in REMOTION_LICENSE_KEY it is used, a team of one or two
// uses the free licence, and anyone else renders without a key.
function licenseFor(brand) {
  if (process.env.REMOTION_LICENSE_KEY) return process.env.REMOTION_LICENSE_KEY;
  if (brand.teamSize == null || brand.teamSize < 3) return 'free-license';
  return undefined;
}

async function renderPlan({ plan, warnings, info, brand, outFile, draft, remotion, serveUrl, bundleStep }) {
  void bundleStep;
  const { selectComposition, renderMedia, ensureBrowser } = remotion;
  log('Checking the video renderer...');
  try {
    await ensureBrowser({ logLevel: 'error', onBrowserDownload: () => {
      log('Downloading the browser the renderer uses (one time, about 100 MB)...');
      return { version: null, onProgress: ({ percent }) => { if (Math.round(percent * 100) % 25 === 0) log(`  download ${Math.round(percent * 100)}%`); } };
    } });
  } catch (e) {
    throw new KitError('BROWSER_MISSING', 'I could not get the browser that the video renderer needs.',
      `Check that this computer is online, then try again.${process.env.CONTENT_KIT_DEBUG ? ` (${e.message})` : ''}`);
  }
  const licenseKey = licenseFor(brand);
  const inputProps = { plan };
  const composition = await selectComposition({ serveUrl, id: 'Reel', inputProps, logLevel: 'error', licenseKey });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const partial = outFile.replace(/\.mp4$/i, '') + `.partial-${process.pid}.mp4`;
  let lastPct = -1;
  const started = Date.now();
  log(`Rendering ${composition.durationInFrames} frames${draft ? ' (draft: smaller and faster)' : ''}...`);
  try {
    await renderMedia({
      composition, serveUrl, codec: 'h264', outputLocation: partial, inputProps, logLevel: 'error', licenseKey,
      overwrite: true, crf: draft ? 32 : 18, x264Preset: draft ? 'ultrafast' : 'medium', scale: draft ? 0.5 : 1,
      timeoutInMilliseconds: 120000, concurrency: Math.max(1, Math.min(os.cpus().length - 1, 8)),
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100 / 10) * 10;
        if (pct !== lastPct) { lastPct = pct; log(`  ${pct}%`); }
      },
    });
    fs.renameSync(partial, outFile);
  } catch (e) {
    fs.rmSync(partial, { force: true });
    throw new KitError('RENDER_FAILED', 'The video could not be finished.',
      `Try again. If it keeps happening, ask Claude to look at the details. (${String(e.message).split('\n')[0].slice(0, 300)})`);
  }
  log(`Done in ${Math.round((Date.now() - started) / 1000)} s.`);
  return {
    ok: true, file: outFile, durationSec: Number((plan.durationInFrames / plan.fps).toFixed(3)),
    width: Math.round(plan.width * (draft ? 0.5 : 1)), height: Math.round(plan.height * (draft ? 0.5 : 1)), fps: plan.fps,
    draft: Boolean(draft), ...info, warnings,
  };
}

function checkOut(out) {
  if (!out) throw new KitError('BAD_ARGS', 'I was not told where to save the video.', 'Pass --out with a file name ending in .mp4.');
  const abs = path.resolve(out);
  if (!/\.mp4$/i.test(abs)) throw new KitError('BAD_ARGS', 'The video file name has to end in .mp4.', 'Use a name like exports/my-reel-v1.mp4.');
  return abs;
}

function loadBrand(brandDir) {
  const dir = path.resolve(brandDir || '');
  if (!brandDir || !fs.existsSync(dir)) throw new KitError('BRAND_NOT_FOUND', 'I can not find that brand folder.', 'Check the brand folder name, or ask Claude to set the brand up first.');
  const raw = readJson(path.join(dir, 'brand.json'), 'BRAND_NOT_FOUND', 'the brand file (brand.json)', 'Ask Claude to set the brand up first.');
  return { dir, brand: normaliseBrand(raw) };
}

/** The kit's render copies (see the kit's cuts.mjs): { sources: {id: {durationSec}}, segments: [{index, file, offsetSec}] }. */
function loadMedia(media) {
  if (!media) return null;
  try {
    return JSON.parse(fs.readFileSync(path.resolve(media), 'utf8'));
  } catch {
    throw new KitError('BAD_ARGS', 'I could not read the list of prepared clips.', 'Run the render again; the kit makes that list itself.');
  }
}

export async function renderReel({ brandDir, jobDir, out, media, draft }) {
  const outFile = checkOut(out);
  const { dir, brand } = loadBrand(brandDir);
  const job = path.resolve(jobDir || '');
  if (!jobDir || !fs.existsSync(job)) throw new KitError('JOB_NOT_FOUND', 'I can not find that job folder.', 'Check the job folder name.');
  const edit = readJson(path.join(job, 'edit.json'), 'EDIT_NOT_FOUND', 'the edit file (edit.json)', 'Ask Claude to write the edit first.');
  const mediaMap = loadMedia(media);
  const remotion = await loadRemotion();
  const probe = await probeSources(dir, edit, mediaMap?.sources || {});
  const server = await startFileServer();
  try {
    const { plan, warnings, info } = buildReelPlan({ brand, edit, brandDir: dir, jobDir: job, server, probe, media: mediaMap, draft });
    const serveUrl = await ensureBundle(remotion);
    return await renderPlan({ plan, warnings, info, brand, outFile, draft, remotion, serveUrl });
  } finally {
    await server.close();
  }
}

export async function renderSmoke({ brandDir, out, draft }) {
  const outFile = checkOut(out);
  const { dir, brand } = loadBrand(brandDir);
  const remotion = await loadRemotion();
  const server = await startFileServer();
  try {
    const { plan, warnings, info } = buildSmokePlan({ brand, brandDir: dir, server, draft });
    const serveUrl = await ensureBundle(remotion);
    return await renderPlan({ plan, warnings, info, brand, outFile, draft, remotion, serveUrl });
  } finally {
    await server.close();
  }
}

/** Download the renderer's browser ahead of time, so the first real render is quick. */
export async function prepare() {
  const remotion = await loadRemotion();
  await ensureBundle(remotion);
  log('Checking the video renderer...');
  try {
    await remotion.ensureBrowser({ logLevel: 'error', onBrowserDownload: () => { log('Downloading the browser the renderer uses (one time, about 100 MB)...'); return { version: null, onProgress: () => {} }; } });
  } catch (e) {
    throw new KitError('BROWSER_MISSING', 'I could not get the browser that the video renderer needs.', `Check that this computer is online, then try again.${process.env.CONTENT_KIT_DEBUG ? ` (${e.message})` : ''}`);
  }
  return { ok: true, ready: true };
}
