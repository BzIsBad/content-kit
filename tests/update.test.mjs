// Self-update: `kit.mjs update`, the automatic check in new-job, and the launcher's choice of
// kit. A local web server stands in for GitHub; release archives are built from this checkout's
// plugin/ folder at test time. No internet needed. Run: node --test tests/update.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { ROOT, kit, sampleBrand } from './helpers.mjs';
import { makeRelease, makeTarGz, releaseServer } from './releases.mjs';
import { readTar, safeRel, unpackRelease } from '../plugin/scripts/lib/update.mjs';
import { ensureLauncher, launcherGeneration } from '../plugin/scripts/lib/common.mjs';

const PLUGIN = path.join(ROOT, 'plugin');
const VERSION = JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
const [MA, MI, PA] = VERSION.split('.').map(Number);
const next = (n) => `${MA}.${MI}.${PA + n}`; // next(1) is one patch newer than this checkout
const TMP = path.join(ROOT, 'tests', '.tmp', 'update');
fs.mkdirSync(TMP, { recursive: true });

function tmp(prefix) {
  return fs.mkdtempSync(path.join(TMP, `${prefix}-`));
}

let server;
test.before(async () => {
  server = await releaseServer();
});
test.after(async () => {
  await server.close();
});

/** Publish v<version> on the fake server and make it the latest. */
function publish(version, opts) {
  server.archives[`v${version}`] = makeRelease(version, opts);
  server.latest = `v${version}`;
  server.mode = 'normal';
}

const on = () => ({ CONTENT_KIT_RELEASE_URL: server.url, CONTENT_KIT_NO_UPDATE: '' });
const state = (home) => JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8'));

/** Run a file with Node, without blocking this process (the fake server lives here). */
function runNode(file, args, env) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [file, ...args], { env: { ...process.env, ...env }, windowsHide: true });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('error', reject);
    c.on('close', (status) => {
      const lines = out.split('\n').filter((l) => l.trim());
      assert.equal(lines.length, 1, `one JSON line expected, got: ${out}\n${err}`);
      resolve({ status, json: JSON.parse(lines[0]), stderr: err });
    });
  });
}

/** A kit home with the launcher in it, and a workspace with one brand. */
async function setup() {
  const home = tmp('home');
  const ws = tmp('ws');
  await kit(['scaffold', '--workspace', ws], { home });
  const brandDir = (await kit(['add-brand', '--workspace', ws, '--slug', 'harbor-pine', '--name', 'Harbor & Pine Bakery'], { home })).json.brandDir;
  fs.writeFileSync(path.join(brandDir, 'brand.json'), JSON.stringify(sampleBrand(), null, 2));
  return { home, ws, brandDir };
}

function versionsIn(home) {
  try {
    return fs.readdirSync(path.join(home, 'kit')).sort();
  } catch {
    return [];
  }
}

/** A fake self-updated copy that only prints a marker. */
function fakeSelfUpdated(home, version, { marker, ok = true, manifestVersion = version, broken = false } = {}) {
  const dir = path.join(home, 'kit', version);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'content-kit', version: manifestVersion }));
  fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'common.mjs'), '');
  const body = broken ? 'this is not javascript (' : `process.stdout.write(JSON.stringify({ ok: true, marker: ${JSON.stringify(marker || `self-${version}`)} }) + '\\n');\n`;
  fs.writeFileSync(path.join(dir, 'scripts', 'kit.mjs'), body);
  if (ok) fs.writeFileSync(path.join(dir, '.kit-ok'), '{}');
  return dir;
}

// ---- update --check and update -------------------------------------------------------------

test('update --check: newer, same, older and no release', async () => {
  const home = tmp('check');
  server.latest = null;
  let r = await kit(['update', '--check'], { home, env: on() });
  assert.equal(r.json.action, 'no-release');
  publish(next(1));
  r = await kit(['update', '--check'], { home, env: on() });
  assert.deepEqual([r.json.action, r.json.current, r.json.latest], ['available', VERSION, next(1)]);
  publish(VERSION);
  assert.equal((await kit(['update', '--check'], { home, env: on() })).json.action, 'up-to-date');
  publish(`${MA}.${MI}.0`);
  if (PA > 0) assert.equal((await kit(['update', '--check'], { home, env: on() })).json.action, 'up-to-date');
  // A tag that isn't vX.Y.Z (a pre-release name, a branch-like name) is never installed.
  server.latest = `v${next(1)}-beta.1`;
  assert.equal((await kit(['update'], { home, env: on() })).json.action, 'no-release');
  assert.deepEqual(versionsIn(home), []);
});

test('update installs a newer release, and the launcher then runs it', async () => {
  const { home, brandDir } = await setup();
  publish(next(1));
  const r = await kit(['update'], { home, env: on() });
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.deepEqual([r.json.action, r.json.from, r.json.to], ['updated', VERSION, next(1)]);
  const dir = path.join(home, 'kit', next(1));
  assert.equal(r.json.kitDir, dir);
  for (const f of ['.kit-ok', 'scripts/kit.mjs', 'scripts/launcher.mjs', 'render/cli.mjs', 'render/package-lock.json', 'recipes/reel/skill.template.md', 'templates/settings.json']) {
    assert.ok(fs.existsSync(path.join(dir, ...f.split('/'))), f);
  }
  assert.ok(!fs.existsSync(path.join(dir, 'skills')), 'only the working parts');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).version, next(1));
  assert.equal(state(home).update.lastResult, 'updated');
  assert.equal(state(home).update.lastUpdate.to, next(1));

  // The launcher picks the self-updated copy, which records itself.
  const d = await runNode(path.join(home, 'kit.mjs'), ['doctor'], { CONTENT_KIT_HOME: '', CONTENT_KIT_NO_UPDATE: '1', CLAUDE_CODE_PLUGIN_CACHE_DIR: path.join(home, 'none') });
  assert.equal(d.json.ok, true);
  assert.deepEqual([d.json.kit.version, d.json.kit.source], [next(1), 'self-update']);
  assert.equal(state(home).kit.path, path.join(dir, 'scripts', 'kit.mjs'));
  assert.equal(state(home).kit.source, 'self-update');
  // And real work runs from it.
  const job = await runNode(path.join(home, 'kit.mjs'), ['new-job', '--brand-dir', brandDir, '--slug', 'from-new-kit'], { CONTENT_KIT_HOME: '', CONTENT_KIT_NO_UPDATE: '1' });
  assert.equal(job.json.ok, true, JSON.stringify(job.json));

  // Same version again: nothing to do. --force reinstalls it.
  assert.equal((await kit(['update'], { home, env: on() })).json.action, 'up-to-date');
  const f = await kit(['update', '--force'], { home, env: on() });
  assert.equal(f.json.action, 'reinstalled');
  assert.deepEqual(versionsIn(home), [next(1)]);
  // An older latest release (a release pulled back) is never installed over a newer kit.
  publish(VERSION);
  assert.equal((await kit(['update'], { home, env: on() })).json.action, 'up-to-date');
  assert.deepEqual(versionsIn(home), [next(1)]);
});

test('a corrupt archive leaves the kit as it was', async () => {
  const home = tmp('corrupt');
  publish(next(1));
  const good = server.archives[`v${next(1)}`];
  server.archives[`v${next(1)}`] = Buffer.from('this is not a gzip file at all');
  let r = await kit(['update'], { home, env: on() });
  assert.equal(r.json.code, 'UPDATE_DOWNLOAD_BAD');
  // Cut short in the middle.
  server.archives[`v${next(1)}`] = good.subarray(0, Math.floor(good.length / 2));
  r = await kit(['update'], { home, env: on() });
  assert.equal(r.json.code, 'UPDATE_DOWNLOAD_BAD');
  // Missing on the server.
  delete server.archives[`v${next(1)}`];
  r = await kit(['update'], { home, env: on() });
  assert.equal(r.json.code, 'UPDATE_DOWNLOAD_BAD');
  assert.deepEqual(versionsIn(home), []);
  assert.equal(state(home).update.lastResult, 'bad-download');
});

test('archives with traversal, absolute paths or links are refused whole', async () => {
  const home = tmp('evil');
  const outside = path.join(home, 'evil.txt');
  const attempts = [
    { name: '{top}/plugin/scripts/../../../../evil.txt', data: 'x' },
    { name: '../evil.txt', data: 'x' },
    { name: path.resolve(outside).split(path.sep).join('/'), data: 'x' },
    { name: 'C:/evil.txt', data: 'x' },
    { name: '{top}/plugin/scripts\\..\\..\\evil.txt', data: 'x' },
    { name: '{top}/plugin/scripts/lib/link.mjs', type: '2', linkname: '/etc/passwd' },
    { name: '{top}/plugin/scripts/lib/hard.mjs', type: '1', linkname: '{top}/plugin/scripts/kit.mjs' },
    { name: 'other-top/plugin/scripts/x.mjs', data: 'x' },
  ];
  for (const extra of attempts) {
    publish(next(1), { extra: [extra] });
    const r = await kit(['update'], { home, env: on() });
    assert.equal(r.json.code, 'UPDATE_RELEASE_BAD', `${extra.name}: ${JSON.stringify(r.json)}`);
    assert.ok(!fs.existsSync(outside), extra.name);
    assert.deepEqual(versionsIn(home).filter((n) => !n.startsWith('.')), [], extra.name);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'tests', 'evil.txt')));
  // Leftover unpack folders are cleaned up.
  assert.deepEqual(versionsIn(home), []);
});

test('the tar reader and path guard on their own', () => {
  for (const bad of ['/etc/x', '../x', 'a/../../x', 'a\\b', 'C:/x', 'a/C:/x', '', 'a\0b']) assert.equal(safeRel(bad), null, bad);
  assert.equal(safeRel('a/./b/'), 'a/b');
  // A long path comes through a pax header, as git writes it.
  const long = `top/plugin/scripts/${'d'.repeat(120)}/f.mjs`;
  const e = readTar(zlib.gunzipSync(makeTarGz([{ name: long, data: 'hi' }])));
  assert.equal(e[0].name, long);
  assert.equal(e[0].data.toString(), 'hi');
  // Only plugin parts are written.
  const dest = tmp('unpack');
  const n = unpackRelease(makeTarGz([
    { name: 'top/', type: '5' }, { name: 'top/README.md', data: 'r' }, { name: 'top/tests/x.mjs', data: 't' },
    { name: 'top/plugin/skills/setup/SKILL.md', data: 's' }, { name: 'top/plugin/render/node_modules/x.js', data: 'n' },
    { name: 'top/plugin/scripts/kit.mjs', data: 'k' },
  ]), dest);
  assert.equal(n, 1);
  assert.deepEqual(fs.readdirSync(dest), ['scripts']);
});

test('a release whose plugin.json disagrees with its tag is refused', async () => {
  const home = tmp('mismatch');
  publish(next(1), { manifestVersion: next(2) });
  const r = await kit(['update'], { home, env: on() });
  assert.equal(r.json.code, 'UPDATE_RELEASE_BAD');
  assert.match(r.json.detail, /plugin\.json says/);
  // A release whose kit doesn't even start is refused too.
  publish(next(1), { change: { 'scripts/kit.mjs': 'syntax error here (' } });
  const r2 = await kit(['update'], { home, env: on() });
  assert.equal(r2.json.code, 'UPDATE_RELEASE_BAD');
  assert.deepEqual(versionsIn(home), []);
});

test('offline, unreachable or plain-http sources fail plainly', async () => {
  const home = tmp('offline');
  // Nothing listens on port 9 here.
  let r = await kit(['update'], { home, env: { CONTENT_KIT_RELEASE_URL: 'http://127.0.0.1:9/o/content-kit', CONTENT_KIT_NO_UPDATE: '' } });
  assert.equal(r.json.code, 'UPDATE_OFFLINE');
  assert.match(r.json.fix, /still work/);
  server.mode = 'error';
  r = await kit(['update', '--check'], { home, env: on() });
  assert.equal(r.json.code, 'UPDATE_OFFLINE');
  // Plain http to anything but this computer is refused.
  r = await kit(['update'], { home, env: { CONTENT_KIT_RELEASE_URL: 'http://example.com/o/content-kit' } });
  assert.equal(r.json.code, 'UPDATE_RELEASE_BAD');
  server.mode = 'normal';
  // doctor never fails over it.
  const d = await kit(['doctor'], { home, env: { CONTENT_KIT_RELEASE_URL: 'http://127.0.0.1:9/o/content-kit', CONTENT_KIT_NO_UPDATE: '' } });
  assert.equal(d.json.ok, true);
  assert.equal(d.json.kit.checked, false);
  assert.equal(d.json.kit.version, VERSION);
  assert.equal(d.json.kit.source, 'plugin');
});

// ---- the automatic check in new-job --------------------------------------------------------

test('new-job picks up a newer release at most once a week', async () => {
  const { home, brandDir } = await setup();
  publish(next(1));
  const job = (slug) => kit(['new-job', '--brand-dir', brandDir, '--slug', slug, '--date', '2026-11-17'], { home, env: on() });
  // Turned off by the environment variable: no request at all.
  const hits = server.hits;
  const off = await kit(['new-job', '--brand-dir', brandDir, '--slug', 'off'], { home, env: { CONTENT_KIT_RELEASE_URL: server.url, CONTENT_KIT_NO_UPDATE: '1' } });
  assert.equal(off.json.updated, undefined);
  assert.equal(server.hits, hits);

  let r = await job('first');
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.updated, { from: VERSION, to: next(1), recipesChanged: [] });
  assert.ok(fs.existsSync(path.join(home, 'kit', next(1), '.kit-ok')));

  // A newer release a day later is not looked for until the week is up.
  publish(next(2), { change: { 'recipes/reel/skill.template.md': `${fs.readFileSync(path.join(PLUGIN, 'recipes', 'reel', 'skill.template.md'), 'utf8')}\nA new line.\n` } });
  const before = server.hits;
  r = await job('second');
  assert.equal(r.json.updated, undefined);
  assert.equal(server.hits, before, 'no request inside the week');

  // Eight days later it is.
  const st = state(home);
  st.update.lastCheckAt = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(st));
  r = await job('third');
  assert.deepEqual(r.json.updated, { from: next(1), to: next(2), recipesChanged: ['reel'] });
  assert.deepEqual(versionsIn(home), [next(1), next(2)]);

  // A third update prunes the oldest; the previous one stays for rollback.
  publish(next(3));
  const st2 = state(home);
  st2.update.lastCheckAt = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(st2));
  r = await job('fourth');
  assert.equal(r.json.updated.to, next(3));
  assert.deepEqual(versionsIn(home), [next(2), next(3)]);

  // Rolled back by hand: the bad version is not put back by the next check, only by a newer release.
  fs.writeFileSync(path.join(home, 'kit', next(3), '.bad'), '');
  const held = await kit(['update'], { home, env: on() });
  assert.equal(held.json.action, 'held-back');
  assert.equal(held.json.current, next(2));
  assert.ok(fs.existsSync(path.join(home, 'kit', next(3), '.bad')));
  publish(next(4));
  assert.equal((await kit(['update'], { home, env: on() })).json.to, next(4));
});

test('new-job never fails because of the updater', async () => {
  const { home, brandDir } = await setup();
  const reset = () => {
    const st = state(home);
    delete st.update;
    fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(st));
  };
  const cases = [
    ['offline', { CONTENT_KIT_RELEASE_URL: 'http://127.0.0.1:9/o/content-kit' }, () => {}],
    ['server error', on(), () => (server.mode = 'error')],
    ['corrupt archive', on(), () => {
      publish(next(1));
      server.archives[`v${next(1)}`] = Buffer.from('garbage');
    }],
    ['version mismatch', on(), () => publish(next(1), { manifestVersion: '9.9.9' })],
    ['traversal', on(), () => publish(next(1), { extra: [{ name: '{top}/plugin/../../x', data: 'x' }] })],
    ['no release', on(), () => (server.latest = null)],
    ['not https', { CONTENT_KIT_RELEASE_URL: 'http://example.com/o/content-kit' }, () => {}],
    ['server never answers', on(), () => (server.mode = 'hang')],
  ];
  for (const [name, env, arrange] of cases) {
    reset();
    arrange();
    const started = Date.now();
    const r = await kit(['new-job', '--brand-dir', brandDir, '--slug', name.replace(/\s+/g, '-')], { home, env: { CONTENT_KIT_NO_UPDATE: '', ...env } });
    assert.equal(r.json.ok, true, `${name}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.updated, undefined, name);
    assert.ok(fs.existsSync(r.json.jobDir), name);
    assert.ok(Date.now() - started < 20000, `${name} took ${Date.now() - started} ms`);
    assert.ok(state(home).update.lastCheckAt, `${name}: the attempt is recorded`);
    server.mode = 'normal';
  }
  assert.deepEqual(versionsIn(home), []);
});

test('after a check that failed, new-job tries again a day later, not a week later', async () => {
  const { home, brandDir } = await setup();
  const job = (slug, env) => kit(['new-job', '--brand-dir', brandDir, '--slug', slug], { home, env: { CONTENT_KIT_NO_UPDATE: '', ...env } });
  const age = (hours) => {
    const st = state(home);
    st.update.lastCheckAt = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(st));
  };
  // Offline the first time.
  let r = await job('offline', { CONTENT_KIT_RELEASE_URL: 'http://127.0.0.1:9/o/content-kit' });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.updated, undefined);
  publish(next(1));
  // Two hours later: still inside the day, so no request.
  age(2);
  const before = server.hits;
  r = await job('same-day', on());
  assert.equal(r.json.updated, undefined);
  assert.equal(server.hits, before, 'no request inside the day');
  // Twenty-five hours later it looks again and picks up the release.
  age(25);
  r = await job('next-day', on());
  assert.equal(r.json.updated.to, next(1));
});

// ---- the launcher --------------------------------------------------------------------------

test('the launcher picks the newest valid kit and falls back when one is bad', async () => {
  const home = tmp('launcher');
  const cache = path.join(home, 'cache');
  fs.copyFileSync(path.join(PLUGIN, 'scripts', 'launcher.mjs'), path.join(home, 'kit.mjs'));
  const run = (env = {}) => runNode(path.join(home, 'kit.mjs'), ['x'], { CONTENT_KIT_HOME: '', CLAUDE_CODE_PLUGIN_CACHE_DIR: cache, ...env });
  // A plugin copy recorded in state.json.
  const pluginRoot = path.join(home, 'plugin-copy');
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.2.2' }));
  fs.writeFileSync(path.join(pluginRoot, 'scripts', 'kit.mjs'), 'process.stdout.write(JSON.stringify({ ok: true, marker: "plugin" }) + "\\n");\n');
  fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify({ kit: { path: path.join(pluginRoot, 'scripts', 'kit.mjs') } }));
  assert.equal((await run()).json.marker, 'plugin');

  fakeSelfUpdated(home, '0.2.3');
  fakeSelfUpdated(home, '0.2.4');
  assert.equal((await run()).json.marker, 'self-0.2.4');
  // Rollback by hand: mark the newest bad and the one before it runs.
  fs.writeFileSync(path.join(home, 'kit', '0.2.4', '.bad'), '');
  assert.equal((await run()).json.marker, 'self-0.2.3');
  // Copies that fail the quick self-check are skipped.
  fakeSelfUpdated(home, '0.2.5', { ok: false });
  fakeSelfUpdated(home, '0.2.6', { manifestVersion: '0.2.7' });
  fakeSelfUpdated(home, '0.2.8');
  fs.rmSync(path.join(home, 'kit', '0.2.8', 'scripts', 'lib', 'common.mjs'));
  fs.mkdirSync(path.join(home, 'kit', 'latest'), { recursive: true });
  assert.equal((await run()).json.marker, 'self-0.2.3');
  // A copy that passes the check but won't load: the launcher moves on to the next one.
  fakeSelfUpdated(home, '0.2.9', { broken: true });
  const b = await run();
  assert.equal(b.json.marker, 'self-0.2.3');
  assert.match(b.stderr, /didn't start/);
  fs.rmSync(path.join(home, 'kit', '0.2.9'), { recursive: true });
  // A newer plugin copy (the client re-added the plugin) beats an older self-updated one...
  const cached = path.join(cache, 'content-kit', 'content-kit', '0.3.0');
  fs.mkdirSync(path.join(cached, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(cached, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(cached, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '0.3.0' }));
  fs.writeFileSync(path.join(cached, 'scripts', 'kit.mjs'), 'process.stdout.write(JSON.stringify({ ok: true, marker: "cache-0.3.0" }) + "\\n");\n');
  assert.equal((await run()).json.marker, 'cache-0.3.0');
  // ...and on the same version the self-updated copy wins (it never moves).
  fakeSelfUpdated(home, '0.3.0');
  assert.equal((await run()).json.marker, 'self-0.3.0');
});

test('an older kit never puts back an older launcher', () => {
  const home = tmp('gen');
  const ours = fs.readFileSync(path.join(PLUGIN, 'scripts', 'launcher.mjs'), 'utf8');
  assert.ok(launcherGeneration(ours) >= 2);
  assert.equal(launcherGeneration('#!/usr/bin/env node\n// Stable launcher'), 1);
  const future = ours.replace(/launcher-generation: \d+/, 'launcher-generation: 99');
  fs.writeFileSync(path.join(home, 'kit.mjs'), future);
  ensureLauncher(home);
  assert.equal(fs.readFileSync(path.join(home, 'kit.mjs'), 'utf8'), future);
  fs.writeFileSync(path.join(home, 'kit.mjs'), '#!/usr/bin/env node\n// an old launcher\n');
  ensureLauncher(home);
  assert.equal(fs.readFileSync(path.join(home, 'kit.mjs'), 'utf8'), ours);
});
