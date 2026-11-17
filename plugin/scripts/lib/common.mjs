// Shared helpers for kit.mjs: kit home, state.json, errors, process spawning, small fs utilities.
// Zero dependencies: only node: built-ins, so this runs on a bare Node before anything is installed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- Pinned versions (one place to bump) -------------------------------------------------

export const PINS = Object.freeze({
  // Current Node LTS ("Lithium") on 2026-11-17, from https://nodejs.org/dist/index.json
  node: '26.13.1',
  minNodeMajor: 20,
  // Speech to text: sherpa-onnx's prebuilt addon (no compiler, no Visual C++ runtime) and a pure-JS
  // bzip2 reader for the model download. The model itself is pinned in stt.mjs (MODEL).
  sherpaOnnxNode: '2.0.1',
  seekBzip: '2.0.0',
  // Remotion's bundled ffmpeg (and so the whole kit) needs macOS 15 or newer: its binaries are
  // built with minos 15.0 for both Apple silicon and Intel (checked with otool, 2026-11-17).
  minMacOS: 15,
});

// Where published releases of the kit come from (contracts §1, "Self-update"). Every published
// version is a git tag vX.Y.Z with a GitHub release; `kit.mjs update` installs only those.
export const RELEASES = Object.freeze({
  repo: 'https://github.com/BzIsBad/content-kit',
  checkEveryDays: 7,
  // After a check that didn't get an answer (offline, GitHub unreachable, cut off), try again sooner.
  retryAfterDays: 1,
});

export const SCRIPTS_DIR =path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PLUGIN_DIR = path.dirname(SCRIPTS_DIR);

// ---- Errors -------------------------------------------------------------------------------

/** An error a client can read. code is SNAKE_CASE; message and fix are plain words. */
export class KitError extends Error {
  constructor(code, message, fix, extra = {}) {
    super(message);
    this.code = code;
    this.fix = fix;
    this.extra = extra;
  }
}

// ---- Kit home and state -------------------------------------------------------------------

export function kitHome() {
  const override = process.env.CONTENT_KIT_HOME;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(os.homedir(), '.content-kit');
}

export function kitPaths(home = kitHome()) {
  const sttDir = path.join(home, 'tools', 'stt');
  return {
    home,
    tools: path.join(home, 'tools'),
    nodeDir: path.join(home, 'tools', 'node'),
    sttDir,
    sttLib: path.join(sttDir, 'lib'),
    sttModels: path.join(sttDir, 'models'),
    // Where kit 0.1.0 kept whisper.cpp; install removes it.
    oldWhisperDir: path.join(home, 'tools', 'whisper'),
    render: path.join(home, 'render'),
    state: path.join(home, 'state.json'),
    // The stable launcher (a copy of scripts/launcher.mjs). Skills and the permission list use it.
    launcher: path.join(home, 'kit.mjs'),
    // Self-updated copies of the kit, one folder per version (see update.mjs).
    kits: path.join(home, 'kit'),
  };
}

/** 'self-update' when this kit runs from <kit home>/kit/<version>/, otherwise 'plugin'. */
export function kitSource(home = kitHome()) {
  const kits = path.resolve(kitPaths(home).kits);
  return path.resolve(PLUGIN_DIR).startsWith(kits + path.sep) ? 'self-update' : 'plugin';
}

/** The launcher generation written in a launcher file's first lines ("launcher-generation: N"). */
export function launcherGeneration(text) {
  const m = /launcher-generation:\s*(\d+)/.exec(String(text).slice(0, 600));
  return m ? Number(m[1]) : 1;
}

/** The plugin's version, from .claude-plugin/plugin.json. */
export function pluginVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

/**
 * Note this kit.mjs as the current one in state.json, so the launcher and generated skills can
 * find it after a plugin update moves it. Only when the kit home already exists, and only on change.
 */
export function recordKit(home = kitHome()) {
  const p = kitPaths(home);
  if (!isDir(home)) return;
  const kitFile = path.join(SCRIPTS_DIR, 'kit.mjs');
  const st = readState(home);
  const version = pluginVersion();
  const source = kitSource(home);
  let launcherOk = false;
  try {
    const have = fs.readFileSync(p.launcher);
    const want = fs.readFileSync(path.join(SCRIPTS_DIR, 'launcher.mjs'));
    launcherOk = have.equals(want) || launcherGeneration(have.toString('utf8')) > launcherGeneration(want.toString('utf8'));
  } catch {}
  if (st.kit && st.kit.path === kitFile && st.kit.version === version && st.kit.source === source && launcherOk) return;
  try {
    ensureLauncher(home);
    updateState({ kit: { path: kitFile, pluginDir: PLUGIN_DIR, version, source, launcher: p.launcher } }, home);
  } catch {
    // A read-only kit home is reported by doctor; never fail a command over this note.
  }
}

/**
 * Copy scripts/launcher.mjs to <kit home>/kit.mjs if it is missing or different, but never
 * replace a launcher of a later generation with an earlier one (an older kit copy can still run).
 */
export function ensureLauncher(home = kitHome()) {
  const src = path.join(SCRIPTS_DIR, 'launcher.mjs');
  const dest = kitPaths(home).launcher;
  const want = fs.readFileSync(src);
  let have = null;
  try {
    have = fs.readFileSync(dest);
  } catch {}
  if (have && launcherGeneration(have.toString('utf8')) > launcherGeneration(want.toString('utf8'))) return dest;
  if (!have || !have.equals(want)) writeFileAtomic(dest, want);
  return dest;
}

export function readState(home = kitHome()) {
  const file = kitPaths(home).state;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { schemaVersion: 1 };
  }
}

/** Merge a patch into state.json (shallow per top-level key) and write atomically. */
export function updateState(patch, home = kitHome()) {
  const state = readState(home);
  const next = { ...state, schemaVersion: 1, kitHome: home, updatedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  fs.mkdirSync(home, { recursive: true });
  writeFileAtomic(kitPaths(home).state, JSON.stringify(next, null, 2) + '\n');
  return next;
}

// ---- Small fs helpers ---------------------------------------------------------------------

export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function writeJson(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n');
}

export function readJsonFile(file, { code = 'BAD_JSON', what = path.basename(file) } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new KitError('FILE_NOT_FOUND', `I couldn't find ${what} at ${file}.`, 'Check the folder is right, or create the file first.');
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new KitError(code, `${what} isn't valid JSON, so I can't read it (${e.message}).`, `Fix the JSON in ${file}, then try again.`);
  }
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Hash a directory's files (relative path + contents), skipping names in `skip`. */
export function hashDir(dir, skip = new Set()) {
  const h = crypto.createHash('sha256');
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) {
        h.update(r + '\0');
        h.update(fs.readFileSync(path.join(dir, r)));
        h.update('\0');
      }
    }
  };
  walk('');
  return h.digest('hex');
}

export function hashText(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(String(p) + '\0');
  return h.digest('hex');
}

/** Copy a directory tree, skipping names in `skip`. */
export function copyDir(src, dest, skip = new Set()) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d, skip);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/** Forward-slash relative path from `from` to `to`, or null if `to` is outside `from`. */
export function relInside(from, to) {
  const rel = path.relative(from, to);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

// ---- Logging (stderr only; stdout is reserved for the one JSON result) ---------------------

export function log(...args) {
  process.stderr.write(args.join(' ') + '\n');
}

// ---- Processes ----------------------------------------------------------------------------

/**
 * Run a program without a shell. Resolves { code, stdout, stderr }.
 * stdout/stderr are captured as Buffers unless `stream` is set, in which case the child's
 * stdout and stderr are both forwarded to our stderr (never our stdout).
 */
export function run(cmd, args, { cwd, env, stream = false, input, maxBuffer = 512 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      reject(e);
      return;
    }
    const out = [];
    const err = [];
    let outLen = 0;
    child.stdout.on('data', (d) => {
      if (stream) process.stderr.write(d);
      else if (outLen < maxBuffer) {
        out.push(d);
        outLen += d.length;
      }
    });
    child.stderr.on('data', (d) => {
      if (stream) process.stderr.write(d);
      err.push(d);
      if (err.length > 2000) err.splice(0, 1000);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') });
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function runSync(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts });
    if (r.error) return { ok: false, code: null, error: r.error, stdout: '', stderr: '' };
    return { ok: r.status === 0, code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (error) {
    return { ok: false, code: null, error, stdout: '', stderr: '' };
  }
}

/** Find npm's JS entry next to the running Node, so npm runs without a shell or PATH. */
export function npmCliPath(nodeExec = process.execPath) {
  const dir = path.dirname(nodeExec);
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows layout
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // macOS / Linux layout
  ];
  return candidates.find(exists) || null;
}

export async function npm(args, cwd) {
  const cli = npmCliPath();
  if (!cli) {
    throw new KitError(
      'NPM_MISSING',
      "The Node on this computer came without npm, which the kit needs to install its parts.",
      'Say "check my video setup" and Claude will set up the kit\'s own Node again, then finish installing.',
    );
  }
  // Put this Node first on PATH so npm's lifecycle scripts use it too.
  const env = withPathPrepended(process.env, path.dirname(process.execPath));
  const r = await run(process.execPath, [cli, ...args, '--no-audit', '--no-fund', '--loglevel=error'], { cwd, env, stream: true });
  if (r.code !== 0) {
    throw new KitError(
      'NPM_INSTALL_FAILED',
      "Downloading the kit's parts didn't finish. This is usually a dropped or blocked internet connection.",
      'Check you are online, then run install again. It picks up where it left off.',
      { detail: r.stderr.slice(-2000) },
    );
  }
}

/** Return a copy of env with dir prepended to PATH, respecting Windows' case-insensitive key. */
export function withPathPrepended(env, dir) {
  const out = { ...env };
  const key = Object.keys(out).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  out[key] = out[key] ? `${dir}${path.delimiter}${out[key]}` : dir;
  return out;
}

// ---- Misc ---------------------------------------------------------------------------------

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function localDateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtTime(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${String(m).padStart(2, '0')}:${rest}`;
}

export function fmtBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}
