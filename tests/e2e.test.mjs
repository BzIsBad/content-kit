// End-to-end: real install into a temporary kit home, then every pipeline command on generated
// fixtures. Needs internet and about 1.5 GB of disk. Takes several minutes the first time.
//
//   node --test tests/                          everything
//   CONTENT_KIT_SKIP_E2E=1 node --test tests/   unit tests only
//   CONTENT_KIT_TEST_HOME=<dir>                 reuse an installed kit home between runs
//   CONTENT_KIT_TEST_CACHE=<dir>                where downloaded fixtures are cached
//
// Video fixtures are generated at test time: frames drawn in Node, encoded with Remotion's
// bundled ffmpeg, plus a public-domain speech sample for real transcription.
// Media steps run with PATH reduced to Node's own folder, so no system ffmpeg can be used.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { kit, tmpDir, sampleBrand, download, SPEECH_SAMPLE_WAV } from './helpers.mjs';
import { makeRelease, releaseServer } from './releases.mjs';
import { hashDir } from '../plugin/scripts/lib/common.mjs';
import { RENDER_SKIP } from '../plugin/scripts/lib/cmd-install.mjs';
import { Canvas } from '../plugin/scripts/lib/png.mjs';
import { findBinaries } from '../plugin/scripts/lib/ffmpeg.mjs';

const skip = process.env.CONTENT_KIT_SKIP_E2E === '1';
const home = process.env.CONTENT_KIT_TEST_HOME ? path.resolve(process.env.CONTENT_KIT_TEST_HOME) : tmpDir('e2e-home');
const cache = process.env.CONTENT_KIT_TEST_CACHE ? path.resolve(process.env.CONTENT_KIT_TEST_CACHE) : path.join(os.tmpdir(), 'ck-test-cache');
const bareEnv = { PATH: path.dirname(process.execPath), Path: path.dirname(process.execPath) };

/** Draw numbered frames in Node and encode them with the bundled ffmpeg. */
function makeVideo(bins, { out, w, h, fps, seconds, audio }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-frames-'));
  const n = Math.round(fps * seconds);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const sec = Math.floor(t);
    const hue = [[200, 60, 60], [60, 160, 80], [60, 90, 200], [190, 150, 40]][sec % 4];
    const c = new Canvas(w, h, hue);
    c.fill(Math.round(((t % 1) * (w - 40))), h - 40, 40, 20, [255, 255, 255]); // moving bar
    c.text(String(sec), Math.round(w / 2 - 30), Math.round(h / 2 - 40), 12, [255, 255, 255]);
    fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.png`), c.toPng());
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(dir, 'f%04d.png')];
  if (audio) args.push('-i', audio, '-c:a', 'aac', '-shortest');
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', out);
  const r = spawnSync(bins.ffmpeg, args, { env: bins.env, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
}

test('end to end on Linux', { skip, timeout: 60 * 60 * 1000 }, async (t) => {
  t.diagnostic(`kit home: ${home}`);

  await t.test('install sets everything up', async () => {
    const r = await kit(['install'], { home });
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal(r.json.ready, true, JSON.stringify(r.json.checks, null, 1));
    const state = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8'));
    assert.match(state.stt.model, /parakeet/);
    assert.equal(state.whisper, undefined);
    assert.ok(fs.existsSync(path.join(home, 'kit.mjs')), 'launcher in the kit home');
    assert.ok(state.render.sourceHash);
    assert.equal(state.node.path, process.execPath);
  });

  await t.test('install a second time changes nothing', async () => {
    const r = await kit(['install'], { home });
    assert.equal(r.json.installed.render.action, 'already-installed');
    assert.equal(r.json.installed.transcribe.action, 'already-installed');
    const only = await kit(['install', '--only', 'transcribe'], { home });
    assert.deepEqual(Object.keys(only.json.installed), ['transcribe']);
    const bad = await kit(['install', '--only', 'photoshop'], { home });
    assert.equal(bad.json.code, 'BAD_FLAG');
  });

  // Workspace with an invented brand.
  const ws = tmpDir('e2e-ws');
  let brandDir;
  let jobDir;
  await t.test('workspace, brand and job', async () => {
    await kit(['scaffold', '--workspace', ws], { home });
    brandDir = (await kit(['add-brand', '--workspace', ws, '--slug', 'harbor-pine', '--name', 'Harbor & Pine Bakery'], { home })).json.brandDir;
    fs.writeFileSync(path.join(brandDir, 'brand.json'), JSON.stringify(sampleBrand(), null, 2));
    const d = await kit(['doctor', '--workspace', ws], { home });
    assert.equal(d.json.ready, true, d.json.summary);
    jobDir = (await kit(['new-job', '--brand-dir', brandDir, '--slug', 'sourdough-tips', '--date', '2026-11-17'], { home })).json.jobDir;
  });

  await t.test('fixtures from the bundled ffmpeg', async () => {
    const bins = findBinaries(path.join(home, 'render'));
    const wav = await download(SPEECH_SAMPLE_WAV, path.join(cache, 'speech-sample.wav'));
    makeVideo(bins, { out: path.join(brandDir, 'raw', 'talk.mp4'), w: 640, h: 360, fps: 10, seconds: 11, audio: wav });
    makeVideo(bins, { out: path.join(brandDir, 'raw', 'silent-portrait.mp4'), w: 360, h: 640, fps: 10, seconds: 3, audio: null });
  });

  await t.test('ingest makes a probe, a proxy and a 16 kHz WAV', async () => {
    const r = await kit(['ingest', '--job-dir', jobDir, '--source', 'raw/talk.mp4', '--id', 'A'], { home, env: bareEnv });
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal(r.json.source, 'raw/talk.mp4');
    assert.ok(Math.abs(r.json.durationSec - 11) < 0.3, String(r.json.durationSec));
    assert.deepEqual([r.json.video.width, r.json.video.height], [640, 360]);
    assert.ok(fs.statSync(r.json.proxy).size > 1000);
    const wav = fs.readFileSync(r.json.wav);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 16000); // sample rate
    assert.equal(wav.readUInt16LE(22), 1); // mono
    const again = await kit(['ingest', '--job-dir', jobDir, '--source', 'raw/talk.mp4', '--id', 'A'], { home, env: bareEnv });
    assert.equal(again.json.skipped, true);
    const clash = await kit(['ingest', '--job-dir', jobDir, '--source', 'raw/silent-portrait.mp4', '--id', 'A'], { home, env: bareEnv });
    assert.equal(clash.json.code, 'ID_IN_USE');
    const silent = await kit(['ingest', '--job-dir', jobDir, '--source', 'raw/silent-portrait.mp4', '--id', 'B'], { home, env: bareEnv });
    assert.equal(silent.json.audio, null);
    assert.match(silent.json.warning, /no sound/);
    const junk = path.join(brandDir, 'raw', 'broken.mp4');
    fs.writeFileSync(junk, 'not a video');
    const bad = await kit(['ingest', '--job-dir', jobDir, '--source', 'raw/broken.mp4', '--id', 'C'], { home, env: bareEnv });
    assert.equal(bad.json.code, 'UNREADABLE_VIDEO');
    fs.rmSync(junk);
  });

  await t.test('transcribe really recognises the speech', async () => {
    const r = await kit(['transcribe', '--job-dir', jobDir, '--id', 'A'], { home, env: bareEnv });
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    const tr = JSON.parse(fs.readFileSync(r.json.json, 'utf8'));
    assert.deepEqual(Object.keys(tr), ['source', 'durationSec', 'language', 'words', 'segments']);
    assert.equal(tr.source, 'raw/talk.mp4');
    const text = tr.words.map((w) => w.text).join(' ').toLowerCase();
    t.diagnostic(`transcript: ${text}`);
    for (const w of ['fellow', 'americans', 'country']) assert.ok(text.includes(w), `"${w}" in transcript`);
    for (const [i, w] of tr.words.entries()) {
      assert.ok(w.t0 <= w.t1 && w.t1 <= tr.durationSec + 0.5, JSON.stringify(w));
      if (i) assert.ok(w.t0 >= tr.words[i - 1].t0, 'words in order');
    }
    const txt = fs.readFileSync(r.json.txt, 'utf8').trim().split('\n');
    for (const line of txt) assert.match(line, /^\[\d\d:\d\d\.\d\] \S/);
    const again = await kit(['transcribe', '--job-dir', jobDir, '--id', 'A'], { home, env: bareEnv });
    assert.equal(again.json.skipped, true);
    const none = await kit(['transcribe', '--job-dir', jobDir, '--id', 'B'], { home, env: bareEnv });
    assert.equal(none.json.code, 'NO_AUDIO');
  });

  await t.test('frames builds labelled contact sheets', async () => {
    const r = await kit(['frames', '--job-dir', jobDir, '--id', 'A', '--every', '1'], { home, env: bareEnv });
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal(r.json.frameCount, 11);
    assert.equal(r.json.sheets.length, 1);
    const jpg = fs.readFileSync(r.json.sheets[0].file);
    assert.deepEqual([...jpg.subarray(0, 2)], [0xff, 0xd8]);
    assert.equal(r.json.sheets[0].frames[3].label, '00:03.0');
    const range = await kit(['frames', '--job-dir', jobDir, '--id', 'A', '--from', '2', '--to', '8'], { home, env: bareEnv });
    assert.equal(range.json.frames ?? range.json.frameCount, 6);
    const portrait = await kit(['frames', '--job-dir', jobDir, '--id', 'B'], { home, env: bareEnv });
    assert.equal(portrait.json.ok, true);
    const again = await kit(['frames', '--job-dir', jobDir, '--id', 'A', '--every', '1'], { home, env: bareEnv });
    assert.equal(again.json.sheets[0].file, r.json.sheets[0].file);
  });

  await t.test('render draft, review it, render final', async () => {
    const edit = {
      schemaVersion: 1, brand: 'harbor-pine', job: path.basename(jobDir), version: 1,
      sources: [{ id: 'A', file: 'raw/talk.mp4' }],
      output: { width: 1080, height: 1920, fps: 30 },
      hookTitle: { text: 'Ask not', seconds: 2 },
      segments: [{ source: 'A', in: 0.3, out: 4.2, note: 'opening line' }, { source: 'A', in: 6.0, out: 10.8, cropX: 0.4 }],
      captions: { enabled: true, corrections: [] },
      overlays: [{ type: 'text', text: 'Fresh daily', at: 1, seconds: 2, position: 'top' }],
      music: { file: null, volumeDb: -18 },
      endCard: true,
    };
    fs.writeFileSync(path.join(jobDir, 'edit.json'), JSON.stringify(edit, null, 2));
    const v = await kit(['validate', '--file', path.join(jobDir, 'edit.json')], { home });
    assert.equal(v.json.ok, true, JSON.stringify(v.json));

    const d = await kit(['render', '--job-dir', jobDir, '--draft'], { home, env: bareEnv });
    assert.equal(d.json.ok, true, JSON.stringify(d.json));
    assert.ok(fs.existsSync(d.json.out) && d.json.out.endsWith('-v1-draft.mp4'));
    const rd = await kit(['review-frames', '--job-dir', jobDir, '--draft'], { home, env: bareEnv });
    assert.equal(rd.json.ok, true, JSON.stringify(rd.json));
    const kinds = rd.json.frames.map((f) => f.kind);
    for (const k of ['start', 'cut-before', 'cut-after', 'overlay', 'end-card']) assert.ok(kinds.includes(k), k);
    assert.ok(rd.json.frames.every((f) => f.file && fs.existsSync(f.file)));

    const f = await kit(['render', '--job-dir', jobDir], { home, env: bareEnv });
    assert.equal(f.json.ok, true, JSON.stringify(f.json));
    assert.equal(f.json.out, path.join(brandDir, 'exports', `${path.basename(jobDir)}-v1.mp4`));
    const again = await kit(['render', '--job-dir', jobDir], { home, env: bareEnv });
    assert.equal(again.json.skipped, true);
    const rf = await kit(['review-frames', '--job-dir', jobDir, '--version', '1'], { home, env: bareEnv });
    assert.equal(rf.json.draft, false);
    assert.deepEqual(rf.json.checks, []);
    assert.ok(Math.abs(rf.json.durationSec - (3.9 + 4.8 + 1.5)) < 0.3, String(rf.json.durationSec));
  });

  await t.test('smoke-test renders a short branded clip', async () => {
    const r = await kit(['smoke-test', '--brand-dir', brandDir], { home, env: bareEnv });
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.ok(fs.statSync(r.json.out).size > 10000);
    assert.equal(path.basename(r.json.out), 'test-clip.mp4');
  });

  await t.test('a self-update at new-job is picked up by the next render', async () => {
    // A release one patch newer whose renderer files differ (a changed README), served locally.
    const server = await releaseServer();
    const manifest = JSON.parse(fs.readFileSync(new URL('../plugin/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
    const [a, b, c] = manifest.version.split('.').map(Number);
    const next = `${a}.${b}.${c + 1}`;
    const readme = fs.readFileSync(new URL('../plugin/render/README.md', import.meta.url), 'utf8');
    server.archives[`v${next}`] = makeRelease(next, { change: { 'render/README.md': `${readme}\nChanged in the test release.\n` } });
    server.latest = `v${next}`;
    const launcher = path.join(home, 'kit.mjs');
    const env = { ...bareEnv, CONTENT_KIT_RELEASE_URL: server.url, CONTENT_KIT_NO_UPDATE: '', CONTENT_KIT_HOME: '' };
    try {
      const st = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8'));
      delete st.update;
      fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(st, null, 2));
      const job = await kit(['new-job', '--brand-dir', brandDir, '--slug', 'after-update'], { home, env, script: launcher });
      assert.equal(job.json.ok, true, JSON.stringify(job.json));
      assert.deepEqual(job.json.updated, { from: manifest.version, to: next, recipesChanged: [] });
      const r = await kit(['smoke-test', '--brand-dir', brandDir], { home, env, script: launcher });
      assert.equal(r.json.ok, true, JSON.stringify(r.json));
      assert.match(r.stderr, /renderer needs a quick refresh/);
      const after = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8'));
      assert.equal(after.kit.source, 'self-update');
      assert.equal(after.kit.version, next);
      assert.equal(after.render.sourceHash, hashDir(path.join(home, 'kit', next, 'render'), RENDER_SKIP));
      assert.ok(fs.readFileSync(path.join(home, 'render', 'README.md'), 'utf8').includes('Changed in the test release.'));
      const d = await kit(['doctor', '--workspace', ws], { home, env: { ...env, CONTENT_KIT_NO_UPDATE: '1' }, script: launcher });
      assert.equal(d.json.ready, true, d.json.summary);
      assert.deepEqual([d.json.kit.version, d.json.kit.source], [next, 'self-update']);
    } finally {
      await server.close();
    }
  });

  await t.test('raw footage was never touched', () => {
    assert.deepEqual(fs.readdirSync(path.join(brandDir, 'raw')).sort(), ['silent-portrait.mp4', 'talk.mp4']);
  });
});
