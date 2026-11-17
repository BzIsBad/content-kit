#!/usr/bin/env node
// launcher-generation: 2
// Stable launcher for the content kit. `install` and `scaffold` copy this file to
// <kit home>/kit.mjs. The workspace permission list and every generated skill call that copy,
// so their path never changes when the kit updates.
//
// It finds the newest usable kit.mjs and runs it with the same arguments. Candidates:
//   1. the self-updated copies in <kit home>/kit/<version>/ (written by `kit.mjs update`);
//   2. the one recorded in state.json (every run of kit.mjs records its own path there);
//   3. any installed copy of the plugin in Claude's plugin cache, skipping versions marked as
//      replaced (".orphaned_at").
// The highest version wins; on a tie a self-updated copy wins, then the recorded one. A copy that
// fails the quick self-check below (files missing, version not matching its folder, not marked
// as checked by the updater, or marked ".bad" by hand) is skipped, so the one before it runs: that
// is the rollback. If none is found it prints the kit's usual failure JSON.
// Only node: built-ins, so it runs on a bare Node. The "launcher-generation" line above stops an
// older kit from putting back an older launcher; bump it whenever this file's behaviour changes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This file lives in the kit home, so the kit home is the folder it sits in. Pass that on, so the
// kit it starts uses the same home even if CONTENT_KIT_HOME isn't set.
const HOME = path.dirname(fileURLToPath(import.meta.url));
if (!(process.env.CONTENT_KIT_HOME && process.env.CONTENT_KIT_HOME.trim())) process.env.CONTENT_KIT_HOME = HOME;

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function kitHome() {
  return path.resolve(process.env.CONTENT_KIT_HOME.trim());
}

function readJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function isFile(f) {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
}

/** A plugin copy: the folder holding scripts/kit.mjs, with its version from .claude-plugin/plugin.json. */
function describePlugin(kitFile, rank) {
  if (!isFile(kitFile)) return null;
  const root = path.dirname(path.dirname(kitFile));
  if (fs.existsSync(path.join(root, '.orphaned_at')) || fs.existsSync(path.join(root, '.bad'))) return null;
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  return { kitFile, version: (manifest && manifest.version) || '0.0.0', rank };
}

/** A self-updated copy in <kit home>/kit/<version>/: checked by the updater and still whole. */
function describeSelfUpdated(dir) {
  const version = path.basename(dir);
  if (!VERSION_RE.test(version)) return null;
  if (fs.existsSync(path.join(dir, '.bad')) || !isFile(path.join(dir, '.kit-ok'))) return null;
  const manifest = readJson(path.join(dir, '.claude-plugin', 'plugin.json'));
  if (!manifest || manifest.version !== version) return null;
  const kitFile = path.join(dir, 'scripts', 'kit.mjs');
  if (!isFile(kitFile) || !isFile(path.join(dir, 'scripts', 'lib', 'common.mjs'))) return null;
  return { kitFile, version, rank: 0 };
}

function cmpVersion(a, b) {
  const pa = String(a).split(/[.+-]/).map((x) => Number(x) || 0);
  const pb = String(b).split(/[.+-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function selfUpdated() {
  const dir = path.join(kitHome(), 'kit');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.map((n) => describeSelfUpdated(path.join(dir, n))).filter(Boolean);
}

function cacheCandidates() {
  const roots = [];
  if (process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR) roots.push(process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR);
  roots.push(path.join(os.homedir(), '.claude', 'plugins', 'cache'));
  const out = [];
  for (const cache of roots) {
    let markets = [];
    try {
      markets = fs.readdirSync(cache);
    } catch {
      continue;
    }
    for (const m of markets) {
      const pluginDir = path.join(cache, m, 'content-kit');
      let versions = [];
      try {
        versions = fs.readdirSync(pluginDir);
      } catch {
        continue;
      }
      for (const v of versions) out.push(path.join(pluginDir, v, 'scripts', 'kit.mjs'));
    }
  }
  return out;
}

/** Every usable kit, best first. */
function candidates() {
  const state = readJson(path.join(kitHome(), 'state.json')) || {};
  const recorded = state.kit && state.kit.path;
  const kitsDir = path.resolve(kitHome(), 'kit') + path.sep;
  const found = [
    ...selfUpdated(),
    // The recorded path may itself be a self-updated copy; that one is already in the list.
    ...(recorded && !path.resolve(recorded).startsWith(kitsDir) ? [describePlugin(recorded, 1)] : []),
    ...cacheCandidates().map((f) => describePlugin(f, 2)),
  ].filter(Boolean);
  found.sort((a, b) => cmpVersion(b.version, a.version) || a.rank - b.rank);
  return found;
}

const list = candidates();
if (!list.length) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    code: 'KIT_NOT_FOUND',
    message: "I can't find the content kit on this computer. It may have been removed or moved by an update.",
    fix: 'Say "check my video setup" so Claude can find the kit again, or add the content kit plugin again.',
  })}\n`, () => process.exit(1));
} else {
  // If the best copy can't even load (a file went missing after the check), try the next one.
  // A kit that loads prints its own result, so nothing is run twice.
  let started = false;
  for (const c of list) {
    try {
      await import(pathToFileURL(c.kitFile).href);
      started = true;
      break;
    } catch (e) {
      process.stderr.write(`The kit at ${c.kitFile} didn't start (${(e && e.message) || e}); trying the one before it.\n`);
    }
  }
  if (!started) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      code: 'KIT_NOT_FOUND',
      message: "The content kit on this computer won't start.",
      fix: 'Say "check my video setup" so Claude can repair the kit, or add the content kit plugin again.',
    })}\n`, () => process.exit(1));
  }
}
