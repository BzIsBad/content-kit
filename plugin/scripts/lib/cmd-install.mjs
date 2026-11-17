// doctor and install

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  KitError, PINS, PLUGIN_DIR, copyDir, recordKit, exists, fmtBytes, hashDir, isDir, kitPaths, log, npm, readState, run, runSync, updateState, writeJson,
} from './common.mjs';
import { findBinaries } from './ffmpeg.mjs';
import { DISK, cloudSyncCheck, freeBytes, systemSummary } from './system.mjs';
import { MODEL, installModel, modelReady } from './stt.mjs';

export const RENDER_SKIP = new Set(['node_modules', '.bundle', 'out', '.git', '.DS_Store']);

export function renderSourceDir() {
  const o = process.env.CONTENT_KIT_RENDER_SRC;
  return o && o.trim() ? path.resolve(o.trim()) : path.join(PLUGIN_DIR, 'render');
}

export function sttModelDir(p = kitPaths()) {
  return path.join(p.sttModels, MODEL.id);
}

function findBrowser(renderDir) {
  const root = path.join(renderDir, 'node_modules', '.remotion');
  const names = new Set(['chrome-headless-shell', 'chrome-headless-shell.exe']);
  const walk = (d, depth) => {
    if (depth > 5 || !isDir(d)) return null;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isFile() && names.has(e.name)) return p;
      if (e.isDirectory()) {
        const f = walk(p, depth + 1);
        if (f) return f;
      }
    }
    return null;
  };
  return walk(root, 0);
}

// ---- doctor --------------------------------------------------------------------------------

const ok = (id, label, detail, extra = {}) => ({ id, label, status: 'ok', detail, ...extra });
const missing = (id, label, detail, fix) => ({ id, label, status: 'missing', detail, fix });
const broken = (id, label, detail, fix) => ({ id, label, status: 'broken', detail, fix });

function checkSystem() {
  const { platform, arch } = process;
  const label = 'This computer';
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    const chip = arch === 'arm64' ? 'Apple silicon' : 'Intel';
    // Darwin 24 is macOS 15. The video tools are built for macOS 15 and newer.
    const macos = Number(os.release().split('.')[0]) - 9;
    if (Number.isFinite(macos) && macos < PINS.minMacOS) {
      return broken('system', label, `This Mac (${chip}) runs macOS ${macos}. The video tools need macOS ${PINS.minMacOS} (Sequoia) or newer.`, `Update macOS in System Settings, General, Software Update, if this Mac can take macOS ${PINS.minMacOS}. If it can't, the kit won't run on this Mac.`);
    }
    return ok('system', label, `Mac (${chip}), macOS ${macos}`);
  }
  if (platform === 'win32' && arch === 'x64') return ok('system', label, 'Windows (x64)');
  if (platform === 'win32' && arch === 'arm64') {
    return broken('system', label, 'Windows on ARM with the ARM version of Node. The video tool only ships for x64.', 'Say "check my video setup" and Claude will set up the x64 version of the kit\'s Node, which Windows 11 on ARM runs fine.');
  }
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) return ok('system', label, `Linux (${arch}), used for building and testing the kit`);
  return broken('system', label, `${platform} ${arch} isn't supported.`, 'The kit runs on a Mac or a Windows PC.');
}

function checkDisk(id, label, dir) {
  const free = freeBytes(dir);
  if (free === null) return ok(id, label, "Couldn't measure free space; carrying on.");
  if (free < DISK.minBytes) {
    return broken(id, label, `Only ${fmtBytes(free)} free. The kit needs at least ${fmtBytes(DISK.minBytes)} to install and render.`, 'Free up some space (empty the Trash or Recycle Bin, move old videos off this computer), then run doctor again.');
  }
  const note = free < DISK.comfortableBytes ? ` That's enough to start, but raw footage fills space fast; aim for ${fmtBytes(DISK.comfortableBytes)} or more.` : '';
  return ok(id, label, `${fmtBytes(free)} free.${note}`, { freeBytes: free, low: free < DISK.comfortableBytes });
}

function checkKitHome(p) {
  const label = 'Kit folder';
  const sync = cloudSyncCheck(p.home);
  if (sync.synced) {
    return broken('kitHome', label, `The kit folder (${p.home}) can't work properly because ${sync.reason}.`, 'Set CONTENT_KIT_HOME to a folder on this computer that is not synced, or turn syncing off for your home folder.');
  }
  if (!isDir(p.home)) return missing('kitHome', label, `${p.home} doesn't exist yet.`, 'Run install.');
  try {
    const probe = path.join(p.home, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
  } catch {
    return broken('kitHome', label, `I can't save files in ${p.home}.`, 'Check that folder belongs to you and is not read-only.');
  }
  return ok('kitHome', label, p.home);
}

function checkNode(p) {
  const label = 'Node (runs the kit)';
  const major = Number(process.versions.node.split('.')[0]);
  const portable = path.resolve(process.execPath).startsWith(path.resolve(p.nodeDir) + path.sep);
  if (major < PINS.minNodeMajor) {
    return broken('node', label, `Node ${process.version} is too old.`, 'Say "check my video setup" and Claude will set up the kit\'s own Node.');
  }
  const detail = `${process.version}${portable ? ' (the kit\'s own copy)' : ` at ${process.execPath}`}`;
  return ok('node', label, detail, { path: process.execPath, version: process.version, portable });
}

/** Load the speech addon in a separate Node, so a missing system library can't take doctor down. */
function sttLoads(p) {
  const code = "const {createRequire}=require('node:module');createRequire(process.argv[1]+'/package.json')('sherpa-onnx-node');process.stdout.write('loaded')";
  const r = runSync(process.execPath, ['-e', code, p.sttLib], { cwd: p.sttLib, timeout: 60000 });
  return { ok: r.stdout.includes('loaded'), detail: `${r.stderr || ''}${r.error ? r.error.message : ''}`.slice(-800) };
}

function checkTranscribe(p) {
  const label = 'Speech to text';
  const pkg = path.join(p.sttLib, 'node_modules', 'sherpa-onnx-node', 'package.json');
  if (!exists(pkg)) return missing('transcribe', label, 'Not set up yet.', 'Run install.');
  if (!modelReady(sttModelDir(p))) return missing('transcribe', label, "The speech model hasn't finished downloading.", 'Run install.');
  const load = sttLoads(p);
  if (!load.ok) {
    return { ...broken('transcribe', label, "It's installed but won't start on this computer.", 'Run install again. If it still won\'t start, share this message with whoever helps you with the kit.'), error: load.detail };
  }
  return ok('transcribe', label, `Parakeet English model (sherpa-onnx ${PINS.sherpaOnnxNode})`, { model: MODEL.id });
}

function checkRender(p) {
  const label = 'Video renderer (Remotion)';
  const dir = p.render;
  if (!exists(path.join(dir, 'cli.mjs')) || !isDir(path.join(dir, 'node_modules', '@remotion', 'renderer'))) {
    return missing('render', label, 'Not set up yet.', 'Run install.');
  }
  const st = readState();
  const src = renderSourceDir();
  if (exists(path.join(src, 'package.json')) && st.render && st.render.sourceHash) {
    if (hashDir(src, RENDER_SKIP) !== st.render.sourceHash) {
      return broken('render', label, 'The kit was updated and the renderer needs refreshing.', 'Run install.');
    }
  }
  let bins;
  try {
    bins = findBinaries(dir);
  } catch (e) {
    return broken('render', label, e.message, 'Run install.');
  }
  const r = runSync(bins.ffmpeg, ['-hide_banner', '-version'], { env: bins.env });
  if (!r.ok) return broken('render', label, "The renderer's video converter (ffmpeg) won't start.", 'Run install.');
  if (!findBrowser(dir)) return missing('render', label, "The renderer's built-in browser hasn't been downloaded.", 'Run install.');
  return ok('render', label, 'Ready', { ffmpeg: bins.ffmpeg });
}

function checkWorkspace(ws) {
  const label = 'Workspace folder';
  if (!isDir(ws)) return missing('workspace', label, `${ws} doesn't exist.`, 'Open the folder you want to use in Claude, then run setup.');
  const sync = cloudSyncCheck(ws);
  if (sync.synced) {
    return broken('workspace', label, `This folder isn't a good place for video work because ${sync.reason}. Big files fill your cloud storage and synced files can break renders.`, 'Make a folder on this computer that is not synced, open that one in Claude, and run setup there.');
  }
  return ok('workspace', label, `${ws} is on this computer and not synced.`);
}

export function runChecks({ workspace } = {}) {
  const p = kitPaths();
  const checks = [checkSystem(), checkDisk('diskKit', 'Free space for the kit', p.home)];
  if (workspace) {
    checks.push(checkWorkspace(workspace));
    checks.push(checkDisk('diskWorkspace', 'Free space for your videos', workspace));
  }
  checks.push(checkKitHome(p), checkNode(p));
  checks.push(checkTranscribe(p), checkRender(p));
  return checks;
}

function summarise(checks) {
  const bad = checks.filter((c) => c.status !== 'ok');
  const ready = bad.length === 0;
  const summary = ready
    ? 'Everything is set up and working.'
    : `${bad.length} thing${bad.length === 1 ? ' needs' : 's need'} attention: ${bad.map((c) => `${c.label} (${c.status})`).join(', ')}.`;
  return { ready, summary };
}

export async function doctor(flags) {
  const workspace = flags.workspace ? path.resolve(flags.workspace) : null;
  const checks = runChecks({ workspace });
  const { ready, summary } = summarise(checks);
  const p = kitPaths();
  if (isDir(p.home)) {
    updateState({ lastDoctor: { at: new Date().toISOString(), ready, checks: Object.fromEntries(checks.map((c) => [c.id, c.status])) } });
  }
  return { ready, summary, kitHome: p.home, system: systemSummary(), checks };
}

// ---- install -------------------------------------------------------------------------------

const TOOLS = ['node', 'render', 'transcribe'];

export async function install(flags) {
  const only = flags.only ? String(flags.only).trim() : null;
  if (only && !TOOLS.includes(only)) {
    throw new KitError('BAD_FLAG', `I don't know a tool called "${only}".`, `Use one of: ${TOOLS.join(', ')}.`);
  }
  const p = kitPaths();
  const pre = checkKitHome(p);
  if (pre.status === 'broken') throw new KitError('KIT_HOME_UNUSABLE', pre.detail, pre.fix);
  const disk = checkDisk('diskKit', 'Free space', p.home);
  if (disk.status === 'broken') throw new KitError('LOW_DISK', disk.detail, disk.fix);
  fs.mkdirSync(p.tools, { recursive: true });

  const sys = checkSystem();
  if (sys.status === 'broken') throw new KitError('UNSUPPORTED_SYSTEM', sys.detail, sys.fix);

  const done = {};
  const want = (t) => !only || only === t;
  if (want('node')) done.node = installNode(p);
  if (want('render')) done.render = await installRender(p, flags);
  if (want('transcribe')) done.transcribe = await installTranscribe(p);

  recordKit(); // the kit home exists now: put the launcher in place and note this kit's path
  const checks = runChecks();
  const { ready, summary } = summarise(only ? checks.filter((c) => c.id === only || !TOOLS.includes(c.id)) : checks);
  updateState({ lastDoctor: { at: new Date().toISOString(), ready, checks: Object.fromEntries(checks.map((c) => [c.id, c.status])) } });
  return { installed: done, ready, summary, checks };
}

function installNode(p) {
  const n = checkNode(p);
  if (n.status !== 'ok') throw new KitError('NODE_TOO_OLD', n.detail, n.fix);
  updateState({ node: { path: process.execPath, version: process.version, portable: n.portable, pinned: PINS.node } });
  return { action: 'recorded', path: process.execPath, version: process.version, portable: n.portable };
}

export async function installRender(p, flags = {}) {
  const src = renderSourceDir();
  if (!exists(path.join(src, 'cli.mjs')) || !exists(path.join(src, 'package.json'))) {
    throw new KitError('RENDER_SOURCE_MISSING', 'The renderer files are missing from the kit.', 'Reinstall the content kit plugin, then run install again.', { source: src });
  }
  const sourceHash = hashDir(src, RENDER_SKIP);
  const st = readState();
  const dest = p.render;
  const haveModules = isDir(path.join(dest, 'node_modules', '@remotion', 'renderer'));
  const upToDate = st.render && st.render.sourceHash === sourceHash && haveModules && exists(path.join(dest, 'cli.mjs')) && findBrowser(dest) && !flags.force;
  if (upToDate) {
    log('The video renderer is already set up.');
    return { action: 'already-installed', dir: dest };
  }

  log('Setting up the video renderer (this downloads about 300 MB the first time)...');
  // Replace the project files but keep node_modules so a refresh is quick.
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(dest)) {
    if (e === 'node_modules') continue;
    fs.rmSync(path.join(dest, e), { recursive: true, force: true });
  }
  copyDir(src, dest, RENDER_SKIP);
  const lock = exists(path.join(dest, 'package-lock.json'));
  const sameLock = haveModules && st.render && st.render.lockHash && lock && st.render.lockHash === hashFile(path.join(dest, 'package-lock.json'));
  if (!sameLock) await npm(lock ? ['ci', '--omit=dev'] : ['install', '--omit=dev'], dest);

  log('Getting the renderer ready (one-time download of its built-in browser)...');
  const r = await run(process.execPath, [path.join(dest, 'cli.mjs'), 'prepare'], { cwd: dest, env: process.env });
  process.stderr.write(r.stderr);
  const res = lastJson(r.stdout.toString('utf8'));
  if (r.code !== 0 || !res || res.ok === false) {
    if (res && res.code) throw new KitError(res.code, res.message, res.fix);
    throw new KitError('RENDER_PREPARE_FAILED', "The video renderer didn't finish setting up.", 'Check you are online, then run install again.', { detail: r.stderr.slice(-1500) });
  }
  findBinaries(dest); // throws if ffmpeg is not where it should be
  let remotionVersion = null;
  try {
    remotionVersion = JSON.parse(fs.readFileSync(path.join(dest, 'node_modules', 'remotion', 'package.json'), 'utf8')).version;
  } catch {}
  updateState({
    render: {
      dir: dest, sourceHash, lockHash: lock ? hashFile(path.join(dest, 'package-lock.json')) : null, remotionVersion, installedAt: new Date().toISOString(),
    },
  });
  return { action: 'installed', dir: dest, remotionVersion };
}

function hashFile(f) {
  return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
}

export function lastJson(text) {
  const lines = text.trim().split(/\r?\n/).reverse();
  for (const l of lines) {
    const s = l.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      try {
        return JSON.parse(s);
      } catch {}
    }
  }
  return null;
}

async function installTranscribe(p) {
  const modelDir = sttModelDir(p);
  // Kit 0.1.0 used whisper.cpp; its folder is about 200 MB and no longer used.
  if (isDir(p.oldWhisperDir)) {
    log('Removing the old speech-to-text tool...');
    fs.rmSync(p.oldWhisperDir, { recursive: true, force: true });
    updateState({ whisper: undefined });
  }
  if (checkTranscribe(p).status === 'ok') {
    log('Speech to text is already set up.');
    return { action: 'already-installed', model: MODEL.id };
  }

  // 1. The prebuilt speech library, from npm, into tools/stt/lib. No compiler, no admin.
  const pkgJson = path.join(p.sttLib, 'package.json');
  const want = { 'sherpa-onnx-node': PINS.sherpaOnnxNode, 'seek-bzip': PINS.seekBzip };
  let have = null;
  try {
    have = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).dependencies;
  } catch {}
  const pkgOk = have && JSON.stringify(have) === JSON.stringify(want) && exists(path.join(p.sttLib, 'node_modules', 'sherpa-onnx-node', 'package.json'));
  if (!pkgOk) {
    fs.mkdirSync(p.sttLib, { recursive: true });
    writeJson(pkgJson, { name: 'content-kit-speech', private: true, dependencies: want });
    log('Downloading speech to text (about 35 MB)...');
    await npm(['install', '--omit=dev', '--no-package-lock'], p.sttLib);
  }

  // 2. The speech model (about 108 MB), checked against its published checksums. One retry.
  if (!modelReady(modelDir)) {
    log('Downloading the speech model (about 110 MB)...');
    let last = -25;
    for (let attempt = 1; ; attempt++) {
      try {
        await installModel({
          modelDir,
          libDir: p.sttLib,
          onProgress: (f) => {
            const pct = Math.floor(f * 100);
            if (pct >= last + 25) {
              last = pct;
              log(`  ${pct}%`);
            }
          },
        });
        break;
      } catch (e) {
        if (attempt >= 2) {
          throw new KitError('MODEL_DOWNLOAD_FAILED', "The speech model didn't download completely.", 'Check you are online, then run install again.', { detail: String(e && e.message) });
        }
        log('The download was interrupted; trying once more...');
      }
    }
  }
  updateState({
    stt: { engine: 'sherpa-onnx', sherpaOnnxNode: PINS.sherpaOnnxNode, lib: p.sttLib, model: MODEL.id, modelDir, installedAt: new Date().toISOString() },
  });
  const check = checkTranscribe(p);
  if (check.status !== 'ok') throw new KitError('TRANSCRIBE_BROKEN', check.detail, check.fix, check.error ? { detail: check.error } : {});
  return { action: 'installed', model: MODEL.id };
}
