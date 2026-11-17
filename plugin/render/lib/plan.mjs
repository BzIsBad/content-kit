// Reads brand.json + edit.json (+ transcripts) and resolves everything into one
// plain "plan" object that the composition draws without making decisions.
// Optional assets that are missing never fail the render: they fall back and add
// a plain-language note to `warnings`.
import fs from 'node:fs';
import path from 'node:path';
import { KitError } from './errors.mjs';
import { cleanWords, applyCorrections, remapWords, buildPages } from './captions.mjs';

const DEFAULT_COLORS = {
  primary: '#1F2A44', secondary: '#F4EDE4', accent: '#E0703A', text: '#FFFFFF', textOutline: '#000000',
};
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac']);
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function readJson(file, code, what, fix) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { throw new KitError(code, `I could not find ${what} at ${file}.`, fix); }
  try { return JSON.parse(raw.replace(/^﻿/, '')); }
  catch (e) { throw new KitError(code.replace('NOT_FOUND', 'INVALID'), `${what} is not readable. It has a typing slip near: ${e.message}`, `Open ${file} and fix the slip, then run this again.`); }
}

/** Resolve a brand-relative path (forward slashes) to an absolute path inside rootDir, or null. */
export function resolveInside(rootDir, rel) {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const abs = path.resolve(rootDir, ...rel.split(/[\\/]+/));
  const back = path.relative(rootDir, abs);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null;
  return abs;
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function sniffFont(abs) {
  try {
    const fd = fs.openSync(abs, 'r');
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    const s = b.toString('latin1');
    return s === 'wOFF' || s === 'wOF2' || s === 'OTTO' || s === 'true' || b.readUInt32BE(0) === 0x00010000;
  } catch { return false; }
}

export function normaliseBrand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new KitError('BRAND_INVALID', 'The brand file is empty or not set up the way I expect.', 'Ask Claude to re-run the brand setup, or check brand.json.');
  }
  const colors = { ...DEFAULT_COLORS };
  for (const [k, v] of Object.entries(raw.colors || {})) {
    if (k in colors && typeof v === 'string' && COLOR_RE.test(v.trim())) colors[k] = v.trim();
  }
  const cap = raw.captions || {};
  const reel = raw.reel || {};
  const wm = reel.watermark || {};
  const ec = reel.endCard || {};
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    slug: String(raw.slug || ''),
    name: String(raw.name || raw.slug || 'Your brand'),
    teamSize: num(raw.teamSize, null),
    colors,
    fonts: { headline: raw.fonts?.headline || {}, body: raw.fonts?.body || {} },
    logo: { onDark: raw.logo?.onDark || null, onLight: raw.logo?.onLight || null },
    captions: {
      style: ['word-highlight', 'phrase', 'none'].includes(cap.style) ? cap.style : 'word-highlight',
      position: cap.position === 'center' ? 'center' : 'lower-third',
      maxWordsPerLine: Math.min(12, Math.max(1, Math.round(num(cap.maxWordsPerLine, 4)))),
      uppercase: cap.uppercase === true,
      fontSizePct: Math.min(12, Math.max(2, num(cap.fontSizePct, 5.5))),
    },
    reel: {
      framing: reel.framing === 'blur-fit' ? 'blur-fit' : 'crop-center',
      watermark: {
        enabled: wm.enabled !== false,
        corner: ['top-right', 'top-left', 'bottom-left', 'bottom-right'].includes(wm.corner) ? wm.corner : 'top-right',
        opacity: Math.min(1, Math.max(0, num(wm.opacity, 0.9))),
        sizePct: Math.min(35, Math.max(8, num(wm.sizePct, 18))),
      },
      endCard: {
        enabled: ec.enabled !== false,
        seconds: Math.min(10, Math.max(0.5, num(ec.seconds, 2))),
        cta: typeof ec.cta === 'string' ? ec.cta : '',
      },
    },
    music: { defaultTrack: raw.music?.defaultTrack || null, volumeDb: num(raw.music?.volumeDb, -18) },
  };
}

/** Assets shared by reel and smoke: fonts, logos, music, with fallbacks and warnings. */
function resolveBrandAssets(brand, brandDir, server, warnings) {
  const fonts = [];
  const fontFor = (slot, label) => {
    const f = brand.fonts[slot] || {};
    const family = typeof f.family === 'string' && f.family.trim() ? f.family.trim() : null;
    let url = null;
    if (typeof f.file === 'string' && f.file.trim()) {
      const abs = resolveInside(brandDir, f.file);
      if (!abs || !fileExists(abs)) {
        warnings.push(`The ${label} font file (${f.file}) isn't there yet, so a standard font will be used.`);
      } else if (!FONT_EXTS.has(path.extname(abs).toLowerCase()) || !sniffFont(abs)) {
        warnings.push(`The ${label} font file (${f.file}) is not a font I can read (use .ttf, .otf, .woff or .woff2), so I used the built-in font instead.`);
      } else {
        url = server.urlFor(abs);
        fonts.push({ family: `Brand-${slot}`, url });
      }
    }
    return { family, loaded: Boolean(url), css: url ? `"Brand-${slot}", "KitInter", sans-serif` : '"KitInter", sans-serif' };
  };
  const headline = fontFor('headline', 'headline');
  const body = fontFor('body', 'body');

  const logoSeen = new Map(); // one file used for both versions: one URL, one warning
  const logoUrl = (key) => {
    const rel = brand.logo[key];
    if (!rel) return null;
    if (logoSeen.has(rel)) return logoSeen.get(rel);
    const abs = resolveInside(brandDir, rel);
    let url = null;
    if (!abs || !fileExists(abs) || !IMAGE_EXTS.has(path.extname(abs).toLowerCase())) {
      warnings.push(`The logo file (${rel}) isn't there or isn't a picture, so the video has no logo in the corner and the end card shows the brand name instead.`);
    } else url = server.urlFor(abs);
    logoSeen.set(rel, url);
    return url;
  };
  const logos = { onDark: logoUrl('onDark'), onLight: logoUrl('onLight') };
  return { fonts, headline, body, logos };
}

function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function resolveMusic(fileRel, volumeDb, brandDir, server, warnings) {
  if (!fileRel) return null;
  const abs = resolveInside(brandDir, fileRel);
  if (!abs || !fileExists(abs) || !AUDIO_EXTS.has(path.extname(abs).toLowerCase())) {
    warnings.push(`The music file (${fileRel}) isn't there, so the video has no music.`);
    return null;
  }
  return { url: server.urlFor(abs), volume: Math.min(1, Math.max(0, 10 ** (volumeDb / 20))) };
}

function baseTheme(brand, assets) {
  const c = brand.colors;
  const dark = luminance(c.primary) < 0.4;
  const pickLogo = dark ? (assets.logos.onDark || assets.logos.onLight) : (assets.logos.onLight || assets.logos.onDark);
  const acc = luminance(c.accent) > 0.4 ? '#000000' : '#FFFFFF';
  return {
    name: brand.name,
    colors: c,
    onAccent: acc,
    headlineFont: assets.headline.css,
    bodyFont: assets.body.css,
    headlineFamily: assets.headline.family,
    bodyFamily: assets.body.family,
    headlineLoaded: assets.headline.loaded,
    bodyLoaded: assets.body.loaded,
    endLogoUrl: pickLogo,
    // watermark sits on top of footage of any colour; prefer the version for dark footage
    watermarkUrl: assets.logos.onDark || assets.logos.onLight,
  };
}

function watermarkOf(brand, theme) {
  const w = brand.reel.watermark;
  if (!w.enabled || !theme.watermarkUrl) return null;
  return { url: theme.watermarkUrl, corner: w.corner, opacity: w.opacity, sizePct: w.sizePct };
}

const secToFrames = (s, fps) => Math.max(1, Math.round(s * fps));

/**
 * Build the plan for a real reel.
 * probe(absSource) -> { durationSec, width, height } | null  (best effort)
 */
export function buildReelPlan({ brand, edit, brandDir, jobDir, server, probe, media = null, draft }) {
  const warnings = [];
  if (!edit || typeof edit !== 'object') throw new KitError('EDIT_INVALID', 'The edit file is empty.', 'Ask Claude to write the edit again.');
  if (!Array.isArray(edit.sources) || !edit.sources.length) throw new KitError('EDIT_INVALID', 'The edit does not list any footage.', 'Ask Claude to add the footage to the edit.');
  if (!Array.isArray(edit.segments) || !edit.segments.length) throw new KitError('EDIT_INVALID', 'The edit has no clips in it yet.', 'Ask Claude to choose some moments and write them into the edit.');
  if (edit.brand && brand.slug && edit.brand !== brand.slug) {
    warnings.push(`This edit says it is for "${edit.brand}" but the brand folder is "${brand.slug}". I used the folder you pointed me at.`);
  }

  const out = edit.output || {};
  const width = Number.isInteger(out.width) && out.width >= 240 ? out.width : 1080;
  const height = Number.isInteger(out.height) && out.height >= 240 ? out.height : 1920;
  const fps = Number.isFinite(out.fps) && out.fps >= 10 && out.fps <= 60 ? Math.round(out.fps) : 30;

  // Sources: must exist (this is the one thing that cannot fall back).
  const sources = {};
  for (const s of edit.sources) {
    if (!s || typeof s.id !== 'string') throw new KitError('EDIT_INVALID', 'A footage entry in the edit has no id.', 'Ask Claude to fix the edit.');
    const abs = resolveInside(brandDir, s.file);
    if (!abs) throw new KitError('SOURCE_OUTSIDE_BRAND', `The footage "${s.file}" is not inside this brand's folder.`, 'Move the file into the brand\'s raw folder and ask Claude to point the edit at it.');
    if (!fileExists(abs)) throw new KitError('SOURCE_MISSING', `I can not find the footage "${s.file}".`, 'Check that the file is still in the brand\'s raw folder with the same name.');
    sources[s.id] = { abs, rel: s.file, info: probe ? probe(abs) : null, url: server.urlFor(abs) };
  }

  // Segments in order, back to back.
  const framing = brand.reel.framing;
  let cursor = 0;
  const segments = [];
  const segTimes = [];
  edit.segments.forEach((seg, i) => {
    const src = sources[seg?.source];
    if (!src) throw new KitError('EDIT_INVALID', `Clip ${i + 1} uses footage "${seg?.source}" that the edit does not list.`, 'Ask Claude to fix the edit.');
    let inSec = Number(seg.in);
    let outSec = Number(seg.out);
    if (!Number.isFinite(inSec) || !Number.isFinite(outSec) || inSec < 0 || outSec <= inSec) {
      throw new KitError('SEGMENT_INVALID', `Clip ${i + 1} has a start and end that do not make sense (${seg.in} to ${seg.out} seconds).`, 'Ask Claude to fix the times for that clip.');
    }
    const dur = src.info?.durationSec;
    if (dur && inSec >= dur) {
      throw new KitError('SEGMENT_INVALID', `Clip ${i + 1} starts at ${inSec} seconds but the footage is only ${dur.toFixed(1)} seconds long.`, 'Ask Claude to pick a moment that is inside the footage.');
    }
    if (dur && outSec > dur + 0.05) {
      warnings.push(`Clip ${i + 1} ran past the end of the footage, so I stopped it at the end (${dur.toFixed(1)} s).`);
      outSec = dur;
    }
    const durationFrames = secToFrames(outSec - inSec, fps);
    const cropX = Number.isFinite(seg.cropX) ? Math.min(1, Math.max(0, seg.cropX)) : 0.5;
    // A render copy made by the kit (steady H.264 from offsetSec on) plays instead of the raw file.
    const cut = media?.segments?.find((c) => c.index === i);
    const useCut = cut && typeof cut.file === 'string' && fileExists(cut.file) && Number.isFinite(cut.offsetSec) && cut.offsetSec <= inSec;
    segments.push({
      kind: 'video', url: useCut ? server.urlFor(cut.file) : src.url, startFrame: cursor, durationFrames,
      trimBeforeFrames: Math.round((inSec - (useCut ? cut.offsetSec : 0)) * fps), cropX, framing,
    });
    segTimes.push({ source: seg.source, inSec, outSec, startFrame: cursor, durationFrames });
    cursor += durationFrames;
  });
  const contentFrames = cursor;

  const assets = resolveBrandAssets(brand, brandDir, server, warnings);
  const theme = baseTheme(brand, assets);

  // Captions
  const capBrand = brand.captions;
  const capOn = edit.captions?.enabled !== false && capBrand.style !== 'none';
  let pages = [];
  let wordCount = 0;
  if (capOn) {
    const wordsBySource = {};
    let applied = 0;
    for (const id of new Set(segTimes.map((s) => s.source))) {
      const tpath = path.join(jobDir, 'work', `${id}.transcript.json`);
      if (!fileExists(tpath)) {
        warnings.push(`There is no transcript for footage "${id}", so its clips have no captions. Ask Claude to transcribe it first.`);
        continue;
      }
      let t;
      try { t = JSON.parse(fs.readFileSync(tpath, 'utf8').replace(/^﻿/, '')); }
      catch { warnings.push(`The transcript for footage "${id}" could not be read, so its clips have no captions.`); continue; }
      const cleaned = cleanWords(t.words);
      const r = applyCorrections(cleaned, edit.captions?.corrections);
      applied += r.applied;
      wordsBySource[id] = r.words;
    }
    void applied;
    const words = remapWords(segTimes, wordsBySource, fps);
    wordCount = words.length;
    pages = buildPages(words, { maxWords: capBrand.maxWordsPerLine, fps });
    for (const p of pages) {
      const segEnd = segTimes[p.words[0].seg].startFrame + segTimes[p.words[0].seg].durationFrames;
      p.endFrame = Math.min(p.endFrame, segEnd);
      p.words = p.words.map((w) => ({ text: w.text, startFrame: w.startFrame, endFrame: w.endFrame }));
    }
  }

  // End card: edit.endCard (true/false/object) wins, otherwise the brand.
  const ecBrand = brand.reel.endCard;
  let ecOn = ecBrand.enabled;
  let ecSeconds = ecBrand.seconds;
  let ecCta = ecBrand.cta;
  if (typeof edit.endCard === 'boolean') ecOn = edit.endCard;
  else if (edit.endCard && typeof edit.endCard === 'object') {
    ecOn = edit.endCard.enabled !== false;
    if (Number.isFinite(edit.endCard.seconds)) ecSeconds = Math.min(10, Math.max(0.5, edit.endCard.seconds));
    if (typeof edit.endCard.cta === 'string') ecCta = edit.endCard.cta;
  }
  const endFrames = ecOn ? secToFrames(ecSeconds, fps) : 0;
  const endCard = ecOn ? { startFrame: contentFrames, durationFrames: endFrames, cta: ecCta, logoUrl: theme.endLogoUrl } : null;
  const durationInFrames = contentFrames + endFrames;

  // Hook title
  let hook = null;
  if (edit.hookTitle && typeof edit.hookTitle.text === 'string' && edit.hookTitle.text.trim()) {
    const s = Number.isFinite(edit.hookTitle.seconds) ? edit.hookTitle.seconds : 2.5;
    hook = { text: edit.hookTitle.text.trim(), startFrame: 0, durationFrames: Math.min(contentFrames, secToFrames(s, fps)) };
  }

  // Overlays (seconds in the output)
  const overlays = [];
  (edit.overlays || []).forEach((o, i) => {
    if (!o || typeof o !== 'object') return;
    const startFrame = Math.round((Number(o.at) || 0) * fps);
    const durationFrames = secToFrames(Number.isFinite(o.seconds) ? o.seconds : 2.5, fps);
    const position = ['top', 'center', 'bottom'].includes(o.position) ? o.position : 'top';
    if (startFrame >= contentFrames) {
      warnings.push(`Overlay ${i + 1} starts after the clips end, so it was left out.`);
      return;
    }
    const dur = Math.min(durationFrames, contentFrames - startFrame);
    if (o.type === 'text') {
      if (typeof o.text === 'string' && o.text.trim()) overlays.push({ type: 'text', text: o.text.trim(), startFrame, durationFrames: dur, position });
    } else if (o.type === 'image') {
      const abs = resolveInside(brandDir, o.file);
      if (!abs || !fileExists(abs) || !IMAGE_EXTS.has(path.extname(abs).toLowerCase())) {
        warnings.push(`Overlay ${i + 1} uses a picture (${o.file}) that is not there, so I left it out.`);
      } else overlays.push({ type: 'image', url: server.urlFor(abs), startFrame, durationFrames: dur, position });
    }
  });

  // Music: edit.music false = none; edit.music.file wins; a null or missing file = the brand default.
  const musicRel = edit.music === false ? null : (edit.music?.file || brand.music.defaultTrack);
  const musicDb = Number.isFinite(edit.music?.volumeDb) ? edit.music.volumeDb : brand.music.volumeDb;
  const music = resolveMusic(musicRel, musicDb, brandDir, server, warnings);

  return {
    plan: {
      mode: 'reel', draft: Boolean(draft), width, height, fps, durationInFrames,
      theme, fonts: assets.fonts, segments,
      captions: { style: capOn ? capBrand.style : 'none', position: capBrand.position, uppercase: capBrand.uppercase, fontSizePct: capBrand.fontSizePct, pages },
      watermark: watermarkOf(brand, theme), hook, overlays, music, endCard,
    },
    warnings,
    info: { segments: segments.length, captionWords: wordCount, captionPages: pages.length },
  };
}

/** Plan for the 5-second smoke clip: a generated test pattern, no footage needed. */
export function buildSmokePlan({ brand, brandDir, server, draft }) {
  const warnings = [];
  const fps = 30;
  const assets = resolveBrandAssets(brand, brandDir, server, warnings);
  const theme = baseTheme(brand, assets);
  const total = 5 * fps;
  const endFrames = Math.min(Math.round(brand.reel.endCard.seconds * fps), Math.round(2 * fps));
  const endStart = total - Math.max(endFrames, Math.round(1.5 * fps));
  const endDur = total - endStart;
  const sample = ['This', 'is', 'how', 'your', 'captions', 'will', 'look.'];
  const capStyle = brand.captions.style === 'none' ? 'word-highlight' : brand.captions.style;
  const wordStart = 12;
  const per = Math.floor((endStart - wordStart - 6) / sample.length);
  const words = sample.map((text, i) => ({ text, startFrame: wordStart + i * per, endFrame: wordStart + (i + 1) * per }));
  const pages = buildPages(words.map((w) => ({ ...w, seg: 0 })), { maxWords: brand.captions.maxWordsPerLine, fps })
    .map((p) => ({ ...p, endFrame: Math.min(p.endFrame, endStart), words: p.words.map(({ text, startFrame, endFrame }) => ({ text, startFrame, endFrame })) }));
  const music = resolveMusic(brand.music.defaultTrack, brand.music.volumeDb, brandDir, server, warnings);
  return {
    plan: {
      mode: 'smoke', draft: Boolean(draft), width: 1080, height: 1920, fps, durationInFrames: total,
      theme, fonts: assets.fonts,
      segments: [{ kind: 'pattern', startFrame: 0, durationFrames: endStart }],
      captions: { style: capStyle, position: brand.captions.position, uppercase: brand.captions.uppercase, fontSizePct: brand.captions.fontSizePct, pages },
      watermark: watermarkOf(brand, theme) || null,
      hook: { text: 'Your reel starts here', startFrame: 0, durationFrames: Math.round(2 * fps) },
      overlays: [{ type: 'text', text: 'Overlay text looks like this', startFrame: Math.round(2.3 * fps), durationFrames: Math.round(1.2 * fps), position: 'top' }],
      music,
      endCard: { startFrame: endStart, durationFrames: endDur, cta: brand.reel.endCard.cta, logoUrl: theme.endLogoUrl },
    },
    warnings,
    info: { segments: 0, captionWords: words.length, captionPages: pages.length },
  };
}
