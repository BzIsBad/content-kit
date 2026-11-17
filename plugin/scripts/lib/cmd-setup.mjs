// scaffold, add-brand, new-job, validate

import fs from 'node:fs';
import path from 'node:path';
import { KitError, PLUGIN_DIR, SLUG_RE, ensureLauncher, recordKit, exists, isDir, kitPaths, localDateStamp, readJsonFile, readState, toPosix, writeFileAtomic, writeJson } from './common.mjs';
import { cloudSyncCheck } from './system.mjs';
import { detectKind, validateBrand, validateEdit } from './validate.mjs';
import { autoUpdate } from './update.mjs';

function requireFlag(flags, name, example) {
  const v = flags[name];
  if (typeof v !== 'string' || !v.trim()) {
    throw new KitError('MISSING_FLAG', `I need --${name} to do this.`, `Add it, for example: --${name} ${example}`);
  }
  return path.resolve(v.trim());
}

function assertNotSynced(dir, what) {
  const c = cloudSyncCheck(dir);
  if (c.synced) {
    throw new KitError(
      'CLOUD_SYNCED_FOLDER',
      `Your ${what} can't live here because ${c.reason}. Big video files in a synced folder fill your cloud storage and can break renders halfway.`,
      'Make a folder on this computer that is not synced (for example a "Content" folder in your home folder), open that in Claude, and run setup again.',
      { service: c.service },
    );
  }
}

// ---- scaffold ------------------------------------------------------------------------------

/** The permission allowlist that lets Claude run the kit without asking every time. */
export function settingsFor({ nodePath, kitScript }) {
  // Placeholders a template may use. Paths are given with forward slashes for Git Bash on Windows.
  const tokens = {
    '{{NODE}}': toPosix(nodePath),
    '{{KIT}}': toPosix(kitScript),
    '{{KIT_HOME}}': toPosix(kitPaths().home),
  };
  const template = path.join(PLUGIN_DIR, 'templates', 'settings.json');
  if (exists(template)) {
    let text = fs.readFileSync(template, 'utf8');
    for (const [k, v] of Object.entries(tokens)) text = text.split(k).join(JSON.stringify(v).slice(1, -1));
    try {
      return { settings: JSON.parse(text), source: 'template' };
    } catch {
      // fall through to the built-in default
    }
  }
  const n = tokens['{{NODE}}'];
  const k = tokens['{{KIT}}'];
  return {
    source: 'built-in',
    settings: {
      permissions: {
        // "/path" anchors at the folder holding this settings file's project (the workspace).
        // Edit rules cover every built-in file-editing tool. See code.claude.com/docs/en/permissions.
        allow: [`Bash("${n}" "${k}" *)`, `PowerShell(& "${n}" "${k}" *)`, 'Edit(/brands/**)', 'Edit(/.claude/skills/**)', 'Edit(/CLAUDE.md)'],
        deny: ['Edit(/brands/*/raw/**)'],
      },
    },
  };
}

// Rules earlier kit versions wrote. A merge replaces them with the current ones.
const OLD_KIT_RULES = new Set(['Edit(./brands/**)', 'Edit(./.claude/skills/**)', 'Edit(./CLAUDE.md)', 'Edit(./brands/*/raw/**)', 'Read(/brands/**)']);

/** A kit rule that the new settings don't carry: one naming some other kit.mjs, or an old form. */
function isStaleKitRule(rule, fresh) {
  if (fresh.has(rule)) return false;
  return OLD_KIT_RULES.has(rule) || /kit\.mjs/.test(rule);
}

export function mergeSettings(existing, add) {
  const out = { ...existing, permissions: { ...(existing.permissions || {}) } };
  for (const key of ['allow', 'deny', 'ask']) {
    const fresh = new Set((add.permissions && add.permissions[key]) || []);
    const a = ((existing.permissions && existing.permissions[key]) || []).filter((r) => !isStaleKitRule(r, fresh));
    const b = (add.permissions && add.permissions[key]) || [];
    if (a.length || b.length) out.permissions[key] = [...new Set([...a, ...b])];
  }
  for (const [k, v] of Object.entries(add)) if (k !== 'permissions' && !(k in out)) out[k] = v;
  return out;
}

export async function scaffold(flags) {
  const ws = requireFlag(flags, 'workspace', '"<the folder you opened in Claude>"');
  assertNotSynced(ws, 'workspace');
  const created = [];
  for (const d of [ws, path.join(ws, '.claude'), path.join(ws, '.claude', 'skills'), path.join(ws, 'brands')]) {
    if (!isDir(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(toPosix(path.relative(ws, d) || '.'));
    }
  }
  const state = readState();
  // The Node install recorded, if it is still there; otherwise the one running now.
  const nodePath = state.node && state.node.path && exists(state.node.path) ? state.node.path : process.execPath;
  // The permission list names the stable launcher in the kit home, not this plugin folder,
  // so it keeps matching after the plugin updates.
  const launcher = ensureLauncher();
  const { settings, source } = settingsFor({ nodePath, kitScript: launcher });
  const file = path.join(ws, '.claude', 'settings.json');
  let settingsAction = 'created';
  if (exists(file)) {
    const existing = readJsonFile(file, { what: '.claude/settings.json' });
    const merged = mergeSettings(existing, settings);
    if (JSON.stringify(merged) === JSON.stringify(existing)) settingsAction = 'unchanged';
    else {
      writeJson(file, merged);
      settingsAction = 'merged';
    }
  } else writeJson(file, settings);
  recordKit();
  return { workspace: ws, created, node: toPosix(nodePath), kit: toPosix(launcher), settings: { file, action: settingsAction, source } };
}

// ---- add-brand -----------------------------------------------------------------------------

export function starterBrand(slug, name) {
  return {
    schemaVersion: 1,
    slug,
    name,
    teamSize: 1,
    colors: { primary: '#1F2A44', secondary: '#F4EDE4', accent: '#E0703A', text: '#FFFFFF', textOutline: '#000000' },
    fonts: { headline: { family: 'Montserrat', file: null }, body: { family: 'Inter', file: null } },
    logo: { onDark: null, onLight: null },
    captions: { style: 'word-highlight', position: 'lower-third', maxWordsPerLine: 4, uppercase: false, fontSizePct: 5.5 },
    reel: {
      minSeconds: 15,
      maxSeconds: 90,
      framing: 'crop-center',
      watermark: { enabled: true, corner: 'top-right', opacity: 0.9, sizePct: 18 },
      endCard: { enabled: true, seconds: 2, cta: null },
    },
    music: { defaultTrack: null, volumeDb: -18 },
  };
}

export const BRAND_DIRS = ['assets', 'assets/fonts', 'assets/music', 'examples', 'raw', 'jobs', 'exports', 'docs'];

export async function addBrand(flags) {
  const ws = requireFlag(flags, 'workspace', '"<workspace folder>"');
  const slug = (flags.slug || '').trim();
  if (!SLUG_RE.test(slug)) {
    throw new KitError('BAD_SLUG', `"${slug}" can't be used as a brand folder name.`, 'Use lowercase letters, numbers and hyphens only, like "sample-studio".');
  }
  const name = (flags.name || '').trim() || slug;
  if (!isDir(path.join(ws, 'brands'))) {
    throw new KitError('NO_WORKSPACE', "This folder hasn't been set up as a workspace yet.", 'Run scaffold on it first.');
  }
  assertNotSynced(ws, 'workspace');
  const dir = path.join(ws, 'brands', slug);
  const created = [];
  for (const d of ['', ...BRAND_DIRS]) {
    const p = path.join(dir, ...d.split('/').filter(Boolean));
    if (!isDir(p)) {
      fs.mkdirSync(p, { recursive: true });
      created.push(d || '.');
    }
  }
  const brandFile = path.join(dir, 'brand.json');
  let brandAction = 'kept';
  if (!exists(brandFile)) {
    writeJson(brandFile, starterBrand(slug, name));
    brandAction = 'created';
  }
  const lessons = path.join(dir, 'docs', 'lessons.md');
  if (!exists(lessons)) {
    fs.writeFileSync(lessons, `# What we've learned about ${name}\n\nEach time you give feedback on a video, Claude adds a line here so the next edit is better.\n`);
    created.push('docs/lessons.md');
  }
  return { brandDir: dir, slug, name, created, brandJson: { file: brandFile, action: brandAction } };
}

// ---- new-job -------------------------------------------------------------------------------

export async function newJob(flags) {
  const brandDir = requireFlag(flags, 'brand-dir', '"brands/sample-studio"');
  if (!exists(path.join(brandDir, 'brand.json'))) {
    throw new KitError('NOT_A_BRAND', `${brandDir} doesn't look like a brand folder (there's no brand.json in it).`, 'Point --brand-dir at a folder inside brands/, or add the brand first.');
  }
  const slug = (flags.slug || '').trim();
  if (!SLUG_RE.test(slug)) {
    throw new KitError('BAD_SLUG', `"${slug}" can't be used as a job name.`, 'Use a short name in lowercase letters, numbers and hyphens, like "bridal-tips".');
  }
  const date = flags.date && /^\d{4}-\d{2}-\d{2}$/.test(flags.date) ? flags.date : localDateStamp();
  const job = `${date}-${slug}`;
  const jobDir = path.join(brandDir, 'jobs', job);
  const existed = isDir(jobDir);
  for (const d of ['work', 'review']) fs.mkdirSync(path.join(jobDir, d), { recursive: true });
  // A clean moment to pick up the kit's latest fixes, before anything is rendered: at most once a
  // week, with short timeouts. It never fails the job; offline simply means no update this time.
  // The commands after this one run the new copy through the launcher.
  const updated = await autoUpdate();
  return { job, jobDir, existed, brief: path.join(jobDir, 'brief.md'), editJson: path.join(jobDir, 'edit.json'), ...(updated ? { updated } : {}) };
}

// ---- validate ------------------------------------------------------------------------------

export async function validate(flags) {
  const file = requireFlag(flags, 'file', 'brands/sample-studio/brand.json');
  const obj = readJsonFile(file);
  const kind = detectKind(obj, file);
  if (!kind) {
    throw new KitError('UNKNOWN_FILE', `I can't tell whether ${path.basename(file)} is a brand.json or an edit.json.`, 'Name the file brand.json or edit.json.');
  }
  let result;
  if (kind === 'brand') {
    const brandDir = path.dirname(file);
    result = validateBrand(obj, { brandDir: path.basename(path.dirname(brandDir)) === 'brands' ? brandDir : null });
  } else {
    const jobDir = path.dirname(file);
    const brandDir = path.dirname(path.dirname(jobDir));
    const inBrand = path.basename(path.dirname(jobDir)) === 'jobs' && exists(path.join(brandDir, 'brand.json'));
    let brand = null;
    if (inBrand) {
      try {
        brand = JSON.parse(fs.readFileSync(path.join(brandDir, 'brand.json'), 'utf8'));
      } catch {}
    }
    result = validateEdit(obj, inBrand ? { brandDir, jobDir, brand } : {});
  }
  if (result.problems.length) {
    const n = result.problems.length;
    throw new KitError(
      kind === 'brand' ? 'INVALID_BRAND_JSON' : 'INVALID_EDIT_JSON',
      `${path.basename(file)} has ${n} problem${n === 1 ? '' : 's'}: ${result.problems.join(' ')}`,
      `Fix ${n === 1 ? 'that' : 'those'} in ${file}, then check it again.`,
      { kind, problems: result.problems, warnings: result.warnings },
    );
  }
  const out = { kind, file, warnings: result.warnings };
  if (kind === 'edit') out.clipSeconds = result.clipSeconds;
  return out;
}

// ---- install-skill -------------------------------------------------------------------------

/**
 * Save a generated skill into <workspace>/.claude/skills/<name>/SKILL.md. Claude drafts the skill
 * inside the brand folder (where it may edit freely) and the kit moves it into place, because
 * Claude Code guards direct writes under .claude/ and would stop to ask, or refuse, every time.
 * Checks the draft first: frontmatter on line 1, name matches, no placeholder left. Keeps the
 * old skill as SKILL.previous.md. Removes the draft once it is saved.
 */
export async function installSkill(flags) {
  const ws = requireFlag(flags, 'workspace', '"<the folder you opened in Claude>"');
  const from = requireFlag(flags, 'from', '"brands/sample-studio/docs/sample-studio-reel.SKILL.md"');
  const name = String(flags.name || '').trim();
  if (!SLUG_RE.test(name)) {
    throw new KitError('BAD_SKILL_NAME', `"${name}" can't be used as a skill name.`, 'Use lowercase letters, numbers and hyphens, like "sample-studio-reel".');
  }
  if (!isDir(path.join(ws, 'brands'))) {
    throw new KitError('NO_WORKSPACE', "This folder hasn't been set up as a workspace yet.", 'Run scaffold on it first.');
  }
  let text;
  try {
    text = fs.readFileSync(from, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    throw new KitError('FILE_NOT_FOUND', `I couldn't find the skill draft at ${from}.`, 'Write the draft first, then run this again.');
  }
  const problems = [];
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!fm) problems.push('It has to start with a --- line, then name: and description:, then another --- line.');
  else {
    const n = /^name:\s*(.+?)\s*$/m.exec(fm[1]);
    if (!n || n[1].replace(/^["']|["']$/g, '') !== name) problems.push(`Its name: line should say ${name}.`);
    if (!/^description:\s*\S/m.test(fm[1])) problems.push('It needs a description: line.');
  }
  const left = [...new Set((text.match(/\{\{[A-Z_]+\}\}/g) || []))];
  if (left.length) problems.push(`These placeholders were never filled in: ${left.join(', ')}.`);
  if (problems.length) {
    throw new KitError('BAD_SKILL', `The skill draft isn't ready to save: ${problems.join(' ')}`, `Fix ${from}, then run install-skill again.`, { problems });
  }
  const dir = path.join(ws, '.claude', 'skills', name);
  const dest = path.join(dir, 'SKILL.md');
  fs.mkdirSync(dir, { recursive: true });
  let action = 'created';
  let previous = null;
  if (exists(dest)) {
    const old = fs.readFileSync(dest, 'utf8');
    if (old === text) action = 'unchanged';
    else {
      previous = path.join(dir, 'SKILL.previous.md');
      fs.writeFileSync(previous, old);
      action = 'updated';
    }
  }
  if (action !== 'unchanged') writeFileAtomic(dest, text);
  if (path.resolve(from) !== path.resolve(dest)) fs.rmSync(from, { force: true });
  return { skill: dest, name, action, previous };
}
