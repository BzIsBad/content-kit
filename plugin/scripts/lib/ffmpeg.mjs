// ffmpeg and ffprobe come from the render project's Remotion install (the same binaries
// `npx remotion ffmpeg` runs), so nothing else needs installing.
//
// Remotion's build is minimal: most filters are disabled (no fps, tile, drawtext, crop),
// and there is no rawvideo demuxer. What works and is used here: scale, aresample,
// libx264, aac, pcm_s16le, mjpeg, png, image2/image2pipe, and autorotation.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { KitError, kitPaths, run, exists } from './common.mjs';

function compositorPackage() {
  const { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64') return '@remotion/compositor-win32-x64-msvc';
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) return `@remotion/compositor-darwin-${arch}`;
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    let musl = false;
    try {
      musl = !process.report.getReport().header.glibcVersionRuntime;
    } catch {}
    return `@remotion/compositor-linux-${arch}-${musl ? 'musl' : 'gnu'}`;
  }
  return null;
}

let cached = null;

/** Locate Remotion's ffmpeg/ffprobe inside a render project (default: the kit home's). */
export function findBinaries(renderDir = kitPaths().render) {
  if (cached && cached.renderDir === renderDir) return cached;
  const notReady = () =>
    new KitError(
      'RENDER_NOT_INSTALLED',
      "The video tools aren't set up on this computer yet.",
      'Run the kit install step, then try again.',
    );
  if (!exists(path.join(renderDir, 'package.json'))) throw notReady();
  const pkg = compositorPackage();
  if (!pkg) {
    throw new KitError(
      'UNSUPPORTED_SYSTEM',
      `The video tools don't run on this kind of computer (${process.platform} ${process.arch}).`,
      'The kit needs a Mac, or a Windows PC using the x64 version of Node.',
    );
  }
  let dir = null;
  try {
    const req = createRequire(path.join(renderDir, 'package.json'));
    // The compositor is a dependency of @remotion/renderer; resolve it from there.
    const rendererReq = createRequire(req.resolve('@remotion/renderer'));
    dir = rendererReq(pkg).dir;
  } catch {
    throw notReady();
  }
  const ext = process.platform === 'win32' ? '.exe' : '';
  const ffmpeg = path.join(dir, `ffmpeg${ext}`);
  const ffprobe = path.join(dir, `ffprobe${ext}`);
  if (!exists(ffmpeg) || !exists(ffprobe)) throw notReady();
  if (process.platform !== 'win32') {
    for (const f of [ffmpeg, ffprobe]) {
      try {
        const mode = fs.statSync(f).mode;
        if ((mode & 0o111) === 0) fs.chmodSync(f, 0o755);
      } catch {}
    }
  }
  // Same library-path setup Remotion's own `remotion ffmpeg` command uses.
  const env = { ...process.env };
  if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = dir;
  else if (process.platform === 'linux') env.LD_LIBRARY_PATH = dir;
  else {
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
    env[key] = `${dir};${env[key] || ''}`;
  }
  cached = { renderDir, dir, ffmpeg, ffprobe, env };
  return cached;
}

export async function ffmpeg(args, opts = {}) {
  const b = findBinaries(opts.renderDir);
  const r = await run(b.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args], { env: b.env, ...opts });
  return r;
}

/** Run ffmpeg and turn a failure into a plain-words KitError. */
export async function ffmpegOrThrow(args, { what, code = 'FFMPEG_FAILED', ...opts } = {}) {
  const r = await ffmpeg(args, opts);
  if (r.code !== 0) {
    throw new KitError(code, `Something went wrong while ${what}.`, 'Check the video plays on your computer. If it does, try again; if not, re-export it as an MP4 or MOV.', {
      detail: r.stderr.slice(-1500),
    });
  }
  return r;
}

/** ffprobe a media file. Returns a compact summary. */
export async function probe(file) {
  const b = findBinaries();
  const r = await run(b.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { env: b.env });
  if (r.code !== 0) {
    throw new KitError(
      'UNREADABLE_VIDEO',
      `I can't read ${path.basename(file)} as a video. It may be damaged, still copying, or in a format the kit doesn't handle.`,
      'Check the file plays on your computer. If it does, export it again as an MP4 or MOV and drop that in instead.',
      { detail: r.stderr.slice(-1000) },
    );
  }
  const j = JSON.parse(r.stdout.toString('utf8'));
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  let rotation = 0;
  if (v) {
    const sd = (v.side_data_list || []).find((d) => typeof d.rotation === 'number');
    if (sd) rotation = sd.rotation;
    else if (v.tags && v.tags.rotate) rotation = Number(v.tags.rotate) || 0;
  }
  const rot90 = Math.abs(rotation) % 180 === 90;
  const fps = v ? parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) : null;
  const duration = Number(j.format && j.format.duration) || Number(v && v.duration) || Number(a && a.duration) || 0;
  return {
    durationSec: round3(duration),
    sizeBytes: Number(j.format && j.format.size) || null,
    container: j.format && j.format.format_name,
    video: v
      ? {
          codec: v.codec_name,
          width: rot90 ? v.height : v.width, // display size, after rotation
          height: rot90 ? v.width : v.height,
          codedWidth: v.width,
          codedHeight: v.height,
          rotation,
          fps: fps ? round3(fps) : null,
        }
      : null,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate) || null, channels: a.channels || null } : null,
  };
}

function parseRate(r) {
  if (!r || r === '0/0') return 0;
  const [n, d] = r.split('/').map(Number);
  return d ? n / d : n;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/** Grab one frame at time t as raw RGB (w*h*3 bytes). Returns null if past the end. */
export async function grabFrameRGB(input, t, w, h) {
  const r = await ffmpeg([
    '-ss', String(Math.max(0, t)), '-i', input,
    '-frames:v', '1', '-an', '-s', `${w}x${h}`,
    '-f', 'image2pipe', '-c:v', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
  const need = w * h * 3;
  if (r.code !== 0 || r.stdout.length < need) return null;
  return r.stdout.subarray(0, need);
}

/** Save one frame at time t as a JPEG scaled to w x h. Returns true on success. */
export async function grabFrameJpeg(input, t, w, h, out) {
  const r = await ffmpeg(['-y', '-ss', String(Math.max(0, t)), '-i', input, '-frames:v', '1', '-an', '-s', `${w}x${h}`, '-q:v', '3', '-f', 'image2', out]);
  return r.code === 0 && exists(out);
}

/** Convert a PNG to JPEG with ffmpeg's mjpeg encoder. */
export async function pngToJpeg(png, jpg) {
  await ffmpegOrThrow(['-y', '-i', png, '-q:v', '3', '-f', 'image2', jpg], { what: 'saving a contact sheet' });
}
