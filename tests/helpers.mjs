// Test helpers: run kit.mjs as a child process against a temporary kit home, and build fixtures.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KIT = path.join(ROOT, 'plugin', 'scripts', 'kit.mjs');

export function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ck-${prefix}-`));
}

/**
 * Run kit.mjs (or `script`, such as the launcher in a kit home). Asserts the stdout contract
 * (exactly one JSON object) and returns it.
 */
export function kit(args, { home, env = {}, cwd, script = KIT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: cwd || ROOT,
      // The automatic update check is off in tests unless a test turns it on (it would reach GitHub).
      env: { ...process.env, CONTENT_KIT_NO_UPDATE: '1', ...(home ? { CONTENT_KIT_HOME: home } : {}), ...env },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      const lines = out.split('\n').filter((l) => l.trim());
      if (lines.length !== 1) {
        reject(new Error(`stdout should be exactly one JSON line, got ${lines.length}:\n${out}\n--- stderr ---\n${err.slice(-3000)}`));
        return;
      }
      let json;
      try {
        json = JSON.parse(lines[0]);
      } catch (e) {
        reject(new Error(`stdout is not JSON: ${out}`));
        return;
      }
      if (json.ok !== (code === 0)) {
        reject(new Error(`exit code ${code} does not match ok=${json.ok}`));
        return;
      }
      if (!json.ok) {
        for (const k of ['code', 'message', 'fix']) {
          if (typeof json[k] !== 'string' || !json[k]) {
            reject(new Error(`failure is missing "${k}": ${out}`));
            return;
          }
        }
        if (!/^[A-Z][A-Z0-9_]*$/.test(json.code)) {
          reject(new Error(`code is not SNAKE_CASE: ${json.code}`));
          return;
        }
      }
      resolve({ code, json, stderr: err });
    });
  });
}

/** A valid brand.json for an invented brand. */
export function sampleBrand(slug = 'harbor-pine', name = 'Harbor & Pine Bakery') {
  return {
    schemaVersion: 1,
    slug,
    name,
    teamSize: 2,
    colors: { primary: '#23395B', secondary: '#F7F0E6', accent: '#D9822B', text: '#FFFFFF', textOutline: '#000000' },
    fonts: { headline: { family: 'Inter', file: null }, body: { family: 'Inter', file: null } },
    logo: { onDark: null, onLight: null },
    captions: { style: 'word-highlight', position: 'lower-third', maxWordsPerLine: 4, uppercase: false, fontSizePct: 5.5 },
    reel: {
      minSeconds: 5,
      maxSeconds: 90,
      framing: 'crop-center',
      watermark: { enabled: true, corner: 'top-right', opacity: 0.9 },
      endCard: { enabled: true, seconds: 1.5, cta: 'Order at harborpine.example' },
    },
    music: { defaultTrack: null, volumeDb: -18 },
  };
}

/** Download a file once into a cache folder. */
export async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

// Public domain: a 1961 US presidential inaugural speech (a US federal government work),
// the 11-second sample from the whisper.cpp repository (used here only as a speech sample).
export const SPEECH_SAMPLE_WAV = 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav';
