# Contracts (v1)

_Set 2026-11-17; reconciled with the build on 2026-11-17 (integration); self-update added 2026-11-17. These are the fixed interfaces between the setup skill, the pipeline scripts, the render project and the generated client skills. If code needs something different, change this file in the same change._

## 1. Places on the client machine

### Kit home: `~/.content-kit/` (`%USERPROFILE%\.content-kit` on Windows)

Machine-level, shared by every workspace, never inside a cloud-synced folder.

```
~/.content-kit/
  kit.mjs                the launcher: a copy of plugin/scripts/launcher.mjs (see below)
  tools/node/            portable Node 26.13.1 (section 6)
    bin/node             macOS and Linux
    node.exe             Windows (always the x64 build)
  tools/stt/             speech to text (no compiler; see section 4)
    lib/                 package.json + node_modules: sherpa-onnx-node 2.0.1 (prebuilt addon), seek-bzip 2.0.0
    models/<model id>/   encoder.int8.onnx, decoder.int8.onnx, joiner.int8.onnx, tokens.txt
  render/                copy of plugin/render with its node_modules and Remotion's headless Chrome
  kit/                   self-updated copies of the kit (see "Self-update" below)
    <x.y.z>/             laid out like plugin/: .claude-plugin/plugin.json, scripts/, render/ (source
                         only, no node_modules), recipes/, templates/, and .kit-ok (written last, once
                         the copy passed its checks); a .bad file put there by hand makes the launcher skip it
    .tmp-*, .old-*       an unpack or a replacement in progress; removed when finished or after an hour
  state.json             what is installed, where, and the last doctor result
```

Resolve it with `os.homedir()`. The environment variable `CONTENT_KIT_HOME` overrides it (tests use this).

**The launcher.** `install` and `scaffold` copy `plugin/scripts/launcher.mjs` to `<kit home>/kit.mjs`, and every kit run puts it back if it's missing or different. It runs the newest usable `kit.mjs` it can find, with the same arguments. Candidates: the self-updated copies in `<kit home>/kit/<x.y.z>/`; the one recorded in `state.json` (`kit.path`); and any installed copy in Claude's plugin cache that isn't marked `.orphaned_at`. The highest version wins; on a tie a self-updated copy wins, then the recorded one. A self-updated copy is usable only if it passes a quick self-check: its folder name is `x.y.z`, its `plugin.json` says the same version, `scripts/kit.mjs` and `scripts/lib/common.mjs` exist, `.kit-ok` exists and `.bad` doesn't. A copy that fails, or whose `kit.mjs` won't load, is skipped and the next one runs (that is the rollback). If it finds none it prints the usual failure object with code `KIT_NOT_FOUND`. The launcher's second line is `// launcher-generation: N`; a kit never replaces a launcher of a later generation with an earlier one, so an older copy can't take the self-update path away. The workspace permission list and every generated skill call the launcher, never a path inside the plugin folder, because the plugin folder's path carries its version and changes on update.

**`state.json`** (written atomically; every top-level key is optional until its tool is installed):

| Key | Fields |
| --- | --- |
| `schemaVersion`, `kitHome`, `updatedAt` | always present |
| `kit` | the kit in use, refreshed by every kit run: `path` (its `kit.mjs`), `pluginDir` (its folder), `version`, `source` (`plugin` or `self-update`), `launcher` |
| `update` | `lastCheckAt` (ISO time of the last release check, automatic or not), `lastResult` (`updated`, `reinstalled`, `up-to-date`, `no-release`, `held-back`, `available`, `offline`, `bad-download`, `bad-release`, or `checking` while one runs), `latest` (the latest release's version, or null), `detail` (why the last check failed, if it did), `lastUpdate` (`from`, `to`, `at`, `kitDir`) |
| `node` | `path`, `version`, `portable` (true when it is the kit's own copy), `pinned` |
| `render` | `dir`, `sourceHash`, `lockHash`, `remotionVersion`, `installedAt` |
| `stt` | `engine` (`sherpa-onnx`), `sherpaOnnxNode`, `lib`, `model`, `modelDir`, `installedAt` (a `whisper` key from kit 0.1.0 is removed by `install`) |
| `lastDoctor` | `at`, `ready`, `checks` (check id → `ok` / `missing` / `broken`) |

Generated skills read `node.path` and `kit.launcher` from here to recover if a path stops working.

### Self-update

The desktop app can't update a third-party plugin from its plugin screen, and clients never open a terminal, so the kit fetches fixes to its working parts itself.

- **Where from.** The public repo named in `RELEASES.repo` (`plugin/scripts/lib/common.mjs`), `https://github.com/BzIsBad/content-kit`. The latest release is found by following `<repo>/releases/latest`, which redirects to `<repo>/releases/tag/<tag>` (no API call, so no rate limit; a redirect to `<repo>/releases` means nothing is published). The archive is `<repo>/archive/refs/tags/<tag>.tar.gz`. Https only, at every redirect.
- **What is accepted.** Only a tag of the form `vMAJOR.MINOR.PATCH` (no pre-release suffix), never a branch, and only when its version is newer than the newest usable kit already on the computer (`--force` reinstalls the latest even when it isn't). A version rolled back on this computer (its folder has `.bad`) is held back (`held-back`) until a newer release appears or `--force` is given. The archive is unpacked with Node alone (zlib and a small tar reader). The whole archive is refused if any entry is a link, a special file, an absolute path, a drive letter, a backslash or a `..`, or if it has more than one top folder. Only `plugin/.claude-plugin/plugin.json`, `plugin/scripts/`, `plugin/render/` (no `node_modules`), `plugin/recipes/` and `plugin/templates/` are written. Skills are not: they change only with the plugin.
- **Checks before it counts.** It unpacks into `<kit home>/kit/.tmp-*`, then checks that `plugin.json`'s version equals the tag's, that `scripts/kit.mjs` exists, that `kit.mjs help` answers in a separate Node, and that every module in `scripts/lib/` loads. Then it writes `.kit-ok` and renames the folder to `<kit home>/kit/<x.y.z>/`. Anything that fails leaves the kit exactly as it was.
- **Keeping versions.** The newest two usable copies are kept (the newest and the one before it, for rollback), plus whichever copy is running; older ones are removed.
- **When.** `update` runs it on demand (the doctor skill does, so "check my video setup" fetches the latest). `new-job` runs it automatically at most once every 7 days (`RELEASES.checkEveryDays`), measured from `update.lastCheckAt`, or after 1 day (`RELEASES.retryAfterDays`) when the last check didn't get an answer (offline, unreachable, cut off), with short timeouts (5 s to find the release, 30 s to download it). It never fails or blocks the job: offline, an unreachable GitHub or a bad release just means no update this time. The commands after `new-job` run the new copy through the launcher, and `render` and `smoke-test` refresh the installed renderer from the new copy's `render/` before their next render (npm runs only if its lockfile changed).
- **Environment.** `CONTENT_KIT_NO_UPDATE=1` turns the automatic check off (and `doctor`'s look-up). `CONTENT_KIT_RELEASE_URL` replaces the repo URL; it is for tests, and with it plain `http` is allowed to this computer (`127.0.0.1`, `localhost`) only.
- **The release rule.** Every published version is a git tag `vX.Y.Z` on the commit it describes, with a GitHub release (not a draft or pre-release) for that tag, and `plugin/.claude-plugin/plugin.json` on that commit carries the same `X.Y.Z`. A release must keep every `kit.mjs` command and flag in section 5 working for skills generated by earlier versions, and must not need a newer pinned Node than the one on the computer unless `doctor` and `install` handle it.

### Workspace: one folder the client opens in the Code tab

On a local disk. Not in Drive, Dropbox, iCloud or OneDrive (raw footage is large and synced `work/` folders break renders). Setup checks this and says so.

```
<workspace>/
  CLAUDE.md                       generated, plain language, how this workspace works
  .claude/settings.json           generated permission allowlist
  .claude/skills/<brand>-reel/    generated, one per brand per recipe
  brands/
    <brand-slug>/
      brand-guide.md              the nine-section guide, for people and for Claude
      brand.json                  the machine-readable part (section 2)
      assets/                     logos
        fonts/                    font files
        music/                    music the brand has the right to use
      examples/                   posts they like, posts that are "not us", with notes
      raw/                        drop zone; files here are never modified or deleted
      jobs/<YYYY-MM-DD>-<slug>/   one per request
        brief.md                  what was asked, in their words
        edit.json                 the edit decision (section 3)
        work/                     everything here is safe to delete
          <id>.probe.json         what ingest learned about source <id>
          <id>.proxy.mp4          small preview copy (640 px long side, a keyframe every second)
          <id>.wav                16 kHz mono sound for transcription
          <id>.transcript.json/.txt   section 4
          frames/                 contact sheets and their .json index
          cuts/                   render copies of the chosen clips (section 5, render)
          render-media.json       which render copy plays for which clip
          render-v<N>[-draft].json   inputs hash, so an unchanged edit isn't rendered twice
          <job>-v<N>-draft.mp4    draft renders (never in exports/)
        review/v<N>[-draft]/      frames pulled from a render, frames.json, and notes.md
      exports/                    finished videos: <job>-v<N>.mp4, and test-clip.mp4 from smoke-test
      docs/lessons.md             what feedback taught us, appended over time
```

`<brand-slug>` is lowercase letters, digits and hyphens.

## 2. `brand.json`

```json
{
  "schemaVersion": 1,
  "slug": "sample-studio",
  "name": "Sample Studio",
  "teamSize": 2,
  "colors": {
    "primary": "#1F2A44",
    "secondary": "#F4EDE4",
    "accent": "#E0703A",
    "text": "#FFFFFF",
    "textOutline": "#000000"
  },
  "fonts": {
    "headline": { "family": "Montserrat", "file": "assets/fonts/Montserrat-Bold.ttf" },
    "body": { "family": "Inter", "file": null }
  },
  "logo": { "onDark": "assets/logo-light.png", "onLight": "assets/logo-dark.png" },
  "captions": {
    "style": "word-highlight",
    "position": "lower-third",
    "maxWordsPerLine": 4,
    "uppercase": false,
    "fontSizePct": 5.5
  },
  "reel": {
    "minSeconds": 15,
    "maxSeconds": 90,
    "framing": "crop-center",
    "watermark": { "enabled": true, "corner": "top-right", "opacity": 0.9, "sizePct": 18 },
    "endCard": { "enabled": true, "seconds": 2, "cta": "Book at samplestudio.example" }
  },
  "music": { "defaultTrack": null, "volumeDb": -18 }
}
```

- `logo.onDark`, `logo.onLight` and `reel.endCard.cta` may be `null` (and `add-brand`'s starter file uses `null`). `fonts.*.file` and `music.defaultTrack` may be `null`.
- The starter file from `add-brand` has `reel.minSeconds: 15`, `reel.maxSeconds: 90`; the interview narrows them. A reel is always 15 to 90 seconds, end card included.
- Paths are relative to the brand folder, always with forward slashes.
- `captions.style`: `word-highlight` | `phrase` | `none`. `captions.position`: `lower-third` | `center`.
- `reel.framing`: `crop-center` (fill the frame, crop the sides) | `blur-fit` (whole frame over a blurred copy).
- `fonts.*.file: null` means use a bundled fallback font. A missing logo means no watermark and a text-only end card. A render never fails because an optional asset is absent.
- `fontSizePct` is a percentage of frame height. `reel.watermark.sizePct` (optional, 8 to 35, default 18) is the corner logo's width as a percentage of frame width; it is also capped so the logo is never taller than 90% of that width.
- `teamSize` of 3 or more makes `validate` add the licence note once (the video tool is free for small teams; the client may need their own licence later depending on use; non-profits are free). It is a note, never a failure, and renders never repeat it.
- Text and captions stay inside a centred safe area that leaves 12 percent clear on the left and on the right, 8 percent at the top and 20 percent at the bottom (this clears the app buttons on Instagram and TikTok and keeps captions centred). Captions are centred on the frame and wrap within the safe width; the watermark logo may sit in a top corner outside it.

## 3. `edit.json`

```json
{
  "schemaVersion": 1,
  "brand": "sample-studio",
  "job": "2026-11-17-bridal-tips",
  "version": 1,
  "sources": [{ "id": "A", "file": "raw/bridal-session.mp4" }],
  "output": { "width": 1080, "height": 1920, "fps": 30 },
  "hookTitle": { "text": "3 mistakes with bridal makeup", "seconds": 2.5 },
  "segments": [
    { "source": "A", "in": 123.45, "out": 131.2, "note": "strong opening line", "cropX": 0.5 }
  ],
  "captions": { "enabled": true, "corrections": [{ "from": "arco", "to": "R.CO" }] },
  "overlays": [
    { "type": "text", "text": "Step 1: prep", "at": 3.0, "seconds": 2.5, "position": "top" }
  ],
  "music": { "file": null, "volumeDb": -18 },
  "endCard": true
}
```

- `in` / `out` are seconds in the **source** file. `overlays[].at` is seconds in the **output**.
- Segments play in array order. `cropX` (0–1) is the horizontal centre of the crop for `crop-center`; default 0.5.
- `hookTitle` may be `null`. `overlays[].type`: `text` | `image` (then `file`, relative to the brand folder). `position`: `top` | `center` | `bottom`.
- `endCard`: `true` (the brand's end card), `false` (none), or `{ "seconds": 3, "cta": "..." }` to change it for this video (`enabled` may be given and defaults to `true`; `seconds` is above 0 and at most 10; `cta` may be `null`).
- `music`: `false` means no music in this video. An object `{ "file": ..., "volumeDb": ... }` sets it; `file: null` (or no `file`) means the brand's `music.defaultTrack`.
- Anything omitted falls back to `brand.json`.
- The output file is always `exports/<job>-v<version>.mp4`. A refinement bumps `version`; earlier versions are kept. A draft goes to `jobs/<job>/work/<job>-v<version>-draft.mp4`, never to `exports/`.

## 4. Transcript

`jobs/<job>/work/<source-id>.transcript.json`:

```json
{
  "source": "raw/bridal-session.mp4",
  "durationSec": 2143.2,
  "language": "en",
  "words": [{ "t0": 12.34, "t1": 12.61, "text": "Hello" }],
  "segments": [{ "t0": 12.34, "t1": 17.9, "text": "Hello and welcome back." }]
}
```

Alongside it, `<source-id>.transcript.txt` for Claude to read: one line per segment, `[mm:ss.s] text`.

How it's made: `transcribe` runs sherpa-onnx (`sherpa-onnx-node` 2.0.1, a prebuilt npm addon for macOS arm64/x64, Windows x64 and Linux; no compiler, no Visual C++ runtime) with NVIDIA's Parakeet TDT 110M English model, int8 (`sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8`, CC-BY-4.0), on the 16 kHz WAV, cut into 15 to 28 s pieces at the quietest moment. Words come out cased and punctuated; times are rounded to 0.01 s, in order, never overlapping. `language` is `en` (English only in v1). Segments break at sentence ends, pauses of 1 s or more, and long runs. Replaced whisper.cpp on 2026-11-17 (see the dated finding).

## 5. `kit.mjs`

One entry point: `node <plugin>/scripts/kit.mjs <command> [flags]`.

- **stdout** is exactly one JSON object. Progress goes to stderr.
- Success: `{ "ok": true, ... }`, exit 0.
- Failure: `{ "ok": false, "code": "SNAKE_CASE", "message": "<plain words a client can read>", "fix": "<what to do next>" }`, exit 1.
- Every command is safe to run twice.

| Command | Does | Flags |
| --- | --- | --- |
| `doctor` | Checks OS, architecture, disk space, kit home, Node, speech-to-text, render project (and the workspace, if given); reports each as ok / missing / broken | `--workspace` (optional) |
| `install` | Installs or repairs whatever `doctor` reports missing, then runs the render project's `prepare` step (bundle and headless Chrome download) so the first render doesn't download | `--only node\|render\|transcribe`, `--force` |
| `scaffold` | Creates the workspace skeleton, puts the launcher in the kit home, and writes or merges `.claude/settings.json` | `--workspace` |
| `add-brand` | Creates one brand folder tree with a starter `brand.json` and `docs/lessons.md` | `--workspace`, `--slug`, `--name` |
| `validate` | Checks a `brand.json` or `edit.json` against the contract | `--file` |
| `new-job` | Creates a job folder (`work/`, `review/`) named with today's local date | `--brand-dir`, `--slug`, `--date YYYY-MM-DD` (tests) |
| `ingest` | Probes a source, writes the probe, a small proxy and a 16 kHz mono WAV into `work/` | `--job-dir`, `--source`, `--id`, `--force` |
| `transcribe` | Writes the transcript files (section 4) | `--job-dir`, `--id`, `--force` |
| `frames` | Writes contact sheets (grids of timestamped frames) for a source or time range | `--job-dir`, `--id`, `--from`, `--to`, `--every`, `--force` |
| `render` | Makes render copies of the chosen clips, then renders `edit.json`: the final to `exports/<job>-v<N>.mp4`, a draft to `work/<job>-v<N>-draft.mp4` | `--job-dir`, `--draft` (half size, fast), `--force` |
| `review-frames` | Pulls frames from a render at the start, each cut, each long clip's middle, each overlay and the end card into `review/v<N>[-draft]/` | `--job-dir`, `--version`, `--draft` |
| `smoke-test` | Renders a 5-second branded test clip from a generated test pattern to `<brand>/exports/test-clip.mp4` | `--brand-dir` |
| `update` | Looks up the latest published release and, if it's newer than the newest kit on this computer, downloads, checks and installs it into `<kit home>/kit/<x.y.z>/` (section 1, "Self-update"). Safe offline: it fails plainly and changes nothing | `--check` (only look), `--force` (reinstall the latest release even if it isn't newer) |
| `install-skill` | Checks a generated skill draft (frontmatter on line 1, `name:` equal to `--name`, no `{{PLACEHOLDER}}` left) and saves it as `.claude/skills/<name>/SKILL.md`, keeping an older one as `SKILL.previous.md`; removes the draft. Claude drafts skills inside the brand folder and saves them with this, because Claude Code guards direct writes under `.claude/` | `--workspace`, `--from`, `--name` |

Main success fields (every success also has `ok: true` and `command`):

| Command | Fields |
| --- | --- |
| `doctor` | `ready`, `summary`, `kitHome`, `system`, `kit: { version, source, path, latest, updateAvailable, checked, lastCheckAt, lastResult, newerInstalled? }` (never a failure; `checked` is false when offline or turned off), `checks[]` of `{ id, label, status, detail, fix? }` |
| `install` | `installed` (per tool: `action` = `installed` / `already-installed` / `recorded`), `ready`, `summary`, `checks[]` |
| `scaffold` | `workspace`, `created[]`, `node`, `kit` (the launcher), `settings: { file, action: created / merged / unchanged, source }` |
| `add-brand` | `brandDir`, `slug`, `name`, `created[]`, `brandJson: { file, action: created / kept }` |
| `validate` | `kind` (`brand` / `edit`), `file`, `warnings[]`; for an edit also `clipSeconds` |
| `new-job` | `job`, `jobDir`, `existed`, `brief`, `editJson`, and `updated: { from, to, recipesChanged[] }` only when the automatic check just installed a newer kit (`recipesChanged` lists recipes whose `skill.template.md` changed, so their generated skills can be refreshed) |
| `update` | `action` (`updated`, `reinstalled`, `up-to-date`, `no-release`, `held-back`, or with `--check` `available` / `up-to-date` / `no-release`), `current`, `latest`, `source`; when it installed: `from`, `to`, `kitDir`, `recipesChanged[]`, `pruned[]`. Failures: `UPDATE_OFFLINE`, `UPDATE_DOWNLOAD_BAD`, `UPDATE_RELEASE_BAD`, each with a `detail` |
| `ingest` | `id`, `skipped`, `source`, `durationSec`, `video`, `audio`, `probe`, `proxy`, `wav`, `warning?` |
| `transcribe` | `id`, `skipped`, `json`, `txt`, `words`, `segments`, `durationSec`, `warning?` |
| `frames` | `id`, `from`, `to`, `every`, `frameCount`, `sheets[]` of `{ file, frames[] }`, `index` |
| `render` | `out`, `version`, `draft`, `skipped`, `durationSec`, `width`, `height`, `fps`, `clipCopies: { made, reused }`, `warnings[]` |
| `review-frames` | `version`, `draft`, `video`, `durationSec`, `dir`, `frames[]` of `{ t, kind, note, file }`, `checks[]` |
| `smoke-test` | `out`, `durationSec`, `warnings[]` |
| `install-skill` | `skill`, `name`, `action` (`created` / `updated` / `unchanged`), `previous` |

`warnings` are plain sentences about things left out or adjusted; each one is said once, in the renderer's words.

**Render copies.** Before rendering, `render` copies each clip (plus up to 1 s either side) out of the raw footage with the render project's bundled ffmpeg into `work/cuts/`: H.264 with each frame's original timing kept (frames with a repeated timestamp are dropped; no frame-rate conversion, which put 60 fps footage out of sync with its sound in testing), rotation applied, scaled down to no more than the output needs. The renderer plays those instead of the raw file, so HEVC, 4K, rotated and very large phone files never reach its browser-based decoder. Copies are reused until the clip, the footage or the output size changes, and copies no clip uses are removed. `render` passes the list to the render project as `--media work/render-media.json`: `{ schemaVersion: 1, sources: { <id>: { durationSec } }, segments: [ { index, source, file, offsetSec } ] }`, where `offsetSec` is the source time at the start of the copy.

Portable Node is the one thing `kit.mjs` cannot install for itself. The setup skill bootstraps Node first (section 6), then calls `kit.mjs`.

## 6. Node bootstrap

The kit runs on **Node 26.13.1**, pinned in `PINS.node` (`plugin/scripts/lib/common.mjs`). Before any script runs, the setup skill has Claude check for the kit's own Node and, if it's missing or another version, download the pinned official build from nodejs.org into `~/.content-kit/tools/node/` using tools already on the machine, check it against `SHASUMS256.txt`, and unpack it with `--strip-components 1`:

- macOS: `curl`, `shasum` and `tar`; arm64 or x64 chosen with `sysctl -n hw.optional.arm64` (right even under Rosetta). Node is then `tools/node/bin/node`.
- Windows 10/11: `curl.exe` and the built-in `tar.exe`; **always the x64 build** (`node-v26.13.1-win-x64.zip`), because Remotion ships only for Windows x64. Windows 11 on ARM runs it under emulation; Windows 10 on ARM is not supported. Node is then `tools/node/node.exe`.
- Linux (testing only): as macOS, `tools/node/bin/node`.

No installer, no admin prompt, no PATH change. Later calls use the full path to that Node. `install` records it in `state.json` (`node`).

The commands are written down once, in `plugin/skills/setup/references/machine-check.md`, section 3. A unit test checks that file names the same version as `PINS.node`.

## 7. Recipes

A recipe is one kind of output. It owns a skill template, any extra `kit.mjs` commands and a render composition.

```
plugin/recipes/<recipe-id>/
  recipe.json            what the recipe is, what it needs, what setup asks, how its skill is filled
  skill.template.md      becomes .claude/skills/<brand>-<recipe-id>/SKILL.md
```

`recipe.json`:

| Field | Meaning |
| --- | --- |
| `recipeSchemaVersion` | `1` |
| `id`, `title`, `description` | short id (folder name), a plain title, one plain sentence |
| `enabledByDefault` | setup generates its skill for every brand when `true` |
| `requiredTools` | `doctor` check ids that must be `ok` for the recipe to be usable: `node`, `transcribe`, `render` |
| `kitCommands` | the `kit.mjs` commands its skill calls |
| `skill` | `{ template, name }`; `name` may use `{{BRAND_SLUG}}` |
| `questions[]` | extra setup questions: `id`, `section` (brand guide section), `ask`, `why`, `goodEnough`, `clarifyIf`, `mapsTo[]` (`brand.json` fields), `rule`, `default` (field → value) |
| `placeholders[]` | every `{{NAME}}` in the template: `name`, `kind` (`value`: copied exactly; `distilled`: written from the guide), `from`, and for distilled ones `write` (how to write it) |

`doctor` check ids are `system` (also checks macOS is 15 or newer), `diskKit`, `workspace`, `diskWorkspace`, `kitHome`, `node`, `transcribe` and `render`. A new tool adds a check id and recipes name it in `requiredTools`. These are also the names `install --only` takes (for `node`, `render`, `transcribe`).

v1 has one: `reel` (long recording → 15–90 s vertical reel). Setup generates one skill per brand per enabled recipe. Adding voiceover or generated b-roll later means adding a recipe or a tool, not editing `reel`.

## 8. Generated skill behaviour (`<brand>-reel`)

Invoked with a brief in plain words. It:

1. Finds new files in `raw/`, creates the job, saves the brief.
2. Ingests and transcribes; pulls contact sheets where the footage has little speech.
3. Chooses moments against the brand guide and `docs/lessons.md`, and writes `edit.json`.
4. Renders a draft (to `work/`), pulls review frames with `--draft`, looks at them, and fixes what it sees (caption overflow, bad crop, wrong colour, cut mid-word).
5. Renders the final and tells the client where it is, what it chose and why, in a few plain sentences.
6. On feedback, bumps the version, re-renders, and appends what it learned to `docs/lessons.md`.

It stops and asks only when the brief is ambiguous in a way that changes the edit, or when a person on camera or a claim needs the client's sign-off under the brand guide's "never do" and "who approves" sections.
