// render and smoke-test: thin wrappers over the render project's cli.mjs (package C).
//   node <kit home>/render/cli.mjs render --brand-dir <dir> --job-dir <dir> --out <file> [--draft]
//   node <kit home>/render/cli.mjs smoke  --brand-dir <dir> --out <file>

import fs from 'node:fs';
import path from 'node:path';
import { KitError, exists, hashDir, hashText, kitPaths, log, readJsonFile, readState, run, writeJson } from './common.mjs';
import { RENDER_SKIP, installRender, lastJson, renderSourceDir } from './cmd-install.mjs';
import { jobContext, videoPathFor } from './cmd-media.mjs';
import { prepareCuts } from './cuts.mjs';
import { validateBrand, validateEdit } from './validate.mjs';

function renderCli() {
  const cli = path.join(kitPaths().render, 'cli.mjs');
  if (!exists(cli)) {
    throw new KitError('RENDER_NOT_INSTALLED', "The video renderer isn't set up on this computer yet.", 'Run install, then try again.');
  }
  return cli;
}

/**
 * After a plugin update the installed renderer can be older than the plugin's copy. Refresh it
 * before rendering, so a video is never made with old render code. Usually a quick file copy;
 * npm only runs if the renderer's packages changed.
 */
async function refreshRendererIfStale() {
  const st = readState();
  const src = renderSourceDir();
  if (!st.render || !st.render.sourceHash || !exists(path.join(src, 'package.json'))) return false;
  if (hashDir(src, RENDER_SKIP) === st.render.sourceHash) return false;
  log('The kit was updated, so the video renderer needs a quick refresh first...');
  await installRender(kitPaths());
  return true;
}

async function callRender(args) {
  await refreshRendererIfStale();
  const cli = renderCli();
  const r = await run(process.execPath, [cli, ...args], { cwd: path.dirname(cli), stream: false });
  process.stderr.write(r.stderr);
  const res = lastJson(r.stdout.toString('utf8'));
  if (!res) {
    throw new KitError('RENDER_FAILED', "The video renderer stopped without saying why.", 'Run doctor to check the renderer, then try again.', { detail: r.stderr.slice(-1500) });
  }
  if (res.ok === false || r.code !== 0) {
    throw new KitError(res.code || 'RENDER_FAILED', res.message || "The video didn't render.", res.fix || 'Try again.', res.detail ? { detail: res.detail } : {});
  }
  const { ok, ...rest } = res;
  void ok;
  return rest;
}

// The renderer reports missing logos, fonts, music and pictures itself, in the same words every
// time, so validation here skips the file checks (checkFiles: false) to avoid saying it twice.
function checkBrand(brandDir) {
  const file = path.join(brandDir, 'brand.json');
  const brand = readJsonFile(file, { what: 'brand.json' });
  const v = validateBrand(brand, { brandDir, checkFiles: false, licenceNote: false });
  if (v.problems.length) {
    throw new KitError('INVALID_BRAND_JSON', `brand.json has problems: ${v.problems.join(' ')}`, `Fix ${file}, then try again.`, { problems: v.problems });
  }
  return { brand, warnings: v.warnings };
}

export async function render(flags) {
  const ctx = jobContext(flags);
  const { brand, warnings: bw } = checkBrand(ctx.brandDir);
  const editFile = path.join(ctx.jobDir, 'edit.json');
  const edit = readJsonFile(editFile, { what: 'edit.json' });
  const v = validateEdit(edit, { brandDir: ctx.brandDir, jobDir: ctx.jobDir, brand, checkFiles: false });
  if (v.problems.length) {
    throw new KitError('INVALID_EDIT_JSON', `edit.json has problems: ${v.problems.join(' ')}`, `Fix ${editFile}, then render again.`, { problems: v.problems });
  }
  const draft = Boolean(flags.draft);
  const out = videoPathFor(ctx, edit.version, draft);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // Same inputs and the file is already there: nothing to do.
  const inputs = hashText(fs.readFileSync(editFile, 'utf8'), fs.readFileSync(path.join(ctx.brandDir, 'brand.json'), 'utf8'), draft);
  const stamp = path.join(ctx.work, `render-v${edit.version}${draft ? '-draft' : ''}.json`);
  if (!flags.force && exists(out) && exists(stamp)) {
    try {
      if (JSON.parse(fs.readFileSync(stamp, 'utf8')).inputs === inputs) {
        log(`Version ${edit.version}${draft ? ' (draft)' : ''} is already rendered from this edit.`);
        return { out, version: edit.version, draft, skipped: true, warnings: [...bw, ...v.warnings] };
      }
    } catch {}
  }

  // Copy the chosen moments out of the raw footage into steady H.264 files the renderer can
  // always play (see cuts.mjs).
  const cuts = await prepareCuts(ctx, edit);
  log(`Rendering version ${edit.version}${draft ? ' as a quick draft' : ''}...`);
  const args = ['render', '--brand-dir', ctx.brandDir, '--job-dir', ctx.jobDir, '--out', out, '--media', cuts.mapFile];
  if (draft) args.push('--draft');
  const res = await callRender(args);
  if (!exists(out)) throw new KitError('RENDER_FAILED', 'The renderer said it finished but the video file is missing.', 'Try the render again.');
  writeJson(stamp, { inputs, out, renderedAt: new Date().toISOString() });
  const warnings = [...bw, ...v.warnings, ...((res && res.warnings) || [])];
  return { ...res, out, version: edit.version, draft, skipped: false, clipCopies: { made: cuts.made, reused: cuts.reused }, warnings: [...new Set(warnings)] };
}

export async function smokeTest(flags) {
  if (typeof flags['brand-dir'] !== 'string' || !flags['brand-dir'].trim()) {
    throw new KitError('MISSING_FLAG', 'I need --brand-dir to do this.', 'Add it, for example: --brand-dir "brands/sample-studio"');
  }
  const brandDir = path.resolve(flags['brand-dir'].trim());
  const { warnings } = checkBrand(brandDir);
  const out = path.join(brandDir, 'exports', 'test-clip.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  log('Rendering a 5-second test clip in your brand colours...');
  const res = await callRender(['smoke', '--brand-dir', brandDir, '--out', out]);
  if (!exists(out)) throw new KitError('RENDER_FAILED', 'The test clip did not get saved.', 'Run doctor, then try again.');
  return { ...res, out, warnings: [...new Set([...warnings, ...((res && res.warnings) || [])])] };
}
