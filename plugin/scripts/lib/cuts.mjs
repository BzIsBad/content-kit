// Render copies ("cuts"): before a render, each clip in edit.json is copied out of the raw
// footage into a small H.264 file with the bundled ffmpeg. The renderer plays those
// copies instead of the raw file.
//
// Why: the renderer decodes video inside a headless browser. Phone footage is often HEVC (which
// the browser on many Windows PCs can't decode), 4K, rotated by a metadata flag, recorded at a
// variable frame rate, or larger than 2 GB. ffmpeg handles all of those; the browser then only
// ever sees a short H.264 file, already upright, with clean timestamps, at the size the video needs.
// Only the chosen moments are converted (about the length of the reel), and copies are reused
// across renders until the clip, the footage or the output size changes.

import fs from 'node:fs';
import path from 'node:path';
import { KitError, exists, hashText, log, writeJson } from './common.mjs';
import { ffmpegOrThrow, probe } from './ffmpeg.mjs';

const CUTS_VERSION = 2; // bump to invalidate every cached copy
const PAD_SEC = 1; // a little footage either side of each clip, so the renderer never runs off the end
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Size of the copy: never larger than needed to fill the output frame, never upscaled. */
export function cutSize(video, outW, outH) {
  const w = video.width;
  const h = video.height;
  const s = Math.min(1, Math.max(outW / w, outH / h));
  return { width: even(w * s), height: even(h * s) };
}

async function sourceInfo(ctx, srcAbs, cache) {
  if (cache.has(srcAbs)) return cache.get(srcAbs);
  const st = fs.statSync(srcAbs);
  const fingerprint = `${st.size}:${Math.round(st.mtimeMs)}`;
  let info = null;
  // Reuse what ingest already learned about this file, if it matches.
  for (const f of fs.readdirSync(ctx.work).filter((n) => n.endsWith('.probe.json'))) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(ctx.work, f), 'utf8'));
      if (p.sourceAbs && path.resolve(p.sourceAbs) === path.resolve(srcAbs) && p.fingerprint === fingerprint) info = p;
    } catch {}
  }
  if (!info) info = await probe(srcAbs);
  const out = { ...info, fingerprint };
  cache.set(srcAbs, out);
  return out;
}

/**
 * Make (or reuse) a render copy for every clip in edit.json. Writes work/render-media.json and
 * returns its path. Clips are matched to copies by their position in `segments`.
 */
export async function prepareCuts(ctx, edit) {
  const outW = (edit.output && edit.output.width) || 1080;
  const outH = (edit.output && edit.output.height) || 1920;
  const fps = Math.round((edit.output && edit.output.fps) || 30);
  const dir = path.join(ctx.work, 'cuts');
  fs.mkdirSync(dir, { recursive: true });
  const byId = new Map((edit.sources || []).map((s) => [s.id, s]));
  const infoCache = new Map();
  const segments = [];
  const sources = {};
  let made = 0;
  for (const [i, seg] of edit.segments.entries()) {
    const src = byId.get(seg.source);
    const srcAbs = path.join(ctx.brandDir, ...src.file.split('/'));
    const info = await sourceInfo(ctx, srcAbs, infoCache);
    sources[seg.source] = { durationSec: info.durationSec };
    if (!info.video) {
      throw new KitError('NO_VIDEO', `${src.file} has sound but no picture, so it can't be used as a clip.`, 'Pick a recording with video for the clips.');
    }
    const start = Math.max(0, seg.in - PAD_SEC);
    const end = info.durationSec ? Math.min(info.durationSec, seg.out + PAD_SEC) : seg.out + PAD_SEC;
    const size = cutSize(info.video, outW, outH);
    const key = hashText(CUTS_VERSION, srcAbs, info.fingerprint, start.toFixed(3), end.toFixed(3), fps, size.width, size.height).slice(0, 12);
    const file = path.join(dir, `${seg.source}-${Math.floor(start)}s-${key}.mp4`);
    if (!exists(file)) {
      const tmp = file.replace(/\.mp4$/, '.partial.mp4');
      log(`Preparing clip ${i + 1} of ${edit.segments.length} (${(end - start).toFixed(1)} s of footage)...`);
      await ffmpegOrThrow([
        '-y', '-ss', start.toFixed(3), '-i', srcAbs, '-t', (end - start).toFixed(3),
        '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
        // Keep each frame's own time (only frames with a repeated timestamp are dropped). Converting
        // to a fixed rate here (-r) shifted 60 fps footage about 50 ms behind its sound in testing;
        // the renderer already picks frames by time at the output rate.
        '-vf', `scale=${size.width}:${size.height}`, '-fps_mode', 'vfr',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-g', String(fps), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart', '-f', 'mp4', tmp,
      ], { what: `preparing clip ${i + 1} from ${src.file}` });
      fs.renameSync(tmp, file);
      made++;
    }
    segments.push({ index: i, source: seg.source, file, offsetSec: Number(start.toFixed(3)) });
  }
  // Copies no clip uses any more only take up space.
  const keep = new Set(segments.map((s) => path.basename(s.file)));
  for (const n of fs.readdirSync(dir)) if (!keep.has(n)) fs.rmSync(path.join(dir, n), { force: true });
  const mapFile = path.join(ctx.work, 'render-media.json');
  writeJson(mapFile, { schemaVersion: 1, sources, segments });
  return { mapFile, made, reused: segments.length - made };
}
