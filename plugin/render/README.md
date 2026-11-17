# Render project

A self-contained [Remotion](https://www.remotion.dev) project (pinned 4.0.544, lockfile included). The kit copies this folder to `~/.content-kit/render/`, runs `npm ci` there, then drives it only with `brand.json` and `edit.json` (contracts sections 2, 3 and 4).

## Requirements

- **Node 20 or newer** (built and tested on Node 26.8.2 / npm 11, Linux x64). Use the portable Node from the kit home.
- **Platforms Remotion supports:** macOS (arm64 and x64), Windows **x64**, Linux x64/arm64. Windows on ARM is not supported by Remotion's renderer.
- **Install:** `npm ci` inside this folder (about 730 MB with `node_modules`). npm may print a notice that esbuild's install script was not approved. It is harmless; rendering works without it.
- **Online once:** the first render downloads Remotion's own headless Chrome (about 100 MB) into `node_modules/.remotion`. Run `node cli.mjs prepare` during setup to do it ahead of time.
- **Nothing else:** no system ffmpeg, no browser, no fonts. Remotion's bundled ffmpeg does the encoding. A bundled font (Inter, SIL OFL, `public/fonts/`) is the fallback.
- **Linux only:** Chrome needs the usual shared libraries (`libnss3`, `libatk`, ...). Not an issue on macOS or Windows.
- **Licence:** Remotion is free for teams of up to three, and the kit counts the person who set it up too. A render uses the key in env `REMOTION_LICENSE_KEY` when that is set, `free-license` when `brand.json` `teamSize` is 1 or 2, and no key otherwise. It never stops or warns about it; the setup interview tells the owner once.

## Entry point

```
node cli.mjs render --brand-dir <dir> --job-dir <dir> --out <file.mp4> [--media <render-media.json>] [--draft]
node cli.mjs smoke  --brand-dir <dir> --out <file.mp4> [--draft]
node cli.mjs prepare
```

- `--brand-dir`: the brand folder (holds `brand.json`, `assets/`, `raw/`). Every relative path in `brand.json` and `edit.json` resolves from here and must stay inside it.
- `--job-dir`: the job folder (holds `edit.json` and `work/<id>.transcript.json`).
- `--out`: absolute or relative path ending in `.mp4`. Written through a temporary file, then renamed, so a failed render never leaves a half file. Parent folders are created. An existing file is replaced.
- `--draft`: half resolution (540x960), fast encode, lower quality. Layout is identical to the final.
- `--media`: the kit's list of render copies (`work/render-media.json`, contract section 5). Clip *n* plays its copy from `offsetSec` instead of the raw file, and the listed durations are used without opening the raw file. Without it, the raw footage plays directly.

### Output

stdout is exactly **one JSON object**; progress is plain text on stderr. Exit code 0 on success, 1 on failure.

Success:

```json
{"ok":true,"file":"/abs/path/out.mp4","durationSec":10,"width":1080,"height":1920,"fps":30,"draft":false,"segments":2,"captionWords":18,"captionPages":6,"warnings":["The music file (assets/nope.mp3) is not there, so the video has no music."]}
```

`width`/`height` are the real output size (halved in draft). `warnings` is always an array of plain sentences; empty when nothing fell back. `prepare` returns `{"ok":true,"ready":true}`.

Failure:

```json
{"ok":false,"code":"SOURCE_MISSING","message":"I can not find the footage \"raw/gone.mp4\".","fix":"Check that the file is still in the brand's raw folder with the same name."}
```

Codes: `BAD_ARGS`, `BRAND_NOT_FOUND`, `BRAND_INVALID`, `JOB_NOT_FOUND`, `EDIT_NOT_FOUND`, `EDIT_INVALID`, `SOURCE_MISSING`, `SOURCE_OUTSIDE_BRAND`, `SEGMENT_INVALID`, `RENDER_TOOLS_MISSING` (run `npm ci`), `BROWSER_MISSING` (offline on first run), `RENDER_FAILED`, `UNEXPECTED`. Set `CONTENT_KIT_DEBUG=1` to add technical detail to the `fix` text.

## What it does

- Plays `edit.json` segments back to back from the source files (`in`/`out` in source seconds).
- Fits to the output size: `crop-center` fills the frame and `cropX` (0 to 1, default 0.5) picks the crop centre; `blur-fit` shows the whole frame over a blurred copy.
- Captions from the transcript words, remapped from source time to output time (a word belongs to the clip its midpoint falls in). Corrections (`from` can be several words, case and punctuation ignored) are applied first. Styles `word-highlight` (current word in the accent colour) and `phrase`; honours `maxWordsPerLine`, `uppercase`, `fontSizePct` (percent of frame height), `position`. Pages break at sentence ends, commas, pauses over 0.8 s and cuts. The font shrinks to keep a page within two lines.
- Safe area: a centred box with 12% clear on the left and right, 8% at the top and 20% at the bottom (`src/safe.js`). Captions (both styles, both positions), hook title, text overlays and the end card are centred on the frame and wrap inside its width; the lower-third caption block ends at 73% of the height. The watermark may sit in a top corner outside the box.
- Watermark logo (corner and opacity from `brand.json`), hook title, text and image overlays, optional music (loops, `volumeDb`, fades out over the last second), end card (brand colours, logo or brand name, call to action).
- Defaults: `edit.json` wins, anything omitted comes from `brand.json`. `edit.music: false` means no music; an `edit.music.file` of `null` falls back to `brand.music.defaultTrack`. `edit.endCard` is `true`, `false` or `{ seconds, cta }`.

### Fallbacks (never fail a render, always add a warning)

Missing or unreadable font file, logo, music file or overlay image; no transcript for a source; a clip that runs past the end of its footage (stopped at the end). A font family with `file: null` simply uses the bundled Inter, with no warning. Missing **footage** is the only thing that fails.

## How local files reach the video (Windows paths)

Footage, logos, fonts and music are never given to Remotion as file paths. `lib/files.mjs` starts a read-only server on `127.0.0.1` (random port, Range requests, CORS) for the length of the render and hands the composition `http://127.0.0.1:<port>/f/<id>/<name>` URLs. Only files the plan registered are reachable. This avoids drive letters, backslashes, `file://` quirks and copying large footage into `public/`. The page's documented `staticFile()` is used only for the bundled fonts.

## `smoke`

Renders a 5-second clip with no footage: a generated test pattern showing the brand colours as swatches, the two fonts, a moving bar, a dashed line marking the safe area (everything sits inside it, laid out around wherever the captions go), the hook title, a text overlay, the watermark, word captions in the brand's style, and the end card (at least 1.5 s). Audio is added only if the brand has a `music.defaultTrack`.

## Speed (this machine, 8 threads, Linux)

Smoke test 29 s the first time (includes bundling), 6 s after. A 10 s final render of 1080p footage about 20 s. `blur-fit` is several times slower (two decodes plus a blur). The bundle is cached in `.bundle/` and rebuilt when `src/`, `public/` or the lockfile change.

## Layout

```
cli.mjs            entry point
lib/               plan.mjs (brand+edit -> plan), captions.mjs, files.mjs, render.mjs, errors.mjs
src/               the Remotion composition (Reel, Captions, Overlays, TestPattern)
public/fonts/      bundled fallback font (Inter, OFL)
```
