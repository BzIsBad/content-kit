// Speech to text with no compiler and no system install: sherpa-onnx (a prebuilt npm addon for
// macOS, Windows x64 and Linux) running NVIDIA's Parakeet TDT 110M English model (ONNX, int8).
// Chosen over whisper.cpp on 2026-11-17: more accurate, better word times, about 14x faster on the
// test machine, and no build step (whisper.cpp needed Apple's command line tools on a Mac).
//
//   const { words, language } = await transcribeWav({ wavPath, modelDir, libDir, onProgress });
// words: [{ t0, t1, text }] in seconds, punctuated and cased, ready for segmentsFromWords().
//
// The npm packages (sherpa-onnx-node, seek-bzip) live in <kit home>/tools/stt/lib with their own
// package.json; pass that folder as libDir. The model (CC-BY-4.0) is fetched over plain HTTPS from
// the sherpa-onnx GitHub release, checked, and unpacked in pure JS. Only node: built-ins otherwise.

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

export const MODEL = Object.freeze({
  id: 'sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2',
  archiveBytes: 108035095,
  archiveSha256: 'f628312e9fdf8686374cb01a69425c41732529d540860311f16f37cbc32cfe9b',
  files: {
    'encoder.int8.onnx': { bytes: 131113202, sha256: '0f35509ddeb9b39002fb077d979a9fe74f06eb0bc4dd5c34f512f82e5111d657' },
    'decoder.int8.onnx': { bytes: 3955863, sha256: 'f7c331c5504c2e593c76ed22b728e3f554af6c4a383dde862e719ced08b1da19' },
    'joiner.int8.onnx': { bytes: 1411403, sha256: 'bf7dff69e9f2cdbe9943d70da358f38b361c115ba0105bae7e908e0d6ec782f6' },
    'tokens.txt': { bytes: 9953, sha256: '450e56bd2f036fe5b6aa821865838cc5aa9d8b0106134ce9a9ba0664abe6cd10' },
  },
  licence: 'CC-BY-4.0 (NVIDIA parakeet-tdt_ctc-110m)',
});

const SR = 16000;
// Chunking: Parakeet is trained on short utterances; long inputs cost memory quadratically.
// Cut at the quietest moment between MIN and MAX seconds so words are not split.
const CHUNK_MIN_S = 15;
const CHUNK_MAX_S = 28;
const QUIET_WIN_S = 0.2;
// Longest time one sub-word token may claim (Parakeet frames are 80 ms).
const MAX_TOKEN_S = 0.4;

function requireFrom(libDir) {
  return createRequire(libDir ? path.join(libDir, 'package.json') : import.meta.url);
}

function loadSherpa(libDir) {
  return requireFrom(libDir)('sherpa-onnx-node');
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** True when every model file is present at its recorded size. */
export function modelReady(modelDir) {
  return Object.entries(MODEL.files).every(([f, m]) => {
    try { return fs.statSync(path.join(modelDir, f)).size === m.bytes; } catch { return false; }
  });
}

/**
 * Download and unpack the model into modelDir (safe to run twice). Plain HTTPS fetch, checks
 * sha256 of the archive and of each file, writes each file via a temp name then renames.
 * Holds the archive (~108 MB) and the unpacked tar (~137 MB) in memory once.
 */
export async function installModel({ modelDir, libDir, onProgress } = {}) {
  if (modelReady(modelDir)) return { action: 'present', modelDir };
  const res = await fetch(MODEL.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Model download failed: HTTP ${res.status}`);
  const chunks = [];
  let got = 0;
  for await (const c of res.body) {
    chunks.push(c);
    got += c.length;
    if (onProgress) onProgress(Math.min(1, got / MODEL.archiveBytes));
  }
  const archive = Buffer.concat(chunks);
  if (sha256(archive) !== MODEL.archiveSha256) throw new Error('Model download is damaged (checksum mismatch).');
  const tar = requireFrom(libDir)('seek-bzip').decode(archive);
  const want = new Map(Object.entries(MODEL.files));
  fs.mkdirSync(modelDir, { recursive: true });
  for (let off = 0; off + 512 <= tar.length;) {
    const name = tar.toString('utf8', off, off + 100).replace(/\0[\s\S]*$/, '');
    if (!name) break;
    const size = parseInt(tar.toString('ascii', off + 124, off + 136).replace(/\0[\s\S]*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(tar[off + 156] || 48);
    const base = name.split('/').pop();
    if ((type === '0' || type === '\0') && want.has(base)) {
      const data = tar.subarray(off + 512, off + 512 + size);
      const m = want.get(base);
      if (data.length !== m.bytes || sha256(data) !== m.sha256) throw new Error(`Model file ${base} is damaged.`);
      const dest = path.join(modelDir, base);
      fs.writeFileSync(dest + '.part', data);
      fs.renameSync(dest + '.part', dest);
      want.delete(base);
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  if (want.size) throw new Error(`Model archive is missing: ${[...want.keys()].join(', ')}`);
  return { action: 'installed', modelDir };
}

/** Read a 16-bit PCM WAV into mono Float32 samples. Throws on anything else. */
export function readWav16k(file) {
  const b = fs.readFileSync(file);
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Not a WAV file: ${file}`);
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    let size = b.readUInt32LE(off + 4);
    const start = off + 8;
    if (id === 'fmt ') {
      fmt = { format: b.readUInt16LE(start), channels: b.readUInt16LE(start + 2), rate: b.readUInt32LE(start + 4), bits: b.readUInt16LE(start + 14) };
    } else if (id === 'data') {
      if (start + size > b.length) size = b.length - start; // streamed WAVs can carry a bogus size
      data = { start, size };
      break;
    }
    off = start + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`WAV has no fmt or data chunk: ${file}`);
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`WAV must be 16-bit PCM: ${file}`);
  if (fmt.rate !== SR) throw new Error(`WAV must be ${SR} Hz (got ${fmt.rate}): ${file}`);
  const ch = fmt.channels;
  const n = Math.floor(data.size / 2 / ch);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += b.readInt16LE(data.start + (i * ch + c) * 2);
    out[i] = s / ch / 32768;
  }
  return out;
}

/** Split samples into [start, end) ranges of at most CHUNK_MAX_S, cut at the quietest window. */
export function chunkRanges(samples) {
  const win = Math.round(QUIET_WIN_S * SR);
  const hop = Math.round(win / 4);
  const ranges = [];
  let start = 0;
  while (samples.length - start > CHUNK_MAX_S * SR) {
    const lo = start + CHUNK_MIN_S * SR;
    const hi = start + CHUNK_MAX_S * SR - win;
    let best = hi;
    let bestE = Infinity;
    for (let i = lo; i <= hi; i += hop) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += samples[j] * samples[j];
      if (e < bestE) { bestE = e; best = i; }
    }
    const cut = best + Math.floor(win / 2);
    ranges.push([start, cut]);
    start = cut;
  }
  if (samples.length - start > 0) ranges.push([start, samples.length]);
  return ranges;
}

/** Turn sherpa tokens (BPE pieces; a leading space starts a word) into timed words. */
export function wordsFromTokens(res, offsetSec, chunkEndSec) {
  const toks = res.tokens || [];
  const ts = res.timestamps || [];
  const du = res.durations || [];
  const words = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (!tok) continue;
    const piece = tok.trim();
    if (!piece) continue;
    const t0 = offsetSec + ts[i];
    // TDT durations say how far the decoder jumped; before a pause that jump can include silence,
    // so cap it. Punctuation tokens add text but never move a word's end.
    const dur = du.length === toks.length && du[i] > 0 ? du[i] : (i + 1 < ts.length ? ts[i + 1] - ts[i] : 0.08);
    const end = t0 + Math.min(dur, MAX_TOKEN_S);
    const isPunct = /^[^\p{L}\p{N}]+$/u.test(piece);
    const startsWord = words.length === 0 || (/^\s/.test(tok) && !isPunct);
    if (startsWord) words.push({ t0, t1: end, text: piece });
    else {
      const w = words[words.length - 1];
      w.text += piece;
      if (!isPunct) w.t1 = Math.max(w.t1, end);
    }
  }
  for (const w of words) w.t1 = Math.min(w.t1, chunkEndSec);
  return words;
}

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Transcribe a 16 kHz mono 16-bit WAV.
 * @param {{ wavPath: string, modelDir: string, onProgress?: (fraction:number)=>void, numThreads?: number, libDir?: string }} opts
 * @returns {Promise<{ words: {t0:number,t1:number,text:string}[], language: 'en' }>}
 */
export async function transcribeWav({ wavPath, modelDir, onProgress, numThreads, libDir }) {
  const sherpa = loadSherpa(libDir);
  if (!modelReady(modelDir)) throw new Error(`Speech model is missing or incomplete in ${modelDir}. Run installModel first.`);
  const threads = numThreads || Math.max(1, Math.min(4, (await import('node:os')).default.availableParallelism() - 1));
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: SR, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(modelDir, 'encoder.int8.onnx'),
        decoder: path.join(modelDir, 'decoder.int8.onnx'),
        joiner: path.join(modelDir, 'joiner.int8.onnx'),
      },
      tokens: path.join(modelDir, 'tokens.txt'),
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
    decodingMethod: 'greedy_search',
  });
  const samples = readWav16k(wavPath);
  const ranges = chunkRanges(samples);
  const words = [];
  for (let k = 0; k < ranges.length; k++) {
    const [a, b] = ranges[k];
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: SR, samples: samples.subarray(a, b) });
    await recognizer.decodeAsync(stream);
    const res = recognizer.getResult(stream);
    words.push(...wordsFromTokens(res, a / SR, b / SR));
    if (onProgress) onProgress(b / samples.length);
  }
  // Keep times monotonic: a word ends no later than the next one starts. Round like the whisper path.
  const out = [];
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    const next = words[k + 1];
    const t0 = Math.max(w.t0, out.length ? out[out.length - 1].t1 : 0);
    let t1 = next ? Math.min(w.t1, next.t0) : w.t1;
    if (t1 <= t0) t1 = t0 + 0.01;
    out.push({ t0: r2(t0), t1: r2(t1), text: w.text });
  }
  return { words: out, language: 'en' };
}
