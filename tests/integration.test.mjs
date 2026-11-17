// Integration checks added with the cross-package fixes: the launcher, the permission list,
// contract options shared by the validator and the renderer, one bootstrap text, and nothing
// personal in published files. Fast: no network, no installed tools. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, kit, tmpDir, sampleBrand } from './helpers.mjs';
import { PINS } from '../plugin/scripts/lib/common.mjs';
import { mergeSettings } from '../plugin/scripts/lib/cmd-setup.mjs';
import { validateBrand, validateEdit, LICENCE_NOTE } from '../plugin/scripts/lib/validate.mjs';
import { cutSize } from '../plugin/scripts/lib/cuts.mjs';

const PLUGIN = path.join(ROOT, 'plugin');

function runLauncher(home, args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(home, 'kit.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, CONTENT_KIT_NO_UPDATE: '1', CONTENT_KIT_HOME: '', CLAUDE_CODE_PLUGIN_CACHE_DIR: path.join(home, 'no-cache'), ...env },
  });
  const lines = r.stdout.split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 1, `one JSON line expected, got: ${r.stdout}\n${r.stderr}`);
  return { status: r.status, json: JSON.parse(lines[0]) };
}

/** A fake installed plugin in a fake plugin cache: <cache>/<market>/content-kit/<version>/ */
function fakePlugin(cache, version, { orphaned = false, marker } = {}) {
  const root = path.join(cache, 'content-kit', 'content-kit', version);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'content-kit', version }));
  fs.writeFileSync(path.join(root, 'scripts', 'kit.mjs'), `process.stdout.write(JSON.stringify({ ok: true, marker: ${JSON.stringify(marker || version)}, home: process.env.CONTENT_KIT_HOME }) + '\\n');\n`);
  if (orphaned) fs.writeFileSync(path.join(root, '.orphaned_at'), '1');
  return path.join(root, 'scripts', 'kit.mjs');
}

test('scaffold puts the launcher in the kit home, and the launcher runs the recorded kit', async () => {
  const home = tmpDir('launch');
  const ws = tmpDir('ws');
  const s = await kit(['scaffold', '--workspace', ws], { home });
  assert.equal(s.json.kit, path.join(home, 'kit.mjs').split(path.sep).join('/'));
  assert.ok(fs.existsSync(path.join(home, 'kit.mjs')));
  const state = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8'));
  assert.equal(state.kit.path, path.join(PLUGIN, 'scripts', 'kit.mjs'));
  assert.equal(state.kit.launcher, path.join(home, 'kit.mjs'));
  // Through the launcher, with CONTENT_KIT_HOME unset: it uses its own folder as the kit home.
  const r = runLauncher(home, ['doctor']);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.kitHome, home);
});

test('the launcher prefers the newest plugin copy and skips replaced ones', () => {
  const home = tmpDir('launch2');
  const cache = path.join(home, 'cache');
  fs.copyFileSync(path.join(PLUGIN, 'scripts', 'launcher.mjs'), path.join(home, 'kit.mjs'));
  // Nothing recorded and nothing installed: a plain failure.
  const none = runLauncher(home, ['doctor']);
  assert.equal(none.status, 1);
  assert.equal(none.json.code, 'KIT_NOT_FOUND');
  // The recorded kit was removed by an update; a newer copy sits in the cache next to an orphaned one.
  const recorded = fakePlugin(path.join(home, 'old'), '0.1.0', { marker: 'recorded' });
  fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify({ kit: { path: recorded } }));
  assert.equal(runLauncher(home, ['x']).json.marker, 'recorded');
  fakePlugin(cache, '0.2.0');
  fakePlugin(cache, '0.3.0', { orphaned: true });
  const r = runLauncher(home, ['x'], { CLAUDE_CODE_PLUGIN_CACHE_DIR: cache });
  assert.equal(r.json.marker, '0.2.0');
  assert.equal(r.json.home, home);
  fs.rmSync(path.dirname(path.dirname(recorded)), { recursive: true });
  assert.equal(runLauncher(home, ['x'], { CLAUDE_CODE_PLUGIN_CACHE_DIR: cache }).json.marker, '0.2.0');
});

test('the permission list is anchored to the workspace and drops stale kit rules', async () => {
  const home = tmpDir('perm');
  const ws = tmpDir('ws');
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  const old = {
    permissions: {
      allow: ['Bash("/n" "/plugins/cache/content-kit/content-kit/0.1.0/scripts/kit.mjs" *)', 'Edit(./brands/**)', 'Bash(git status)'],
      deny: ['Edit(./brands/*/raw/**)', 'Read(./secret.txt)'],
    },
    model: 'keep-me',
  };
  fs.writeFileSync(path.join(ws, '.claude', 'settings.json'), JSON.stringify(old));
  const s = await kit(['scaffold', '--workspace', ws], { home });
  assert.equal(s.json.settings.action, 'merged');
  const got = JSON.parse(fs.readFileSync(path.join(ws, '.claude', 'settings.json'), 'utf8'));
  const allow = got.permissions.allow;
  assert.ok(allow.includes('Bash(git status)'), 'client rules are kept');
  assert.ok(got.permissions.deny.includes('Read(./secret.txt)'));
  assert.equal(got.model, 'keep-me');
  assert.ok(!allow.some((r) => r.includes('0.1.0')), 'rules for an old kit path are removed');
  assert.ok(!allow.some((r) => r.includes('(./')), 'no rules relative to the current folder');
  assert.ok(allow.includes(`Bash("${s.json.node}" "${s.json.kit}" *)`));
  assert.ok(allow.includes('Edit(/brands/**)'));
  assert.deepEqual(got.permissions.deny.filter((r) => r.includes('raw')), ['Edit(/brands/*/raw/**)']);
  // Merging the same again changes nothing.
  assert.deepEqual(mergeSettings(got, got), got);
});

test('validator follows the reconciled contract', () => {
  const b = sampleBrand();
  b.logo = { onDark: 'assets/logo.png', onLight: 'assets/logo.png' };
  b.reel.endCard.cta = null;
  const brandDir = path.join(tmpDir('vb'), 'brands', b.slug);
  fs.mkdirSync(brandDir, { recursive: true });
  let v = validateBrand(b, { brandDir });
  assert.deepEqual(v.problems, []);
  assert.equal(v.warnings.filter((w) => w.includes('logo')).length, 1, 'one warning for one missing logo file');
  assert.equal(validateBrand(b, { brandDir, checkFiles: false }).warnings.length, 0);
  b.teamSize = 3;
  assert.ok(validateBrand(b, { brandDir, checkFiles: false }).warnings.includes(LICENCE_NOTE));
  assert.equal(validateBrand(b, { brandDir, checkFiles: false, licenceNote: false }).warnings.length, 0);

  b.reel.watermark.sizePct = 22;
  assert.deepEqual(validateBrand(b, { brandDir, checkFiles: false, licenceNote: false }).problems, []);
  b.reel.watermark.sizePct = 50;
  assert.equal(validateBrand(b, { brandDir, checkFiles: false }).problems.length, 1, 'logo size is kept between 8 and 35');
  delete b.reel.watermark.sizePct;
  assert.deepEqual(validateBrand(b, { brandDir, checkFiles: false }).problems, [], 'logo size is optional');

  const e = {
    schemaVersion: 1, brand: 'harbor-pine', job: 'j', version: 1,
    sources: [{ id: 'A', file: 'raw/a.mp4' }], segments: [{ source: 'A', in: 1, out: 20 }],
  };
  for (const endCard of [true, false, { seconds: 3, cta: 'Hi' }, { enabled: false }, { cta: null }]) {
    assert.deepEqual(validateEdit({ ...e, endCard }).problems, [], JSON.stringify(endCard));
  }
  assert.equal(validateEdit({ ...e, endCard: { seconds: 0 } }).problems.length, 1);
  assert.equal(validateEdit({ ...e, endCard: 'yes' }).problems.length, 1);
  assert.deepEqual(validateEdit({ ...e, music: false }).problems, []);
  assert.deepEqual(validateEdit({ ...e, music: { file: null, volumeDb: -20 } }).problems, []);
  assert.equal(validateEdit({ ...e, music: 'none' }).problems.length, 1);
});

test('add-brand starts reels at 15 to 90 seconds and makes assets/music', async () => {
  const home = tmpDir('ab');
  const ws = tmpDir('ws');
  await kit(['scaffold', '--workspace', ws], { home });
  const a = await kit(['add-brand', '--workspace', ws, '--slug', 'sample-co', '--name', 'Sample Co'], { home });
  const brand = JSON.parse(fs.readFileSync(path.join(a.json.brandDir, 'brand.json'), 'utf8'));
  assert.equal(brand.reel.minSeconds, 15);
  assert.equal(brand.reel.maxSeconds, 90);
  assert.ok(fs.existsSync(path.join(a.json.brandDir, 'assets', 'music')));
});

test('render copies are never bigger than the output needs, and never upscaled', () => {
  assert.deepEqual(cutSize({ width: 3840, height: 2160 }, 1080, 1920), { width: 3414, height: 1920 });
  assert.deepEqual(cutSize({ width: 2160, height: 3840 }, 1080, 1920), { width: 1080, height: 1920 });
  assert.deepEqual(cutSize({ width: 1280, height: 720 }, 1080, 1920), { width: 1280, height: 720 });
  assert.deepEqual(cutSize({ width: 1080, height: 1920 }, 1080, 1920), { width: 1080, height: 1920 });
});

test('the Node bootstrap is written once, with the pinned version', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.bundle'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|mjs|json)$/.test(e.name)) files.push(p);
    }
  };
  walk(PLUGIN);
  const withDownload = files.filter((f) => /nodejs\.org\/dist\/v/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(withDownload.map((f) => path.relative(PLUGIN, f).split(path.sep).join('/')), ['skills/setup/references/machine-check.md']);
  const text = fs.readFileSync(withDownload[0], 'utf8');
  const versions = new Set([...text.matchAll(/v?(\d+\.\d+\.\d+)/g)].map((m) => m[1]));
  assert.deepEqual([...versions], [PINS.node]);
  assert.ok(text.includes('win-x64.zip') && !/-win-arm64/.test(text), 'Windows always gets the x64 build');
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.matchAll(/v(2\d\.\d+\.\d+)/g)) assert.equal(m[1], PINS.node, `${f} names Node ${m[1]}`);
  }
});

// Private names live in tests/private-words.local.txt, which is gitignored, so this published test
// never contains them. Without that file only the generic patterns below are checked.
const PRIVATE_WORDS_FILE = path.join(ROOT, 'tests', 'private-words.local.txt');

function privateWords() {
  try {
    return fs.readFileSync(PRIVATE_WORDS_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Contact details of any kind: an email address (except the reserved example domains), a link to a
// contact, about or booking page, a scheduling or profile link, or a phone number.
const GENERIC = [
  /[a-z0-9._%+-]+@(?!example\.(com|org|net)\b)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\b/i,
  /https?:\/\/(?!nodejs\.org)[^\s)'"`]+\/(contact|about|book|booking|schedule)\b/i,
  /\b(calendly\.com|cal\.com|linkedin\.com\/in)\//i,
  /(?<![\d.])\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?![\d.])/,
];

test('nothing personal in published files', (t) => {
  const published = ['plugin', '.claude-plugin', 'tests', 'docs/client', 'docs/spec', 'README.md'];
  const words = privateWords();
  if (!words.length) t.diagnostic('tests/private-words.local.txt not found: checking generic patterns only');
  const patterns = [...GENERIC, ...words.map((w) => new RegExp(`(?<![a-z0-9])${escapeRe(w)}(?![a-z0-9])`, 'i'))];
  const hits = [];
  const check = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const n of fs.readdirSync(p)) if (!['node_modules', '.bundle', '.tmp', 'package-lock.json'].includes(n)) check(path.join(p, n));
    } else if (/\.(md|mjs|js|jsx|json|txt)$/.test(p) && !p.endsWith('OFL.txt') && path.resolve(p) !== PRIVATE_WORDS_FILE) {
      const text = fs.readFileSync(p, 'utf8');
      for (const re of patterns) {
        const m = text.match(re);
        if (m) hits.push(`${path.relative(ROOT, p)}: ${m[0]}`);
      }
    }
  };
  for (const p of published) if (fs.existsSync(path.join(ROOT, p))) check(path.join(ROOT, p));
  assert.deepEqual(hits, []);
});

test('install-skill checks a draft and saves it under .claude/skills', async () => {
  const home = tmpDir('skill');
  const ws = tmpDir('ws');
  await kit(['scaffold', '--workspace', ws], { home });
  const draft = path.join(ws, 'brands', 'draft.md');
  const good = '---\nname: sample-co-reel\ndescription: Make a reel for Sample Co.\n---\n\n# Sample Co\n';
  fs.writeFileSync(draft, good.replace('Sample Co\n', '{{BRAND_NAME}}\n'));
  const bad = await kit(['install-skill', '--workspace', ws, '--from', draft, '--name', 'sample-co-reel'], { home });
  assert.equal(bad.json.code, 'BAD_SKILL');
  assert.match(bad.json.message, /BRAND_NAME/);
  fs.writeFileSync(draft, good);
  const wrong = await kit(['install-skill', '--workspace', ws, '--from', draft, '--name', 'other-reel'], { home });
  assert.equal(wrong.json.code, 'BAD_SKILL');
  const ok = await kit(['install-skill', '--workspace', ws, '--from', draft, '--name', 'sample-co-reel'], { home });
  assert.equal(ok.json.action, 'created');
  const dest = path.join(ws, '.claude', 'skills', 'sample-co-reel', 'SKILL.md');
  assert.equal(fs.readFileSync(dest, 'utf8'), good);
  assert.ok(!fs.existsSync(draft), 'the draft is removed once saved');
  fs.writeFileSync(draft, good + '\nMore.\n');
  const up = await kit(['install-skill', '--workspace', ws, '--from', draft, '--name', 'sample-co-reel'], { home });
  assert.equal(up.json.action, 'updated');
  assert.equal(fs.readFileSync(path.join(path.dirname(dest), 'SKILL.previous.md'), 'utf8'), good);
});
