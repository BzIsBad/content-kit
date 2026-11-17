// Fast tests: no network, no installed tools. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { kit, tmpDir, sampleBrand } from './helpers.mjs';
import { cloudSyncCheck, freeBytes } from '../plugin/scripts/lib/system.mjs';
import { validateBrand, validateEdit } from '../plugin/scripts/lib/validate.mjs';
import { Canvas, encodePng } from '../plugin/scripts/lib/png.mjs';
import { segmentsFromWords, transcriptText, reviewPoints } from '../plugin/scripts/lib/cmd-media.mjs';
import { wordsFromTokens, chunkRanges } from '../plugin/scripts/lib/stt.mjs';

const home = tmpDir('home');

test('help and unknown commands follow the JSON contract', async () => {
  const h = await kit(['help'], { home });
  assert.equal(h.json.ok, true);
  assert.equal(h.json.commands.length, 13);
  const u = await kit(['make-coffee'], { home });
  assert.equal(u.json.code, 'UNKNOWN_COMMAND');
  const b = await kit(['scaffold', '--nope', 'x'], { home });
  assert.equal(b.json.code, 'BAD_FLAGS');
  const m = await kit(['scaffold'], { home });
  assert.equal(m.json.code, 'MISSING_FLAG');
});

test('doctor on an empty kit home reports missing pieces in plain words', async () => {
  const d = await kit(['doctor'], { home: path.join(home, 'nothing-here') });
  assert.equal(d.json.ok, true);
  assert.equal(d.json.ready, false);
  const byId = Object.fromEntries(d.json.checks.map((c) => [c.id, c]));
  for (const id of ['system', 'diskKit', 'kitHome', 'node', 'transcribe', 'render']) assert.ok(byId[id], `check ${id}`);
  assert.equal(byId.kitHome.status, 'missing');
  assert.equal(byId.render.status, 'missing');
  for (const c of d.json.checks) {
    assert.ok(['ok', 'missing', 'broken'].includes(c.status));
    if (c.status !== 'ok') assert.ok(c.fix, `${c.id} has a fix`);
  }
});

test('doctor flags a workspace inside a synced folder', async () => {
  const ws = path.join(tmpDir('ws'), 'Dropbox', 'Videos');
  fs.mkdirSync(ws, { recursive: true });
  const d = await kit(['doctor', '--workspace', ws], { home });
  const w = d.json.checks.find((c) => c.id === 'workspace');
  assert.equal(w.status, 'broken');
  assert.match(w.detail, /Dropbox/);
});

test('cloud sync detection', () => {
  const mac = { platform: 'darwin', home: '/Users/sam', env: {}, existsFn: () => false };
  assert.equal(cloudSyncCheck('/Users/sam/Content', mac).synced, false);
  assert.equal(cloudSyncCheck('/Users/sam/Library/CloudStorage/GoogleDrive-sam@example.com/My Drive/Content', mac).synced, true);
  assert.equal(cloudSyncCheck('/Users/sam/Dropbox/Content', mac).service, 'Dropbox');
  assert.equal(cloudSyncCheck('/Users/sam/Library/Mobile Documents/com~apple~CloudDocs/Content', mac).service, 'iCloud Drive');
  const icloudDesk = { ...mac, existsFn: (p) => p.endsWith('com~apple~CloudDocs/Documents') };
  assert.equal(cloudSyncCheck('/Users/sam/Documents/Content', icloudDesk).synced, true);
  assert.equal(cloudSyncCheck('/Users/sam/Desktop/Content', icloudDesk).synced, false);
  // Windows paths are only meaningful on Windows, but the segment rule is platform-neutral.
  assert.equal(cloudSyncCheck(path.join(tmpDir('x'), 'OneDrive - Example Co', 'Content')).service, 'OneDrive');
  const envRoot = tmpDir('od');
  assert.equal(cloudSyncCheck(path.join(envRoot, 'Docs'), { env: { OneDrive: envRoot } }).synced, true);
  assert.ok(freeBytes(home) > 0);
});

test('scaffold, add-brand and new-job are safe to run twice', async () => {
  const ws = tmpDir('workspace');
  const s1 = await kit(['scaffold', '--workspace', ws], { home });
  assert.equal(s1.json.ok, true);
  assert.equal(s1.json.settings.action, 'created');
  const settings = JSON.parse(fs.readFileSync(path.join(ws, '.claude', 'settings.json'), 'utf8'));
  assert.ok(settings.permissions.allow.some((r) => r.includes('kit.mjs')));
  const s2 = await kit(['scaffold', '--workspace', ws], { home });
  assert.equal(s2.json.settings.action, 'unchanged');
  assert.deepEqual(s2.json.created, []);

  const bad = await kit(['add-brand', '--workspace', ws, '--slug', 'Not OK', '--name', 'x'], { home });
  assert.equal(bad.json.code, 'BAD_SLUG');
  const a1 = await kit(['add-brand', '--workspace', ws, '--slug', 'harbor-pine', '--name', 'Harbor & Pine'], { home });
  assert.equal(a1.json.brandJson.action, 'created');
  const brandDir = a1.json.brandDir;
  for (const d of ['assets', 'examples', 'raw', 'jobs', 'exports', 'docs']) assert.ok(fs.statSync(path.join(brandDir, d)).isDirectory());
  assert.ok(fs.existsSync(path.join(brandDir, 'docs', 'lessons.md')));
  // A starter brand.json is valid as-is.
  const v = await kit(['validate', '--file', path.join(brandDir, 'brand.json')], { home });
  assert.equal(v.json.ok, true, JSON.stringify(v.json));
  // Edits survive a second add-brand.
  const bj = path.join(brandDir, 'brand.json');
  const edited = { ...JSON.parse(fs.readFileSync(bj, 'utf8')), teamSize: 3 };
  fs.writeFileSync(bj, JSON.stringify(edited));
  const a2 = await kit(['add-brand', '--workspace', ws, '--slug', 'harbor-pine', '--name', 'Harbor & Pine'], { home });
  assert.equal(a2.json.brandJson.action, 'kept');
  assert.equal(JSON.parse(fs.readFileSync(bj, 'utf8')).teamSize, 3);

  const j1 = await kit(['new-job', '--brand-dir', brandDir, '--slug', 'sourdough-tips', '--date', '2026-11-17'], { home });
  assert.equal(j1.json.job, '2026-11-17-sourdough-tips');
  assert.equal(j1.json.existed, false);
  const j2 = await kit(['new-job', '--brand-dir', brandDir, '--slug', 'sourdough-tips', '--date', '2026-11-17'], { home });
  assert.equal(j2.json.existed, true);
  const nb = await kit(['new-job', '--brand-dir', ws, '--slug', 'x'], { home });
  assert.equal(nb.json.code, 'NOT_A_BRAND');
});

test('scaffold refuses a synced workspace', async () => {
  const ws = path.join(tmpDir('sync'), 'Google Drive', 'Content');
  const r = await kit(['scaffold', '--workspace', ws], { home });
  assert.equal(r.json.code, 'CLOUD_SYNCED_FOLDER');
  assert.equal(fs.existsSync(ws), false);
});

test('brand.json validation', () => {
  assert.deepEqual(validateBrand(sampleBrand()).problems, []);
  const b = sampleBrand();
  b.colors.accent = 'orange';
  b.captions.style = 'karaoke';
  b.logo.onDark = 'C:\\logos\\x.png';
  b.reel.minSeconds = 100;
  b.teamSize = 5;
  const r = validateBrand(b);
  assert.equal(r.problems.length, 4, r.problems.join('\n'));
  assert.ok(r.warnings.some((w) => /licence/.test(w)));
});

test('edit.json validation, with and without a brand folder', () => {
  const ws = tmpDir('edit');
  const brandDir = path.join(ws, 'brands', 'harbor-pine');
  const jobDir = path.join(brandDir, 'jobs', '2026-11-17-tips');
  fs.mkdirSync(path.join(jobDir, 'work'), { recursive: true });
  fs.mkdirSync(path.join(brandDir, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(brandDir, 'raw', 'a.mp4'), 'x');
  fs.writeFileSync(path.join(jobDir, 'work', 'A.probe.json'), JSON.stringify({ durationSec: 20 }));
  const edit = {
    schemaVersion: 1, brand: 'harbor-pine', job: '2026-11-17-tips', version: 1,
    sources: [{ id: 'A', file: 'raw/a.mp4' }],
    output: { width: 1080, height: 1920, fps: 30 },
    hookTitle: { text: 'Three tips', seconds: 2 },
    segments: [{ source: 'A', in: 1, out: 6 }, { source: 'A', in: 10, out: 15.5, cropX: 0.3 }],
    captions: { enabled: true, corrections: [{ from: 'sour dough', to: 'sourdough' }] },
    overlays: [{ type: 'text', text: 'Tip 1', at: 1, seconds: 2, position: 'top' }],
    music: { file: null, volumeDb: -18 },
    endCard: true,
  };
  const ok = validateEdit(edit, { brandDir, jobDir, brand: sampleBrand() });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.clipSeconds, 10.5);
  const bad = structuredClone(edit);
  bad.segments.push({ source: 'B', in: 5, out: 4 }, { source: 'A', in: 18, out: 25 });
  bad.overlays[0].position = 'left';
  bad.sources.push({ id: 'C', file: 'raw/missing.mp4' });
  const r = validateEdit(bad, { brandDir, jobDir, brand: sampleBrand() });
  assert.equal(r.problems.length, 5, r.problems.join('\n'));
  assert.ok(r.problems.some((p) => /only 20s long/.test(p)));
});

test('validate command reports problems as a plain failure', async () => {
  const dir = tmpDir('val');
  const f = path.join(dir, 'brand.json');
  fs.writeFileSync(f, JSON.stringify({ ...sampleBrand(), colors: {} }));
  const r = await kit(['validate', '--file', f], { home });
  assert.equal(r.json.code, 'INVALID_BRAND_JSON');
  assert.equal(r.json.problems.length, 5);
  fs.writeFileSync(f, '{ not json');
  assert.equal((await kit(['validate', '--file', f], { home })).json.code, 'BAD_JSON');
});

test('PNG encoder writes a decodable image with labels', () => {
  const c = new Canvas(40, 20, [10, 20, 30]);
  c.text('1:2', 1, 1, 1);
  const png = c.toPng();
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  const idat = png.indexOf(Buffer.from('IDAT'));
  const len = png.readUInt32BE(idat - 4);
  const raw = zlib.inflateSync(png.subarray(idat + 4, idat + 4 + len));
  assert.equal(raw.length, (40 * 3 + 1) * 20);
  assert.deepEqual([...raw.subarray(1, 4)], [10, 20, 30]); // (0,0) is background
  // "1" row 0 is 0b00100: column 2 lit, so pixel (1+2, 1) is white.
  const at = (x, y) => [...raw.subarray(y * 121 + 1 + x * 3, y * 121 + 4 + x * 3)];
  assert.deepEqual(at(3, 1), [255, 255, 255]);
  assert.deepEqual(at(2, 1), [10, 20, 30]);
  assert.ok(encodePng(1, 1, Buffer.from([1, 2, 3])).length > 40);
});

test('speech tokens become words, segments and a readable text file', () => {
  // sherpa-onnx result for one chunk that starts 10 s into the recording: BPE pieces, a leading
  // space starts a word, punctuation joins the word before it, long jumps before a pause are capped.
  const res = {
    tokens: [' And', ' so', ' my', ' fel', 'low', ' Amer', 'icans', ',', ' ask', ' not', '.', ' What', ' now', '?'],
    timestamps: [0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.6, 2.0, 2.1, 2.4, 2.7, 5.0, 5.3, 5.6],
    durations: [0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.4, 0.08, 0.3, 0.3, 0.08, 0.3, 2.0, 0.08],
  };
  const words = wordsFromTokens(res, 10, 20);
  assert.deepEqual(words.map((w) => w.text), ['And', 'so', 'my', 'fellow', 'Americans,', 'ask', 'not.', 'What', 'now?']);
  assert.deepEqual(words[4], { t0: 11.3, t1: 12, text: 'Americans,' });
  assert.ok(Math.abs(words[8].t1 - 15.7) < 1e-9, 'a 2 s jump before a pause is capped at 0.4 s');
  const r = words.map((w) => ({ t0: Math.round(w.t0 * 100) / 100, t1: Math.round(w.t1 * 100) / 100, text: w.text }));
  const segs = segmentsFromWords(r);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, 'And so my fellow Americans, ask not.');
  assert.equal(transcriptText(segs), '[00:10.3] And so my fellow Americans, ask not.\n[00:15.0] What now?\n');
  // Long audio is cut into 15 to 28 s pieces at the quietest moment.
  const sr = 16000;
  const samples = new Float32Array(60 * sr).fill(0.3);
  samples.fill(0, 20 * sr, 20.5 * sr);
  const ranges = chunkRanges(samples);
  assert.equal(ranges[0][0], 0);
  assert.ok(Math.abs(ranges[0][1] / sr - 20.25) < 0.2, String(ranges[0][1] / sr));
  for (const [a, b] of ranges) assert.ok((b - a) / sr <= 28.01);
  assert.equal(ranges[ranges.length - 1][1], samples.length);
});

test('review points cover the start, every cut, overlays and the end card', () => {
  const edit = {
    hookTitle: { text: 'Hi', seconds: 2 },
    segments: [{ source: 'A', in: 0, out: 4 }, { source: 'A', in: 10, out: 12 }, { source: 'A', in: 20, out: 24 }],
    overlays: [{ type: 'text', text: 'Tip', at: 5, seconds: 2 }],
  };
  const pts = reviewPoints(edit, 11.5);
  const kinds = pts.map((p) => p.kind);
  assert.equal(kinds.filter((k) => k === 'cut-before').length, 2);
  assert.equal(kinds.filter((k) => k === 'cut-after').length, 2);
  assert.ok(kinds.includes('overlay'));
  assert.ok(kinds.includes('end-card'));
  assert.equal(pts.find((p) => p.kind === 'end-card').t, 10.75);
  assert.ok(pts.every((p, i) => i === 0 || p.t >= pts[i - 1].t));
});

test('media commands explain what to do when tools are missing', async () => {
  const ws = tmpDir('noTools');
  await kit(['scaffold', '--workspace', ws], { home });
  const a = await kit(['add-brand', '--workspace', ws, '--slug', 'harbor-pine', '--name', 'Harbor'], { home });
  const j = await kit(['new-job', '--brand-dir', a.json.brandDir, '--slug', 'x'], { home });
  fs.writeFileSync(path.join(a.json.brandDir, 'raw', 'clip.mp4'), 'not really a video');
  const emptyHome = path.join(home, 'empty');
  const i = await kit(['ingest', '--job-dir', j.json.jobDir, '--source', 'raw/clip.mp4', '--id', 'A'], { home: emptyHome });
  assert.equal(i.json.code, 'RENDER_NOT_INSTALLED');
  const t = await kit(['transcribe', '--job-dir', j.json.jobDir, '--id', 'A'], { home: emptyHome });
  assert.equal(t.json.code, 'NOT_INGESTED');
  const r = await kit(['render', '--job-dir', j.json.jobDir], { home: emptyHome });
  assert.equal(r.json.code, 'FILE_NOT_FOUND'); // no edit.json yet
  const s = await kit(['smoke-test', '--brand-dir', a.json.brandDir], { home: emptyHome });
  assert.equal(s.json.code, 'RENDER_NOT_INSTALLED');
  const nj = await kit(['ingest', '--job-dir', ws, '--source', 'x', '--id', 'A'], { home: emptyHome });
  assert.equal(nj.json.code, 'NOT_A_JOB');
});
