// Turns transcript words (source time) into caption pages (output frames).
// Pure functions, no I/O, so they are easy to test.

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const trailingPunct = (s) => (/[^\p{L}\p{N}]+$/u.exec(s) || [''])[0];

/** Drop sound tags like [MUSIC] and empty tokens; keep real words. */
export function cleanWords(words) {
  return (words || [])
    .map((w) => ({ t0: Number(w.t0), t1: Number(w.t1), text: String(w.text ?? '').trim() }))
    .filter((w) => w.text && Number.isFinite(w.t0) && Number.isFinite(w.t1) && !/^[[(].*[\])]$/.test(w.text))
    .sort((a, b) => a.t0 - b.t0);
}

/**
 * Apply { from, to } corrections. `from` may be several words ("my arco").
 * Matching ignores case and punctuation; trailing punctuation of the last
 * matched word is kept. Returns { words, applied } where applied counts hits.
 */
export function applyCorrections(words, corrections) {
  const rules = (corrections || [])
    .filter((c) => c && typeof c.from === 'string' && typeof c.to === 'string')
    .map((c) => ({ tokens: c.from.split(/\s+/).map(norm).filter(Boolean), to: c.to }))
    .filter((r) => r.tokens.length)
    .sort((a, b) => b.tokens.length - a.tokens.length);
  if (!rules.length) return { words, applied: 0 };
  const out = [];
  let applied = 0;
  for (let i = 0; i < words.length; ) {
    let hit = null;
    for (const r of rules) {
      if (i + r.tokens.length > words.length) continue;
      if (r.tokens.every((tok, k) => norm(words[i + k].text) === tok)) { hit = r; break; }
    }
    if (hit) {
      const last = words[i + hit.tokens.length - 1];
      out.push({ t0: words[i].t0, t1: last.t1, text: hit.to + trailingPunct(last.text) });
      i += hit.tokens.length;
      applied++;
    } else {
      out.push(words[i]);
      i++;
    }
  }
  return { words: out, applied };
}

/**
 * Remap words from source time to output frames.
 * segments: [{ source, inSec, outSec, startFrame, durationFrames }]
 * wordsBySource: { [sourceId]: words[] }  (already cleaned and corrected)
 * A word belongs to a segment when its midpoint falls inside [in, out).
 * Returns words in output order with startFrame/endFrame and a segment index.
 */
export function remapWords(segments, wordsBySource, fps) {
  const out = [];
  segments.forEach((seg, si) => {
    const words = wordsBySource[seg.source] || [];
    const segStartSec = seg.startFrame / fps;
    const segEndFrame = seg.startFrame + seg.durationFrames;
    for (const w of words) {
      const mid = (w.t0 + w.t1) / 2;
      if (mid < seg.inSec || mid >= seg.outSec) continue;
      let s = Math.round((segStartSec + (w.t0 - seg.inSec)) * fps);
      let e = Math.round((segStartSec + (w.t1 - seg.inSec)) * fps);
      s = Math.min(Math.max(s, seg.startFrame), segEndFrame - 1);
      e = Math.min(Math.max(e, s + 1), segEndFrame);
      out.push({ text: w.text, startFrame: s, endFrame: e, seg: si });
    }
  });
  return out;
}

/**
 * Group words into pages (what is on screen at one time).
 * Breaks on: maxWords, end of sentence, a comma once there are 2+ words,
 * a pause longer than 0.8 s, or a cut between segments.
 */
export function buildPages(words, { maxWords, fps }) {
  const pages = [];
  let cur = [];
  const flush = () => { if (cur.length) { pages.push({ words: cur }); cur = []; } };
  const max = Math.max(1, Math.round(maxWords || 4));
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (prev && (w.seg !== prev.seg || (w.startFrame - prev.endFrame) / fps > 0.8)) flush();
    cur.push(w);
    const endsSentence = /[.!?…]["')\]]*$/.test(w.text);
    const endsClause = /[,;:]["')\]]*$/.test(w.text) && cur.length >= 2;
    if (cur.length >= max || endsSentence || endsClause) flush();
    void i;
  });
  flush();
  // Page timing: on screen from its first word until the next page starts
  // (if that is soon), otherwise a short hold after its last word.
  const hold = Math.round(0.3 * fps);
  pages.forEach((p, i) => {
    const first = p.words[0];
    const last = p.words[p.words.length - 1];
    const next = pages[i + 1];
    p.startFrame = first.startFrame;
    let end = last.endFrame + hold;
    if (next) {
      const nextStart = next.words[0].startFrame;
      end = nextStart - last.endFrame <= hold ? nextStart : Math.min(end, nextStart);
    }
    p.endFrame = Math.max(end, last.endFrame);
    // Never run past the end of the segment the page belongs to is handled by the caller.
  });
  return pages;
}
