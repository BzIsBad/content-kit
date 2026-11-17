// Self-update (contracts §1 "Self-update" and §5 `update`).
//
// The desktop app can't update a plugin from its plugin screen, so the kit fetches its own fixes.
// It looks up the latest published release of the public repo by following GitHub's
// releases/latest redirect (no API, so no rate limit), downloads that tag's archive over https,
// unpacks it with zlib and the small tar reader below, and installs the working parts into
// <kit home>/kit/<version>/, laid out like the plugin folder so every path the kit derives from
// its own location still works. The launcher then runs the newest valid copy.
//
// Rules: only tags of the form vMAJOR.MINOR.PATCH, never a branch; https only (tests may use
// plain http on this computer through CONTENT_KIT_RELEASE_URL); the archive's plugin.json must
// carry the tag's version; nothing outside the kit's own parts is written; links, absolute paths
// and ".." are refused. Only node: built-ins.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import {
  KitError, PLUGIN_DIR, RELEASES, isDir, exists, kitPaths, kitSource, log, pluginVersion, readState, runSync, updateState,
} from './common.mjs';

export const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The parts of plugin/ a self-updated kit needs (paths inside plugin/, forward slashes). */
const PARTS = ['.claude-plugin/plugin.json', 'scripts/', 'render/', 'recipes/', 'templates/'];
const SKIP_SEGMENTS = new Set(['node_modules', '.DS_Store', '.bundle', 'out']);

export const OK_MARKER = '.kit-ok'; // written after a copy passed its checks
export const BAD_MARKER = '.bad'; // put there by hand to make the launcher skip a copy (rollback)
const KEEP_VERSIONS = 2; // the newest and the one before it, for rollback

const MAX_ARCHIVE = 100 * 1024 * 1024;
const MAX_UNPACKED = 400 * 1024 * 1024;
const MAX_ENTRIES = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;

const TIMEOUTS = {
  auto: { resolve: 5000, download: 30000 },
  manual: { resolve: 15000, download: 120000 },
};

// ---- Versions ------------------------------------------------------------------------------

export function cmpVersion(a, b) {
  const pa = String(a).split('.').map((x) => Number(x) || 0);
  const pb = String(b).split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// ---- Failures ------------------------------------------------------------------------------

/** kind: offline | bad-download | bad-release */
class UpdateFail extends Error {
  constructor(kind, detail) {
    super(detail);
    this.kind = kind;
  }
}

const KIT_ERRORS = {
  offline: [
    'UPDATE_OFFLINE',
    "I couldn't reach the place the kit's fixes come from. This computer may be offline, or the connection is blocked.",
    'Your videos still work with the kit you have. Say "check my video setup" again once you are online.',
  ],
  'bad-download': [
    'UPDATE_DOWNLOAD_BAD',
    "The latest fixes didn't download properly, so I left your kit exactly as it was.",
    'Your videos still work. Say "check my video setup" again later to try once more.',
  ],
  'bad-release': [
    'UPDATE_RELEASE_BAD',
    "The latest kit release didn't pass its safety checks, so I left your kit exactly as it was.",
    'Your videos still work. Mention this to whoever helps you with the kit.',
  ],
};

function toKitError(e) {
  if (e instanceof KitError) return e;
  const [code, message, fix] = KIT_ERRORS[(e && e.kind) || 'bad-download'] || KIT_ERRORS['bad-download'];
  return new KitError(code, message, fix, { detail: String((e && e.message) || e).slice(0, 800) });
}

// ---- Where releases come from ----------------------------------------------------------------

/** The repo base URL. CONTENT_KIT_RELEASE_URL overrides it (tests). */
export function releaseBase() {
  const o = process.env.CONTENT_KIT_RELEASE_URL;
  return (o && o.trim() ? o.trim() : RELEASES.repo).replace(/\/+$/, '');
}

function allowedUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  // Plain http only for a test server on this computer, and only when the source is overridden.
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  return url.protocol === 'http:' && local && Boolean(process.env.CONTENT_KIT_RELEASE_URL);
}

export function autoUpdateDisabled() {
  const v = process.env.CONTENT_KIT_NO_UPDATE;
  return Boolean(v && v.trim() && v.trim() !== '0');
}

async function request(url, signal) {
  if (!allowedUrl(url)) throw new UpdateFail('bad-release', `refused a non-https address: ${url}`);
  try {
    return await fetch(url, { redirect: 'manual', signal, headers: { 'user-agent': 'content-kit-updater' } });
  } catch (e) {
    throw new UpdateFail('offline', `${url}: ${(e && e.cause && e.cause.code) || (e && e.name) || ''} ${(e && e.message) || e}`.trim());
  }
}

async function discard(res) {
  try {
    await res.body?.cancel();
  } catch {}
}

/**
 * The latest published release: { tag, version } or { tag: null } when nothing is published
 * (or the latest release's tag isn't vX.Y.Z, which the kit never installs).
 */
export async function resolveLatest({ signal } = {}) {
  const url = `${releaseBase()}/releases/latest`;
  const res = await request(url, signal);
  await discard(res);
  if (res.status === 404) return { tag: null };
  if (res.status < 300 || res.status >= 400) throw new UpdateFail('offline', `${url} answered ${res.status}`);
  const loc = res.headers.get('location');
  if (!loc) throw new UpdateFail('offline', `${url} redirected nowhere`);
  let pathname;
  try {
    pathname = new URL(loc, url).pathname;
  } catch {
    throw new UpdateFail('offline', `${url} redirected to an unreadable address`);
  }
  const m = /\/releases\/tag\/([^/]+)$/.exec(pathname);
  if (!m) return { tag: null }; // GitHub sends /releases when there is no release yet
  let tag;
  try {
    tag = decodeURIComponent(m[1]);
  } catch {
    return { tag: null };
  }
  if (!TAG_RE.test(tag)) return { tag: null, ignored: tag };
  return { tag, version: tag.slice(1) };
}

/** Download the tag's .tar.gz, following at most 5 https redirects, with a size cap. */
async function downloadArchive(tag, signal) {
  let url = `${releaseBase()}/archive/refs/tags/${tag}.tar.gz`;
  for (let hop = 0; hop < 6; hop++) {
    const res = await request(url, signal);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await discard(res);
      if (!loc) throw new UpdateFail('bad-download', `${url} redirected nowhere`);
      url = new URL(loc, url).href;
      continue;
    }
    if (res.status !== 200) {
      await discard(res);
      throw new UpdateFail(res.status >= 500 ? 'offline' : 'bad-download', `${url} answered ${res.status}`);
    }
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > MAX_ARCHIVE) throw new UpdateFail('bad-download', 'the archive is far bigger than a kit release');
        chunks.push(chunk);
      }
    } catch (e) {
      if (e instanceof UpdateFail) throw e;
      throw new UpdateFail('offline', `the download stopped: ${(e && e.message) || e}`);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
  throw new UpdateFail('bad-download', 'too many redirects');
}

// ---- A small tar reader --------------------------------------------------------------------

function cstr(buf, start, len) {
  const s = buf.subarray(start, start + len);
  const end = s.indexOf(0);
  return s.subarray(0, end === -1 ? s.length : end).toString('utf8');
}

function octal(buf, start, len) {
  if (buf[start] & 0x80) throw new UpdateFail('bad-download', 'the archive uses a size the kit never publishes');
  const s = cstr(buf, start, len).trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) throw new UpdateFail('bad-download', 'the archive has a damaged header');
  return parseInt(s, 8);
}

function parsePax(data) {
  const out = {};
  let off = 0;
  // Records are "<len> <key>=<value>\n", where len counts bytes.
  while (off < data.length) {
    const sp = data.indexOf(0x20, off);
    if (sp === -1) break;
    const len = Number(data.subarray(off, sp).toString('ascii'));
    if (!Number.isInteger(len) || len <= 0 || off + len > data.length) throw new UpdateFail('bad-download', 'the archive has a damaged header');
    const rec = data.subarray(sp + 1, off + len - 1).toString('utf8');
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    off += len;
  }
  return out;
}

/** Read a tar archive into entries { name, type, data }. type: file, dir, link, other. */
export function readTar(buf) {
  const entries = [];
  let off = 0;
  let pax = null;
  let longName = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (octal(h, 148, 8) !== sum) throw new UpdateFail('bad-download', 'the archive has a damaged header');
    const size = octal(h, 124, 12);
    const flag = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
    let name = cstr(h, 0, 100);
    if (cstr(h, 257, 5) === 'ustar') {
      const prefix = cstr(h, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const start = off + 512;
    if (start + size > buf.length) throw new UpdateFail('bad-download', 'the archive is cut short');
    const data = buf.subarray(start, start + size);
    off = start + Math.ceil(size / 512) * 512;
    if (flag === 'g') continue; // global header (git puts the commit id here)
    if (flag === 'x') {
      pax = parsePax(data);
      continue;
    }
    if (flag === 'L') {
      longName = cstr(data, 0, data.length);
      continue;
    }
    if (pax && pax.path) name = pax.path;
    else if (longName) name = longName;
    pax = null;
    longName = null;
    const type = flag === '0' || flag === '7' ? 'file' : flag === '5' ? 'dir' : flag === '1' || flag === '2' ? 'link' : 'other';
    entries.push({ name, type, data });
    if (entries.length > MAX_ENTRIES) throw new UpdateFail('bad-download', 'the archive has far more files than a kit release');
  }
  return entries;
}

/** A safe relative path ("a/b/c") or null. No absolute paths, drive letters, backslashes or "..". */
export function safeRel(name) {
  if (typeof name !== 'string' || !name || name.includes('\0') || name.includes('\\')) return null;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const parts = name.split('/').filter((s) => s && s !== '.');
  if (!parts.length || parts.some((s) => s === '..' || /^[A-Za-z]:$/.test(s))) return null;
  return parts.join('/');
}

function wanted(rel) {
  if (rel.split('/').some((s) => SKIP_SEGMENTS.has(s))) return false;
  return PARTS.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
}

/**
 * Unpack the kit's parts from a release archive into destDir (which must exist and be empty).
 * Refuses the whole archive if any entry is a link, a special file or an unsafe path.
 */
export function unpackRelease(gz, destDir) {
  let tar;
  try {
    tar = zlib.gunzipSync(gz, { maxOutputLength: MAX_UNPACKED });
  } catch (e) {
    throw new UpdateFail('bad-download', `the archive isn't a readable .tar.gz (${e.code || e.message})`);
  }
  const entries = readTar(tar);
  if (!entries.length) throw new UpdateFail('bad-download', 'the archive is empty');
  const root = path.resolve(destDir);
  let top = null;
  const files = [];
  for (const e of entries) {
    const rel = safeRel(e.name);
    if (!rel) throw new UpdateFail('bad-release', `the archive holds an unsafe path: ${JSON.stringify(e.name).slice(0, 200)}`);
    if (e.type === 'link' || e.type === 'other') throw new UpdateFail('bad-release', `the archive holds a link or special file: ${rel}`);
    const [first, ...rest] = rel.split('/');
    if (top === null) top = first;
    else if (first !== top) throw new UpdateFail('bad-release', 'the archive has more than one top folder');
    if (!rest.length || rest[0] !== 'plugin' || rest.length < 2) continue;
    const inPlugin = rest.slice(1).join('/');
    if (!wanted(inPlugin)) continue;
    const dest = path.resolve(root, ...inPlugin.split('/'));
    if (!dest.startsWith(root + path.sep)) throw new UpdateFail('bad-release', `the archive tried to write outside its folder: ${rel}`);
    files.push({ dest, entry: e });
  }
  for (const { dest, entry } of files) {
    if (entry.type === 'dir') fs.mkdirSync(dest, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.data, { flag: 'wx' });
    }
  }
  return files.filter((f) => f.entry.type === 'file').length;
}

// ---- Installed copies ----------------------------------------------------------------------

function readJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

/** The launcher's quick self-check, repeated here: a copy is usable only if all of this holds. */
export function validKitDir(dir, version = path.basename(dir)) {
  if (!VERSION_RE.test(version)) return false;
  if (exists(path.join(dir, BAD_MARKER)) || !exists(path.join(dir, OK_MARKER))) return false;
  const m = readJson(path.join(dir, '.claude-plugin', 'plugin.json'));
  if (!m || m.version !== version) return false;
  return exists(path.join(dir, 'scripts', 'kit.mjs')) && exists(path.join(dir, 'scripts', 'lib', 'common.mjs'));
}

/** Valid self-updated copies, newest first: [{ version, dir }]. */
export function installedKits(p = kitPaths()) {
  let names = [];
  try {
    names = fs.readdirSync(p.kits);
  } catch {
    return [];
  }
  return names
    .filter((n) => VERSION_RE.test(n) && validKitDir(path.join(p.kits, n), n))
    .map((n) => ({ version: n, dir: path.join(p.kits, n) }))
    .sort((a, b) => cmpVersion(b.version, a.version));
}

/** The kit this computer would use: the newest of this running copy and the self-updated ones. */
function currentKit(p) {
  const running = { version: pluginVersion() || '0.0.0', dir: PLUGIN_DIR };
  const best = installedKits(p)[0];
  return best && cmpVersion(best.version, running.version) > 0 ? best : running;
}

/** Run the unpacked kit in a separate Node: its entry answers, and every module loads. */
function selfCheck(dir) {
  const kitFile = path.join(dir, 'scripts', 'kit.mjs');
  const help = runSync(process.execPath, [kitFile, 'help'], { timeout: 30000, env: { ...process.env, CONTENT_KIT_NO_UPDATE: '1' } });
  let json = null;
  try {
    json = JSON.parse(help.stdout.trim().split(/\r?\n/).pop());
  } catch {}
  if (!json || json.ok !== true || !Array.isArray(json.commands)) {
    throw new UpdateFail('bad-release', `the new kit didn't start: ${(help.stderr || '').slice(-400)}`);
  }
  const libDir = path.join(dir, 'scripts', 'lib');
  const urls = fs.readdirSync(libDir).filter((f) => f.endsWith('.mjs')).map((f) => pathToFileURL(path.join(libDir, f)).href);
  const code = 'for (const u of JSON.parse(process.env.CK_MODULES)) await import(u); process.stdout.write("loaded")';
  const load = runSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 30000, env: { ...process.env, CK_MODULES: JSON.stringify(urls) } });
  if (!load.stdout.includes('loaded')) throw new UpdateFail('bad-release', `the new kit's parts didn't load: ${(load.stderr || '').slice(-400)}`);
}

function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      // Windows: a virus scanner or indexer can hold a fresh folder for a moment.
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (i + 1));
    }
  }
}

function rmQuiet(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}

/** Download, check and install one tagged release. Returns the installed folder. */
async function installRelease(p, tag, signal) {
  const version = tag.slice(1);
  const gz = await downloadArchive(tag, signal);
  fs.mkdirSync(p.kits, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(p.kits, `.tmp-${version}-`));
  try {
    const count = unpackRelease(gz, tmp);
    log(`Unpacked ${count} files of the kit ${version}.`);
    const m = readJson(path.join(tmp, '.claude-plugin', 'plugin.json'));
    if (!m) throw new UpdateFail('bad-release', 'the release has no plugin.json');
    if (m.version !== version) throw new UpdateFail('bad-release', `the release is tagged ${tag} but its plugin.json says ${m.version}`);
    if (!exists(path.join(tmp, 'scripts', 'kit.mjs'))) throw new UpdateFail('bad-release', 'the release has no scripts/kit.mjs');
    selfCheck(tmp);
    fs.writeFileSync(path.join(tmp, OK_MARKER), `${JSON.stringify({ version, tag, from: releaseBase(), installedAt: new Date().toISOString() })}\n`);
  } catch (e) {
    rmQuiet(tmp);
    throw e;
  }
  const dest = path.join(p.kits, version);
  if (exists(dest)) {
    const old = path.join(p.kits, `.old-${version}-${process.pid}-${Date.now()}`);
    try {
      renameRetry(dest, old);
    } catch (e) {
      rmQuiet(tmp);
      // In use (Windows) or another update got there first; the copy in place stays.
      if (validKitDir(dest, version)) return dest;
      throw new UpdateFail('bad-download', `couldn't replace ${dest}: ${e.message}`);
    }
    rmQuiet(old);
  }
  try {
    renameRetry(tmp, dest);
  } catch (e) {
    rmQuiet(tmp);
    if (validKitDir(dest, version)) return dest; // another kit run installed the same version
    throw new UpdateFail('bad-download', `couldn't move the new kit into place: ${e.message}`);
  }
  return dest;
}

/** Keep the newest KEEP_VERSIONS valid copies (and the running one); remove the rest and leftovers. */
export function pruneKits(p = kitPaths()) {
  let names = [];
  try {
    names = fs.readdirSync(p.kits);
  } catch {
    return [];
  }
  const running = path.resolve(PLUGIN_DIR);
  const keep = new Set(installedKits(p).slice(0, KEEP_VERSIONS).map((k) => path.resolve(k.dir)));
  const removed = [];
  for (const n of names) {
    const dir = path.resolve(p.kits, n);
    if (keep.has(dir) || dir === running) continue;
    if (n.startsWith('.tmp-') || n.startsWith('.old-')) {
      // Another kit run may be unpacking right now; leave fresh leftovers alone.
      let age = 0;
      try {
        age = Date.now() - fs.statSync(dir).mtimeMs;
      } catch {}
      if (age < 60 * 60 * 1000) continue;
    } else if (!VERSION_RE.test(n)) continue;
    rmQuiet(dir);
    if (!exists(dir)) removed.push(n);
  }
  return removed;
}

/** Recipe ids whose skill template differs between two kit folders (their generated skills can be refreshed). */
function changedRecipes(fromDir, toDir) {
  const out = [];
  const dir = path.join(toDir, 'recipes');
  let ids = [];
  try {
    ids = fs.readdirSync(dir).filter((n) => isDir(path.join(dir, n)));
  } catch {
    return out;
  }
  for (const id of ids.sort()) {
    let a = null;
    let b = null;
    try {
      a = fs.readFileSync(path.join(fromDir, 'recipes', id, 'skill.template.md'));
    } catch {}
    try {
      b = fs.readFileSync(path.join(dir, id, 'skill.template.md'));
    } catch {}
    if (b && (!a || !a.equals(b))) out.push(id);
  }
  return out;
}

// ---- The update itself ---------------------------------------------------------------------

/**
 * Check for, and (unless checkOnly) install, the latest release.
 * mode: 'auto' (new-job; short timeouts) or 'manual' (the update command, doctor).
 * Returns { action, current, latest, from?, to?, kitDir?, recipesChanged?, pruned? }.
 * action: updated | up-to-date | reinstalled | no-release | held-back | available (checkOnly).
 * Throws UpdateFail (kind offline / bad-download / bad-release).
 */
async function runUpdate({ mode = 'manual', checkOnly = false, force = false } = {}) {
  const p = kitPaths();
  const t = TIMEOUTS[mode] || TIMEOUTS.manual;
  const cur = currentKit(p);
  const latest = await resolveLatest({ signal: AbortSignal.timeout(t.resolve) });
  const base = { current: cur.version, latest: latest.version || null };
  if (!latest.tag) return { ...base, action: 'no-release' };
  const newer = cmpVersion(latest.version, cur.version) > 0;
  if (checkOnly) return { ...base, action: newer ? 'available' : 'up-to-date' };
  if (!newer && !force) return { ...base, action: 'up-to-date' };
  // Rolled back by hand on this computer (a .bad file): don't put that version back.
  if (!force && exists(path.join(p.kits, latest.version, BAD_MARKER))) return { ...base, action: 'held-back' };
  log(`Getting the kit's latest fixes (${cur.version} to ${latest.version})...`);
  const kitDir = await installRelease(p, latest.tag, AbortSignal.timeout(t.download));
  const pruned = pruneKits(p);
  return {
    ...base,
    action: newer ? 'updated' : 'reinstalled',
    from: cur.version,
    to: latest.version,
    kitDir,
    recipesChanged: changedRecipes(cur.dir, kitDir),
    pruned,
  };
}

function record(patch) {
  try {
    const prev = readState().update || {};
    updateState({ update: { ...prev, ...patch } });
  } catch {
    // A read-only kit home is reported by doctor.
  }
}

/** `kit.mjs update [--check] [--force]` */
export async function update(flags = {}) {
  const p = kitPaths();
  const home = isDir(p.home);
  const now = new Date().toISOString();
  try {
    const r = await runUpdate({ mode: 'manual', checkOnly: Boolean(flags.check), force: Boolean(flags.force) });
    if (home) {
      record({
        lastCheckAt: now,
        lastResult: r.action,
        latest: r.latest,
        detail: undefined,
        ...(r.action === 'updated' || r.action === 'reinstalled' ? { lastUpdate: { from: r.from, to: r.to, at: now, kitDir: r.kitDir } } : {}),
      });
    }
    return { ...r, source: kitSource() };
  } catch (e) {
    if (home) record({ lastCheckAt: now, lastResult: (e && e.kind) || 'failed', detail: String((e && e.message) || e).slice(0, 300) });
    throw toKitError(e);
  }
}

/**
 * The automatic check at the start of new-job: at most once every RELEASES.checkEveryDays (or
 * RELEASES.retryAfterDays after a check that failed), short
 * timeouts, and it never throws. Returns { from, to, recipesChanged } when it installed an update.
 */
export async function autoUpdate() {
  try {
    if (autoUpdateDisabled()) return null;
    const p = kitPaths();
    if (!isDir(p.home)) return null;
    const st = readState();
    const last = Date.parse((st.update && st.update.lastCheckAt) || '');
    const age = Date.now() - last;
    // A check that got an answer waits the full interval; one that didn't retries after a day.
    const answered = ['up-to-date', 'updated', 'reinstalled', 'held-back', 'no-release'].includes(st.update && st.update.lastResult);
    const waitDays = answered ? RELEASES.checkEveryDays : RELEASES.retryAfterDays;
    if (Number.isFinite(last) && age >= 0 && age < waitDays * DAY_MS) return null;
    const now = new Date().toISOString();
    // Note the attempt first, so a run that is cut off doesn't retry on every job.
    record({ lastCheckAt: now, lastResult: 'checking' });
    try {
      const r = await runUpdate({ mode: 'auto' });
      record({
        lastCheckAt: now,
        lastResult: r.action,
        latest: r.latest,
        detail: undefined,
        ...(r.action === 'updated' ? { lastUpdate: { from: r.from, to: r.to, at: now, kitDir: r.kitDir } } : {}),
      });
      return r.action === 'updated' ? { from: r.from, to: r.to, recipesChanged: r.recipesChanged } : null;
    } catch (e) {
      record({ lastCheckAt: now, lastResult: (e && e.kind) || 'failed', detail: String((e && e.message) || e).slice(0, 300) });
      log("Couldn't check for kit fixes just now; carrying on with the kit you have.");
      return null;
    }
  } catch {
    return null;
  }
}

/** For doctor: which kit is running, where it came from, and whether a newer release exists. */
export async function kitStatus() {
  const p = kitPaths();
  const st = readState();
  const out = {
    version: pluginVersion(),
    source: kitSource(),
    path: path.join(PLUGIN_DIR, 'scripts', 'kit.mjs'),
    latest: null,
    updateAvailable: null,
    checked: false,
    lastCheckAt: (st.update && st.update.lastCheckAt) || null,
    lastResult: (st.update && st.update.lastResult) || null,
  };
  const best = installedKits(p)[0];
  if (best && cmpVersion(best.version, out.version || '0.0.0') > 0) out.newerInstalled = best.version;
  if (autoUpdateDisabled()) return out;
  try {
    const latest = await resolveLatest({ signal: AbortSignal.timeout(TIMEOUTS.auto.resolve) });
    out.checked = true;
    out.latest = latest.version || null;
    const have = out.newerInstalled || out.version || '0.0.0';
    out.updateAvailable = Boolean(latest.version && cmpVersion(latest.version, have) > 0);
  } catch {
    out.checkError = 'Could not reach the release page (offline or blocked).';
  }
  return out;
}
