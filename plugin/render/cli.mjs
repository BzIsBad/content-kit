#!/usr/bin/env node
// Entry point of the render project.
//   node cli.mjs render --brand-dir <dir> --job-dir <dir> --out <file.mp4> [--media <render-media.json>] [--draft]
//   node cli.mjs smoke  --brand-dir <dir> --out <file.mp4> [--draft]
//   node cli.mjs prepare
// stdout carries exactly one JSON object; progress goes to stderr. Exit code 0 or 1.
import { KitError } from './lib/errors.mjs';

// Anything that tries to print to stdout while we work goes to stderr instead,
// so the single JSON line at the end is the only thing on stdout.
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);
console.log = (...a) => process.stderr.write(`${a.join(' ')}\n`);
console.info = console.log;

function finish(obj) {
  const code = obj.ok ? 0 : 1;
  realWrite(`${JSON.stringify(obj)}\n`, () => process.exit(code));
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  const valued = new Set(['brand-dir', 'job-dir', 'out', 'media']);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new KitError('BAD_ARGS', `I did not understand "${a}".`, 'Use the flags shown in README.md.');
    const eq = a.indexOf('=');
    const name = a.slice(2, eq === -1 ? undefined : eq);
    if (name === 'draft') { flags.draft = true; continue; }
    if (!valued.has(name)) throw new KitError('BAD_ARGS', `I do not know the option --${name}.`, 'Use the flags shown in README.md.');
    const val = eq !== -1 ? a.slice(eq + 1) : rest[++i];
    if (val == null || val.startsWith('--')) throw new KitError('BAD_ARGS', `The option --${name} needs a value.`, 'Add the value after it.');
    flags[name] = val;
  }
  return { cmd, flags };
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  const lib = () => import('./lib/render.mjs');
  if (cmd === 'render') return (await lib()).renderReel({ brandDir: flags['brand-dir'], jobDir: flags['job-dir'], out: flags.out, media: flags.media, draft: flags.draft });
  if (cmd === 'smoke') return (await lib()).renderSmoke({ brandDir: flags['brand-dir'], out: flags.out, draft: flags.draft });
  if (cmd === 'prepare') return (await lib()).prepare();
  throw new KitError('BAD_ARGS', 'I need to be told what to do: render, smoke or prepare.', 'Run it like: node cli.mjs render --brand-dir <dir> --job-dir <dir> --out <file.mp4>');
}

main().then(finish, (e) => {
  if (e instanceof KitError) return finish({ ok: false, code: e.code, message: e.message, fix: e.fix });
  process.stderr.write(`${e?.stack || e}\n`);
  finish({ ok: false, code: 'UNEXPECTED', message: 'Something unexpected stopped the video from being made.', fix: 'Try again. If it happens twice, ask Claude to look at the details above.' });
});
