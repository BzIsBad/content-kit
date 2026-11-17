#!/usr/bin/env node
// content kit: one entry point for every pipeline step (contracts §5).
//   node <plugin>/scripts/kit.mjs <command> [flags]
// stdout carries exactly one JSON object. Progress goes to stderr. Exit 0 on success, 1 on failure.
// Only node: built-ins are imported here, so it runs on a bare Node before anything is installed.

import { parseArgs } from 'node:util';

// Anything that writes to stdout while we work (including libraries we load) goes to stderr,
// so the final JSON object is the only thing on stdout.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);

const COMMANDS = {
  doctor: { options: { workspace: 'string' }, load: async () => (await import('./lib/cmd-install.mjs')).doctor },
  install: { options: { only: 'string', force: 'boolean' }, load: async () => (await import('./lib/cmd-install.mjs')).install },
  scaffold: { options: { workspace: 'string' }, load: async () => (await import('./lib/cmd-setup.mjs')).scaffold },
  'add-brand': { options: { workspace: 'string', slug: 'string', name: 'string' }, load: async () => (await import('./lib/cmd-setup.mjs')).addBrand },
  validate: { options: { file: 'string' }, load: async () => (await import('./lib/cmd-setup.mjs')).validate },
  'new-job': { options: { 'brand-dir': 'string', slug: 'string', date: 'string' }, load: async () => (await import('./lib/cmd-setup.mjs')).newJob },
  ingest: { options: { 'job-dir': 'string', source: 'string', id: 'string', force: 'boolean' }, load: async () => (await import('./lib/cmd-media.mjs')).ingest },
  transcribe: { options: { 'job-dir': 'string', id: 'string', force: 'boolean' }, load: async () => (await import('./lib/cmd-media.mjs')).transcribe },
  frames: { options: { 'job-dir': 'string', id: 'string', from: 'string', to: 'string', every: 'string', force: 'boolean' }, load: async () => (await import('./lib/cmd-media.mjs')).frames },
  render: { options: { 'job-dir': 'string', draft: 'boolean', force: 'boolean' }, load: async () => (await import('./lib/cmd-render.mjs')).render },
  'review-frames': { options: { 'job-dir': 'string', version: 'string', draft: 'boolean' }, load: async () => (await import('./lib/cmd-media.mjs')).reviewFrames },
  'smoke-test': { options: { 'brand-dir': 'string' }, load: async () => (await import('./lib/cmd-render.mjs')).smokeTest },
  update: { options: { check: 'boolean', force: 'boolean' }, load: async () => (await import('./lib/update.mjs')).update },
  'install-skill': { options: { workspace: 'string', from: 'string', name: 'string' }, load: async () => (await import('./lib/cmd-setup.mjs')).installSkill },
};

let finished = false;
function finish(obj) {
  if (finished) return;
  finished = true;
  const code = obj.ok ? 0 : 1;
  realStdoutWrite(JSON.stringify(obj) + '\n', () => process.exit(code));
}

function fail(code, message, fix, extra = {}) {
  finish({ ok: false, code, message, fix, ...extra });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    return finish({ ok: true, commands: Object.keys(COMMANDS), usage: 'node kit.mjs <command> [--flag value ...]' });
  }
  const spec = COMMANDS[command];
  if (!spec) {
    return fail('UNKNOWN_COMMAND', `"${command}" isn't something the kit knows how to do.`, `Use one of: ${Object.keys(COMMANDS).join(', ')}.`);
  }
  let values;
  try {
    const options = Object.fromEntries(Object.entries(spec.options).map(([k, type]) => [k, { type }]));
    ({ values } = parseArgs({ args: rest, options, strict: true, allowPositionals: false }));
  } catch (e) {
    return fail('BAD_FLAGS', `I didn't understand the options given to ${command} (${e.message}).`, `${command} takes: ${Object.keys(spec.options).map((o) => `--${o}`).join(' ') || 'no options'}.`);
  }
  const { KitError, recordKit } = await import('./lib/common.mjs');
  recordKit();
  try {
    const fn = await spec.load();
    const result = await fn(values);
    finish({ ok: true, command, ...result });
  } catch (e) {
    if (e instanceof KitError) return fail(e.code, e.message, e.fix, e.extra);
    process.stderr.write(`${(e && e.stack) || e}\n`);
    fail(
      'UNEXPECTED_ERROR',
      "Something went wrong that the kit didn't expect.",
      'Try once more. If it happens again, run doctor and share this message with whoever helps you with the kit.',
      { detail: String((e && e.message) || e).slice(0, 1500) },
    );
  }
}

process.on('unhandledRejection', (e) => {
  process.stderr.write(`${(e && e.stack) || e}\n`);
  fail('UNEXPECTED_ERROR', "Something went wrong that the kit didn't expect.", 'Try once more. If it happens again, run doctor.', { detail: String((e && e.message) || e) });
});

main();
