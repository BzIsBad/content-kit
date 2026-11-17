#!/usr/bin/env node
// Stable launcher for the content kit. `install` and `scaffold` copy this file to
// <kit home>/kit.mjs. The workspace permission list and every generated skill call that copy,
// so their path never changes when the plugin updates (the plugin's own folder name carries
// its version, and an old version's folder is removed some days after an update).
//
// It finds the newest kit.mjs it can see and runs it with the same arguments:
//   1. the one recorded in state.json (every run of kit.mjs records its own path there);
//   2. any installed copy of the plugin in Claude's plugin cache, skipping versions marked as
//      replaced (".orphaned_at").
// The highest plugin version wins. If none is found it prints the kit's usual failure JSON.
// Only node: built-ins, so it runs on a bare Node.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This file lives in the kit home, so the kit home is the folder it sits in. Pass that on, so the
// kit it starts uses the same home even if CONTENT_KIT_HOME isn't set.
const HOME = path.dirname(fileURLToPath(import.meta.url));
if (!(process.env.CONTENT_KIT_HOME && process.env.CONTENT_KIT_HOME.trim())) process.env.CONTENT_KIT_HOME = HOME;

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

/** The plugin folder holding scripts/kit.mjs, and its version from .claude-plugin/plugin.json. */
function describe(kitFile) {
  try {
    if (!fs.statSync(kitFile).isFile()) return null;
  } catch {
    return null;
  }
  const root = path.dirname(path.dirname(kitFile));
  if (fs.existsSync(path.join(root, '.orphaned_at'))) return null;
  const manifest = readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  return { kitFile, version: (manifest && manifest.version) || '0.0.0' };
}

function cmpVersion(a, b) {
  const pa = String(a).split(/[.+-]/).map((x) => Number(x) || 0);
  const pb = String(b).split(/[.+-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
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

function pick() {
  const state = readJson(path.join(kitHome(), 'state.json')) || {};
  const recorded = state.kit && state.kit.path;
  const found = [recorded, ...cacheCandidates()].filter(Boolean).map(describe).filter(Boolean);
  // Highest version first; on a tie keep the recorded one (it is first in the list).
  found.sort((a, b) => cmpVersion(b.version, a.version));
  return found[0] || null;
}

const best = pick();
if (!best) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    code: 'KIT_NOT_FOUND',
    message: "I can't find the content kit on this computer. It may have been removed or moved by an update.",
    fix: 'Say "check my video setup" so Claude can find the kit again, or add the content kit plugin again.',
  })}\n`, () => process.exit(1));
} else {
  await import(pathToFileURL(best.kitFile).href);
}
