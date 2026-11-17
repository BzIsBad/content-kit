// ingest, transcribe, frames, review-frames

import fs from 'node:fs';
import path from 'node:path';
import { KitError, exists, fmtTime, isDir, kitPaths, log, readJsonFile, relInside, toPosix, writeFileAtomic, writeJson } from './common.mjs';
import { ffmpegOrThrow, grabFrameJpeg, grabFrameRGB, pngToJpeg, probe } from './ffmpeg.mjs';
import { Canvas, textWidth } from './png.mjs';
import { sttModelDir } from './cmd-install.mjs';
import { modelReady, transcribeWav } from './stt.mjs';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export function jobContext(flags) {
  if (typeof flags['job-dir'] !== 'string' || !flags['job-dir'].trim()) {
    throw new KitError('MISSING_FLAG', 'I need --job-dir to do this.', 'Add it, for example: --job-dir "brands/sample-studio/jobs/2026-11-17-bridal-tips"');
  }
  const jobDir = path.resolve(flags['job-dir'].trim());
  const brandDir = path.dirname(path.dirname(jobDir));
  if (!isDir(jobDir) || path.basename(path.dirname(jobDir)) !== 'jobs' || !exists(path.join(brandDir, 'brand.json'))) {
    throw new KitError('NOT_A_JOB', `${jobDir} isn't a job folder.`, 'Create the job with new-job first, and pass the folder it gives you.');
  }
  const work = path.join(jobDir, 'work');
  fs.mkdirSync(work, { recursive: true });
  return { jobDir, brandDir, work, job: path.basename(jobDir) };
}

function sourceId(flags) {
  const id = String(flags.id || '').trim();
  if (!ID_RE.test(id)) throw new KitError('BAD_ID', `"${id}" can't be used as a source id.`, 'Use a short id of letters and numbers, like A or B.');
  return id;
}

function readProbe(ctx, id) {
  const f = path.join(ctx.work, `${id}.probe.json`);
  if (!exists(f)) throw new KitError('NOT_INGESTED', `Source ${id} hasn't been prepared yet.`, `Run ingest for source ${id} first.`);
  return readJsonFile(f);
}

// ---- ingest --------------------------------------------------------------------------------

const PROXY_LONG_SIDE = 640;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export async function ingest(flags) {
  const ctx = jobContext(flags);
  const id = sourceId(flags);
  const given = String(flags.source || '').trim();
  if (!given) throw new KitError('MISSING_FLAG', 'I need --source: the video to prepare.', 'Add it, for example: --source raw/my-video.mp4');
  // A relative --source is read relative to the brand folder first, as in edit.json.
  const candidates = path.isAbsolute(given) ? [given] : [path.join(ctx.brandDir, ...given.split(/[\\/]/)), path.resolve(given)];
  const src = candidates.find((c) => exists(c) && fs.statSync(c).isFile());
  if (!src) throw new KitError('SOURCE_NOT_FOUND', `I can't find the video "${given}".`, "Check the file name and that it's in the brand's raw folder.");

  const st = fs.statSync(src);
  const fingerprint = `${st.size}:${Math.round(st.mtimeMs)}`;
  const probeFile = path.join(ctx.work, `${id}.probe.json`);
  const proxy = path.join(ctx.work, `${id}.proxy.mp4`);
  const wav = path.join(ctx.work, `${id}.wav`);
  const sourceRel = relInside(ctx.brandDir, src);

  if (exists(probeFile) && !flags.force) {
    try {
      const prev = JSON.parse(fs.readFileSync(probeFile, 'utf8'));
      if (prev.fingerprint === fingerprint && path.resolve(prev.sourceAbs) === path.resolve(src) && (!prev.proxy || exists(proxy)) && (!prev.wav || exists(wav))) {
        log(`Source ${id} is already prepared.`);
        return { id, skipped: true, ...publicProbe(prev, ctx) };
      }
      if (prev.sourceAbs && path.resolve(prev.sourceAbs) !== path.resolve(src)) {
        throw new KitError('ID_IN_USE', `Source id ${id} is already used for ${prev.source} in this job.`, 'Pick a different id (like B) for this video.');
      }
    } catch (e) {
      if (e instanceof KitError) throw e;
    }
  }

  log(`Reading ${path.basename(src)}...`);
  const info = await probe(src);
  if (!info.video && !info.audio) throw new KitError('NO_MEDIA', `${path.basename(src)} has no video or sound in it.`, 'Check you picked the right file.');

  if (info.video) {
    const { width: w, height: h } = info.video;
    const size = w >= h ? `${PROXY_LONG_SIDE}x${even((PROXY_LONG_SIDE * h) / w)}` : `${even((PROXY_LONG_SIDE * w) / h)}x${PROXY_LONG_SIDE}`;
    const gop = String(Math.max(1, Math.round(info.video.fps || 30)));
    const tmp = path.join(ctx.work, `${id}.proxy.partial.mp4`);
    log(`Making a small preview copy (${size})...`);
    await ffmpegOrThrow([
      '-y', '-stats', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-s', size,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-g', gop, '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', '-f', 'mp4', tmp,
    ], { what: 'making a preview copy of the video', stream: true });
    fs.renameSync(tmp, proxy);
  }
  if (info.audio) {
    const tmp = path.join(ctx.work, `${id}.partial.wav`);
    log('Pulling out the sound for transcription...');
    await ffmpegOrThrow(['-y', '-i', src, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', tmp], { what: 'pulling the sound out of the video' });
    fs.renameSync(tmp, wav);
  }
  const record = {
    id,
    source: sourceRel || toPosix(src),
    sourceAbs: src,
    fingerprint,
    ...info,
    proxy: info.video ? `work/${id}.proxy.mp4` : null,
    wav: info.audio ? `work/${id}.wav` : null,
    ingestedAt: new Date().toISOString(),
  };
  writeJson(probeFile, record);
  const out = { id, skipped: false, ...publicProbe(record, ctx) };
  if (!sourceRel) out.warning = "This video isn't inside the brand folder. Move it into raw/ so edit.json can point at it.";
  if (!info.audio) out.warning = "This video has no sound, so there's nothing to transcribe. Use frames to look at it instead.";
  return out;
}

function publicProbe(r, ctx) {
  return {
    source: r.source,
    durationSec: r.durationSec,
    video: r.video,
    audio: r.audio,
    probe: path.join(ctx.work, `${r.id}.probe.json`),
    proxy: r.proxy ? path.join(ctx.jobDir, ...r.proxy.split('/')) : null,
    wav: r.wav ? path.join(ctx.jobDir, ...r.wav.split('/')) : null,
  };
}

// ---- transcribe ----------------------------------------------------------------------------

/** Group words into readable segments: break at sentence ends, long pauses or very long runs. */
export function segmentsFromWords(words) {
  const segs = [];
  let cur = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const gap = prev ? w.t0 - prev.t1 : 0;
    const long = cur && w.t1 - cur.t0 > 15;
    const brk = !cur || gap >= 1.0 || /[.?!]["”']?$/.test(prev.text) || (long && /[,;:]$/.test(prev.text)) || (cur && w.t1 - cur.t0 > 25);
    if (brk) {
      cur = { t0: w.t0, t1: w.t1, words: [w.text] };
      segs.push(cur);
    } else {
      cur.t1 = w.t1;
      cur.words.push(w.text);
    }
  }
  return segs.map((s) => ({ t0: s.t0, t1: s.t1, text: s.words.join(' ') }));
}

const r2 = (x) => Math.round(x * 100) / 100;

export function transcriptText(segments) {
  const stamp = (t) => {
    const m = Math.floor(t / 60);
    const s = (t - m * 60).toFixed(1).padStart(4, '0');
    return `${String(m).padStart(2, '0')}:${s}`;
  };
  return segments.map((s) => `[${stamp(s.t0)}] ${s.text}`).join('\n') + '\n';
}

export async function transcribe(flags) {
  const ctx = jobContext(flags);
  const id = sourceId(flags);
  const pr = readProbe(ctx, id);
  if (!pr.wav) throw new KitError('NO_AUDIO', `Source ${id} has no sound, so there's nothing to transcribe.`, 'Use frames to look at this video instead.');
  const wav = path.join(ctx.jobDir, ...pr.wav.split('/'));
  if (!exists(wav)) throw new KitError('NOT_INGESTED', `The sound file for source ${id} is missing.`, `Run ingest for source ${id} again.`);
  const jsonOut = path.join(ctx.work, `${id}.transcript.json`);
  const txtOut = path.join(ctx.work, `${id}.transcript.txt`);
  if (!flags.force && exists(jsonOut) && exists(txtOut) && fs.statSync(jsonOut).mtimeMs >= fs.statSync(wav).mtimeMs) {
    const t = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
    log(`Source ${id} is already transcribed.`);
    return { id, skipped: true, json: jsonOut, txt: txtOut, words: t.words.length, segments: t.segments.length, durationSec: t.durationSec };
  }

  const p = kitPaths();
  const modelDir = sttModelDir(p);
  if (!exists(path.join(p.sttLib, 'node_modules', 'sherpa-onnx-node', 'package.json')) || !modelReady(modelDir)) {
    throw new KitError('TRANSCRIBE_NOT_INSTALLED', "Speech to text isn't set up on this computer yet.", 'Run install, then try again.');
  }
  log(`Listening to source ${id} (${fmtTime(pr.durationSec)} long; usually under a minute per half hour of video)...`);
  let lastPct = -10;
  let result;
  try {
    result = await transcribeWav({
      wavPath: wav,
      modelDir,
      libDir: p.sttLib,
      onProgress: (f) => {
        const pct = Math.floor(f * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          log(`  ${pct}%`);
        }
      },
    });
  } catch (e) {
    throw new KitError('TRANSCRIBE_FAILED', "Listening to the video didn't finish.", 'Run doctor to check speech to text is working, then try again.', { detail: String(e && e.message).slice(-1500) });
  }
  const words = result.words;
  const segments = segmentsFromWords(words);
  const transcript = { source: pr.source, durationSec: pr.durationSec, language: result.language || 'en', words, segments };
  writeJson(jsonOut, transcript);
  writeFileAtomic(txtOut, transcriptText(segments));
  const out = { id, skipped: false, json: jsonOut, txt: txtOut, words: words.length, segments: segments.length, durationSec: pr.durationSec };
  if (words.length === 0) out.warning = 'No speech was found. Use frames to look at this video instead.';
  return out;
}

// ---- frames (contact sheets) ---------------------------------------------------------------

const SHEET = { longSide: 320, label: 22, gap: 4, rows: 3 };

function numFlag(flags, name, def) {
  if (flags[name] === undefined) return def;
  const n = Number(flags[name]);
  if (!Number.isFinite(n) || n < 0) throw new KitError('BAD_FLAG', `--${name} should be a number of seconds.`, `For example: --${name} 30`);
  return n;
}

const nice = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export async function frames(flags) {
  const ctx = jobContext(flags);
  const id = sourceId(flags);
  const pr = readProbe(ctx, id);
  if (!pr.video) throw new KitError('NO_VIDEO', `Source ${id} is sound only, so there are no frames to show.`, 'Read its transcript instead.');
  const input = pr.proxy && exists(path.join(ctx.jobDir, ...pr.proxy.split('/'))) ? path.join(ctx.jobDir, ...pr.proxy.split('/')) : pr.sourceAbs;
  const dur = pr.durationSec;
  const from = Math.min(numFlag(flags, 'from', 0), Math.max(0, dur - 0.05));
  const to = Math.min(numFlag(flags, 'to', dur), dur);
  if (to <= from) throw new KitError('BAD_RANGE', `--to (${to}s) must be later than --from (${from}s).`, 'Pick a later end time.');
  let every = numFlag(flags, 'every', 0);
  if (!every) {
    // Aim for at most 48 frames (four sheets), rounded to a friendly step.
    const raw = (to - from) / 48;
    every = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600].find((s) => s >= raw) || Math.ceil(raw / 60) * 60;
  }
  every = Math.max(0.5, every);

  const times = [];
  for (let t = from; t < to - 0.01 && times.length < 600; t += every) times.push(Math.round(t * 100) / 100);
  if (times.length === 0) times.push(from);

  const { width: vw, height: vh } = pr.video;
  const landscape = vw >= vh;
  const cw = landscape ? SHEET.longSide : even((SHEET.longSide * vw) / vh);
  const ch = landscape ? even((SHEET.longSide * vh) / vw) : SHEET.longSide;
  const cols = Math.min(landscape ? 4 : 6, times.length);
  const perSheet = cols * SHEET.rows;
  const outDir = path.join(ctx.work, 'frames');
  fs.mkdirSync(outDir, { recursive: true });
  const base = `${id}-${nice(from)}s-${nice(to)}s-every${nice(every)}s`;

  const sheets = [];
  const nSheets = Math.ceil(times.length / perSheet);
  for (let s = 0; s < nSheets; s++) {
    const slice = times.slice(s * perSheet, (s + 1) * perSheet);
    const file = path.join(outDir, `${base}-${String(s + 1).padStart(2, '0')}.jpg`);
    const cells = slice.map((t, i) => ({ t, label: fmtTime(t), col: i % cols, row: Math.floor(i / cols) }));
    if (exists(file) && !flags.force) {
      sheets.push({ file, frames: cells });
      continue;
    }
    log(`Contact sheet ${s + 1} of ${nSheets}...`);
    const rows = Math.ceil(slice.length / cols);
    const W = cols * cw + (cols + 1) * SHEET.gap;
    const H = rows * (ch + SHEET.label) + (rows + 1) * SHEET.gap;
    const canvas = new Canvas(W, H, [20, 20, 20]);
    for (const c of cells) {
      const x = SHEET.gap + c.col * (cw + SHEET.gap);
      const y = SHEET.gap + c.row * (ch + SHEET.label + SHEET.gap);
      const rgb = await grabFrameRGB(input, c.t, cw, ch);
      if (rgb) canvas.blit(rgb, cw, ch, x, y);
      else canvas.fill(x, y, cw, ch, [60, 0, 0]);
      const label = c.label;
      canvas.text(label, x + Math.max(2, (cw - textWidth(label, 2)) / 2) | 0, y + ch + 4, 2, [255, 255, 255]);
    }
    const png = file.replace(/\.jpg$/, '.png');
    fs.writeFileSync(png, canvas.toPng());
    await pngToJpeg(png, file);
    fs.rmSync(png, { force: true });
    sheets.push({ file, frames: cells });
  }
  const index = { id, source: pr.source, from, to, every, columns: cols, sheets: sheets.map((s) => ({ file: toPosix(path.relative(ctx.jobDir, s.file)), frames: s.frames })) };
  writeJson(path.join(outDir, `${base}.json`), index);
  return { id, from, to, every, frameCount: times.length, sheets, index: path.join(outDir, `${base}.json`) };
}

// ---- review-frames -------------------------------------------------------------------------

export function videoPathFor(ctx, version, draft) {
  return draft
    ? path.join(ctx.work, `${ctx.job}-v${version}-draft.mp4`)
    : path.join(ctx.brandDir, 'exports', `${ctx.job}-v${version}.mp4`);
}

/** Work out which output times to look at, from edit.json and the rendered file's length. */
export function reviewPoints(edit, durationSec) {
  const pts = [];
  const add = (t, kind, note) => pts.push({ t: Math.max(0, Math.min(durationSec - 0.05, Math.round(t * 100) / 100)), kind, note });
  let cursor = 0;
  const segs = Array.isArray(edit.segments) ? edit.segments : [];
  add(Math.min(0.5, durationSec / 2), 'start', edit.hookTitle ? `opening, with hook title "${edit.hookTitle.text}"` : 'opening');
  segs.forEach((s, i) => {
    const len = Math.max(0, s.out - s.in);
    if (i > 0) {
      add(cursor - 0.15, 'cut-before', `end of clip ${i} (just before cut ${i})`);
      add(cursor + 0.15, 'cut-after', `start of clip ${i + 1} (just after cut ${i})`);
    }
    if (len > 3) add(cursor + len / 2, 'mid-clip', `middle of clip ${i + 1}${s.note ? `: ${s.note}` : ''}`);
    cursor += len;
  });
  for (const [i, o] of (edit.overlays || []).entries()) {
    if (typeof o.at === 'number' && o.at < cursor) add(o.at + Math.min(o.seconds || 1, 2) / 2, 'overlay', `overlay ${i + 1}: ${o.type === 'image' ? o.file : `"${o.text}"`}`);
  }
  if (durationSec - cursor > 0.4) add(cursor + (durationSec - cursor) / 2, 'end-card', 'end card');
  else add(durationSec - 0.2, 'end', 'last frame');
  return pts.sort((a, b) => a.t - b.t);
}

export async function reviewFrames(flags) {
  const ctx = jobContext(flags);
  const edit = readJsonFile(path.join(ctx.jobDir, 'edit.json'), { what: 'edit.json' });
  const version = flags.version !== undefined ? Number(flags.version) : edit.version;
  if (!Number.isInteger(version) || version < 1) throw new KitError('BAD_FLAG', '--version should be a whole number like 1.', 'For example: --version 2');
  let draft = Boolean(flags.draft);
  let video = videoPathFor(ctx, version, draft);
  if (!exists(video) && !draft && exists(videoPathFor(ctx, version, true))) {
    draft = true;
    video = videoPathFor(ctx, version, true);
  }
  if (!exists(video)) throw new KitError('NO_RENDER', `There's no rendered video for version ${version} yet.`, 'Render it first, then pull review frames.');
  const info = await probe(video);
  const outDir = path.join(ctx.jobDir, 'review', `v${version}${draft ? '-draft' : ''}`);
  fs.rmSync(outDir, { recursive: true, force: true }); // frames always match the current render
  fs.mkdirSync(outDir, { recursive: true });

  const vw = info.video ? info.video.width : 1080;
  const vh = info.video ? info.video.height : 1920;
  // 540 px wide is enough to read captions and spot crop problems, at a fraction of the size.
  const w = even(Math.min(vw, 540));
  const h = even((vh * w) / vw);
  const pts = reviewPoints(edit, info.durationSec);
  const framesOut = [];
  for (const [i, p] of pts.entries()) {
    const file = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${p.kind}-${p.t.toFixed(2)}s.jpg`);
    const ok = await grabFrameJpeg(video, p.t, w, h, file);
    framesOut.push({ ...p, file: ok ? file : null });
  }
  // Basic checks Claude should know about before looking.
  const checks = [];
  const exp = edit.output || { width: 1080, height: 1920 };
  if (info.video && !draft && (info.video.width !== exp.width || info.video.height !== exp.height)) {
    checks.push(`The video is ${info.video.width}x${info.video.height} but edit.json asks for ${exp.width}x${exp.height}.`);
  }
  if (!info.audio) checks.push('The video has no sound track.');
  writeJson(path.join(outDir, 'frames.json'), { video: toPosix(path.relative(ctx.brandDir, video)), version, draft, durationSec: info.durationSec, frames: framesOut.map((f) => ({ ...f, file: f.file && path.basename(f.file) })), checks });
  return { version, draft, video, durationSec: info.durationSec, dir: outDir, frames: framesOut, checks };
}
