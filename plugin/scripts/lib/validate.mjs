// Contract checks for brand.json (contracts §2) and edit.json (contracts §3).
// Each validator returns { problems: string[], warnings: string[] } in plain words.

import fs from 'node:fs';
import path from 'node:path';
import { SLUG_RE } from './common.mjs';

const HEX = /^#[0-9a-fA-F]{6}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/** A brand-relative path: forward slashes, not absolute, stays inside the brand folder. */
function relPathProblem(p) {
  if (typeof p !== 'string' || !p.trim()) return 'is empty';
  if (p.includes('\\')) return 'uses backslashes (use forward slashes, like assets/logo.png)';
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return 'is a full path (it should be relative to the brand folder, like assets/logo.png)';
  if (p.split('/').includes('..')) return 'points outside the brand folder';
  return null;
}

// The licence note, said the same way everywhere the kit says it. Shown once, at setup.
export const LICENCE_NOTE = 'For later: the video tool inside this kit is free for small teams. With three or more people in the business you may need your own licence for it at some point, depending on how you use it (non-profits are free). Nothing to do now, and it never stops the kit working.';
export const LICENCE_TEAM_SIZE = 3;

/**
 * Validate brand.json. With brandDir, also checks the slug matches the folder and (unless
 * checkFiles is false) that files it points to exist.
 */
export function validateBrand(b, { brandDir = null, checkFiles = true, licenceNote = true } = {}) {
  const fileMissing = (rel) => checkFiles && brandDir && !fs.existsSync(path.join(brandDir, ...rel.split('/')));
  const P = [];
  const W = [];
  if (!isObj(b)) return { problems: ['The file should hold one JSON object.'], warnings: W };

  if (b.schemaVersion !== 1) P.push('schemaVersion should be 1.');
  if (!isStr(b.slug) || !SLUG_RE.test(b.slug)) P.push('slug should be lowercase letters, numbers and hyphens, like "sample-studio".');
  else if (brandDir && path.basename(brandDir) !== b.slug) P.push(`slug is "${b.slug}" but the brand folder is named "${path.basename(brandDir)}". They should match.`);
  if (!isStr(b.name)) P.push('name (the brand name people see) is missing.');
  if (!isInt(b.teamSize) || b.teamSize < 1) P.push('teamSize should be a whole number, 1 or more.');
  else if (licenceNote && b.teamSize >= LICENCE_TEAM_SIZE) W.push(LICENCE_NOTE);

  if (!isObj(b.colors)) P.push('colors is missing.');
  else {
    for (const k of ['primary', 'secondary', 'accent', 'text', 'textOutline']) {
      if (!HEX.test(b.colors[k] ?? '')) P.push(`colors.${k} should be a colour code like "#1F2A44".`);
    }
  }

  if (!isObj(b.fonts)) P.push('fonts is missing.');
  else {
    for (const k of ['headline', 'body']) {
      const f = b.fonts[k];
      if (!isObj(f)) {
        P.push(`fonts.${k} is missing.`);
        continue;
      }
      if (!isStr(f.family)) P.push(`fonts.${k}.family (the font name) is missing.`);
      if (f.file !== null && f.file !== undefined) {
        const why = relPathProblem(f.file);
        if (why) P.push(`fonts.${k}.file ${why}.`);
        else if (fileMissing(f.file)) W.push(`The ${k} font file (${f.file}) isn't there yet, so a standard font will be used.`);
      }
    }
  }

  if (b.logo !== null && b.logo !== undefined) {
    if (!isObj(b.logo)) P.push('logo should be an object with onDark and onLight, or null.');
    else {
      const warned = new Set(); // the same file is often used for both; say it once
      for (const k of ['onDark', 'onLight']) {
        const v = b.logo[k];
        if (v === null || v === undefined) continue;
        const why = relPathProblem(v);
        if (why) P.push(`logo.${k} ${why}.`);
        else if (fileMissing(v) && !warned.has(v)) {
          warned.add(v);
          W.push(`The logo file (${v}) isn't there yet, so videos will have no logo in the corner and the end card shows the brand name instead.`);
        }
      }
    }
  }

  const c = b.captions;
  if (!isObj(c)) P.push('captions is missing.');
  else {
    if (!['word-highlight', 'phrase', 'none'].includes(c.style)) P.push('captions.style should be "word-highlight", "phrase" or "none".');
    if (!['lower-third', 'center'].includes(c.position)) P.push('captions.position should be "lower-third" or "center".');
    if (!isInt(c.maxWordsPerLine) || c.maxWordsPerLine < 1 || c.maxWordsPerLine > 12) P.push('captions.maxWordsPerLine should be a whole number from 1 to 12.');
    if (typeof c.uppercase !== 'boolean') P.push('captions.uppercase should be true or false.');
    if (!isNum(c.fontSizePct) || c.fontSizePct <= 0 || c.fontSizePct > 20) P.push('captions.fontSizePct should be a number above 0 and at most 20 (percent of the video height).');
  }

  const r = b.reel;
  if (!isObj(r)) P.push('reel is missing.');
  else {
    if (!isNum(r.minSeconds) || r.minSeconds <= 0) P.push('reel.minSeconds should be a number of seconds above 0.');
    if (!isNum(r.maxSeconds) || r.maxSeconds <= 0) P.push('reel.maxSeconds should be a number of seconds above 0.');
    if (isNum(r.minSeconds) && isNum(r.maxSeconds) && r.minSeconds > r.maxSeconds) P.push('reel.minSeconds is longer than reel.maxSeconds.');
    if (!['crop-center', 'blur-fit'].includes(r.framing)) P.push('reel.framing should be "crop-center" or "blur-fit".');
    const w = r.watermark;
    if (!isObj(w)) P.push('reel.watermark is missing.');
    else {
      if (typeof w.enabled !== 'boolean') P.push('reel.watermark.enabled should be true or false.');
      if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(w.corner)) P.push('reel.watermark.corner should be "top-left", "top-right", "bottom-left" or "bottom-right".');
      if (!isNum(w.opacity) || w.opacity < 0 || w.opacity > 1) P.push('reel.watermark.opacity should be a number from 0 to 1.');
      if (w.sizePct !== undefined && (!isNum(w.sizePct) || w.sizePct < 8 || w.sizePct > 35)) P.push('reel.watermark.sizePct should be a number from 8 to 35 (the logo\'s width as a percent of the video width).');
    }
    const e = r.endCard;
    if (!isObj(e)) P.push('reel.endCard is missing.');
    else {
      if (typeof e.enabled !== 'boolean') P.push('reel.endCard.enabled should be true or false.');
      if (!isNum(e.seconds) || e.seconds <= 0 || e.seconds > 10) P.push('reel.endCard.seconds should be a number above 0 and at most 10.');
      if (e.cta !== null && e.cta !== undefined && typeof e.cta !== 'string') P.push('reel.endCard.cta should be text or null.');
    }
  }

  const m = b.music;
  if (!isObj(m)) P.push('music is missing.');
  else {
    if (m.defaultTrack !== null && m.defaultTrack !== undefined) {
      const why = relPathProblem(m.defaultTrack);
      if (why) P.push(`music.defaultTrack ${why}.`);
      else if (fileMissing(m.defaultTrack)) W.push(`The music file (${m.defaultTrack}) isn't there yet, so videos will have no music.`);
    }
    if (!isNum(m.volumeDb) || m.volumeDb > 0 || m.volumeDb < -60) P.push('music.volumeDb should be a number from -60 to 0.');
  }
  return { problems: P, warnings: W };
}

/**
 * Validate edit.json. With brandDir/brand, also checks sources exist, segment times fit the
 * probed footage, and the total length against the brand's reel range.
 */
export function validateEdit(e, { brandDir = null, jobDir = null, brand = null, checkFiles = true } = {}) {
  const fileMissing = (rel) => checkFiles && brandDir && !fs.existsSync(path.join(brandDir, ...rel.split('/')));
  const P = [];
  const W = [];
  if (!isObj(e)) return { problems: ['The file should hold one JSON object.'], warnings: W };

  if (e.schemaVersion !== 1) P.push('schemaVersion should be 1.');
  if (!isStr(e.brand) || !SLUG_RE.test(e.brand)) P.push('brand should be the brand slug, like "sample-studio".');
  else if (brandDir && path.basename(brandDir) !== e.brand) P.push(`brand is "${e.brand}" but this job is in the "${path.basename(brandDir)}" brand folder.`);
  if (!isStr(e.job)) P.push('job (the job folder name) is missing.');
  else if (jobDir && path.basename(jobDir) !== e.job) P.push(`job is "${e.job}" but the job folder is named "${path.basename(jobDir)}".`);
  if (!isInt(e.version) || e.version < 1) P.push('version should be a whole number, 1 or more.');

  const ids = new Map();
  if (!Array.isArray(e.sources) || e.sources.length === 0) P.push('sources should list at least one video.');
  else {
    e.sources.forEach((s, i) => {
      if (!isObj(s) || !isStr(s.id)) return P.push(`sources[${i}] needs an id.`);
      if (ids.has(s.id)) P.push(`sources has the id "${s.id}" twice.`);
      const why = relPathProblem(s.file);
      if (why) P.push(`sources[${i}].file ${why}.`);
      else if (brandDir && !fs.existsSync(path.join(brandDir, ...s.file.split('/')))) P.push(`The video ${s.file} isn't in the brand folder.`);
      ids.set(s.id, s);
    });
  }

  if (e.output !== undefined) {
    const o = e.output;
    if (!isObj(o) || !isInt(o.width) || !isInt(o.height) || !isNum(o.fps) || o.width < 16 || o.height < 16 || o.fps <= 0 || o.fps > 120) {
      P.push('output should have whole-number width and height and an fps, like { "width": 1080, "height": 1920, "fps": 30 }.');
    } else if (o.width % 2 || o.height % 2) P.push('output width and height should be even numbers.');
  }

  if (e.hookTitle !== null && e.hookTitle !== undefined) {
    if (!isObj(e.hookTitle) || !isStr(e.hookTitle.text) || !isNum(e.hookTitle.seconds) || e.hookTitle.seconds <= 0) {
      P.push('hookTitle should be null, or have text and a number of seconds above 0.');
    }
  }

  let total = 0;
  const probes = new Map();
  if (!Array.isArray(e.segments) || e.segments.length === 0) P.push('segments should list at least one clip.');
  else {
    e.segments.forEach((s, i) => {
      const n = i + 1;
      if (!isObj(s)) return P.push(`Clip ${n} in segments isn't an object.`);
      if (!ids.has(s.source)) P.push(`Clip ${n} uses source "${s.source}", which isn't in sources.`);
      if (!isNum(s.in) || s.in < 0) P.push(`Clip ${n} needs an "in" time in seconds, 0 or more.`);
      if (!isNum(s.out)) P.push(`Clip ${n} needs an "out" time in seconds.`);
      if (isNum(s.in) && isNum(s.out)) {
        if (s.out <= s.in) P.push(`Clip ${n} ends (${s.out}s) before it starts (${s.in}s).`);
        else total += s.out - s.in;
        if (s.out - s.in < 0.3 && s.out > s.in) W.push(`Clip ${n} is only ${(s.out - s.in).toFixed(2)}s long, which will look like a glitch.`);
      }
      if (s.cropX !== undefined && (!isNum(s.cropX) || s.cropX < 0 || s.cropX > 1)) P.push(`Clip ${n} cropX should be a number from 0 to 1.`);
      // Check against the probed footage length, if ingest has run.
      if (jobDir && ids.has(s.source) && isNum(s.out)) {
        if (!probes.has(s.source)) {
          try {
            probes.set(s.source, JSON.parse(fs.readFileSync(path.join(jobDir, 'work', `${s.source}.probe.json`), 'utf8')));
          } catch {
            probes.set(s.source, null);
          }
        }
        const pr = probes.get(s.source);
        if (pr && isNum(pr.durationSec) && s.out > pr.durationSec + 0.05) P.push(`Clip ${n} ends at ${s.out}s but that video is only ${pr.durationSec}s long.`);
      }
    });
  }

  if (e.captions !== undefined) {
    const c = e.captions;
    if (!isObj(c)) P.push('captions should be an object.');
    else {
      if (c.enabled !== undefined && typeof c.enabled !== 'boolean') P.push('captions.enabled should be true or false.');
      if (c.corrections !== undefined && (!Array.isArray(c.corrections) || c.corrections.some((x) => !isObj(x) || !isStr(x.from) || typeof x.to !== 'string'))) {
        P.push('captions.corrections should be a list like [{ "from": "arco", "to": "R.CO" }].');
      }
    }
  }

  if (e.overlays !== undefined) {
    if (!Array.isArray(e.overlays)) P.push('overlays should be a list.');
    else {
      e.overlays.forEach((o, i) => {
        const n = i + 1;
        if (!isObj(o)) return P.push(`Overlay ${n} isn't an object.`);
        if (o.type === 'text') {
          if (!isStr(o.text)) P.push(`Overlay ${n} is a text overlay with no text.`);
        } else if (o.type === 'image') {
          const why = relPathProblem(o.file);
          if (why) P.push(`Overlay ${n} file ${why}.`);
          else if (fileMissing(o.file)) W.push(`Overlay ${n} uses a picture (${o.file}) that isn't there, so it will be left out.`);
        } else P.push(`Overlay ${n} type should be "text" or "image".`);
        if (!isNum(o.at) || o.at < 0) P.push(`Overlay ${n} needs an "at" time in seconds, 0 or more.`);
        if (!isNum(o.seconds) || o.seconds <= 0) P.push(`Overlay ${n} needs a number of seconds above 0.`);
        if (o.position !== undefined && !['top', 'center', 'bottom'].includes(o.position)) P.push(`Overlay ${n} position should be "top", "center" or "bottom".`);
        if (isNum(o.at) && total > 0 && o.at >= total) W.push(`Overlay ${n} starts at ${o.at}s, after the clips end (${total.toFixed(1)}s), so it won't show.`);
      });
    }
  }

  // music: false means no music for this video; an object can name a file (null = the brand's track).
  if (e.music !== undefined && e.music !== null && e.music !== false) {
    const m = e.music;
    if (!isObj(m)) P.push('music should be false (no music) or an object like { "file": null, "volumeDb": -18 }.');
    else {
      if (m.file !== null && m.file !== undefined) {
        const why = relPathProblem(m.file);
        if (why) P.push(`music.file ${why}.`);
        else if (fileMissing(m.file)) W.push(`The music file (${m.file}) isn't there, so the video has no music.`);
      }
      if (m.volumeDb !== undefined && (!isNum(m.volumeDb) || m.volumeDb > 0 || m.volumeDb < -60)) P.push('music.volumeDb should be a number from -60 to 0.');
    }
  }
  // endCard: true / false, or { seconds, cta } to change it for this video (enabled defaults to true).
  if (e.endCard !== undefined && typeof e.endCard !== 'boolean') {
    const c = e.endCard;
    if (!isObj(c)) P.push('endCard should be true, false, or an object like { "seconds": 2, "cta": "Book now" }.');
    else {
      if (c.enabled !== undefined && typeof c.enabled !== 'boolean') P.push('endCard.enabled should be true or false.');
      if (c.seconds !== undefined && (!isNum(c.seconds) || c.seconds <= 0 || c.seconds > 10)) P.push('endCard.seconds should be a number above 0 and at most 10.');
      if (c.cta !== undefined && c.cta !== null && typeof c.cta !== 'string') P.push('endCard.cta should be text or null.');
    }
  }

  if (brand && isObj(brand.reel) && total > 0) {
    const { minSeconds, maxSeconds } = brand.reel;
    if (isNum(minSeconds) && total < minSeconds) W.push(`The clips add up to ${total.toFixed(1)}s, shorter than this brand's ${minSeconds}s minimum.`);
    if (isNum(maxSeconds) && total > maxSeconds) W.push(`The clips add up to ${total.toFixed(1)}s, longer than this brand's ${maxSeconds}s maximum.`);
  }
  return { problems: P, warnings: W, clipSeconds: Math.round(total * 100) / 100 };
}

/** Guess which contract a parsed file follows. */
export function detectKind(obj, file) {
  const base = path.basename(file).toLowerCase();
  if (base === 'brand.json') return 'brand';
  if (base === 'edit.json') return 'edit';
  if (isObj(obj) && Array.isArray(obj.segments)) return 'edit';
  if (isObj(obj) && isObj(obj.colors)) return 'brand';
  return null;
}
