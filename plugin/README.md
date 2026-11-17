# Content Kit plugin

Turns the Code tab of the Claude desktop app into a video editor for one business, or several. Setup interviews the owner about their brand, installs the tools, and writes a video skill for each brand. The owner then drops footage in a folder and asks for a video in plain words.

## Skills

| Skill | When it runs |
| --- | --- |
| `setup` | "Set me up", in an empty folder. Checks the computer, installs the tools, interviews the owner one question at a time, writes the brand guide and settings, renders a 5-second test clip, and generates the brand's video skill. Picks up where it left off if stopped. |
| `add-brand` | "Add another brand", in a folder that's already set up. |
| `doctor` | "Check my video setup". Checks and repairs the tools, the folder, the permission list and each brand's skill. |

Setup generates one skill per brand per recipe into the workspace, for example `.claude/skills/<brand>-reel/SKILL.md`. Those skills belong to the owner and work without the setup skills.

## Recipes

A recipe is one kind of video. v1 has one, `reel`: a long talking or demo recording becomes a 15 to 90 second vertical video with word-by-word captions, a hook title, the logo, optional overlays and music, and an end card. A recipe is a folder in `recipes/` with a `recipe.json` (what it needs, what setup should ask, how its skill is filled) and a `skill.template.md`. A new kind of video is a new folder; setup picks it up without changes.

## How it runs

Every step goes through one program, `scripts/kit.mjs`, run with the kit's own Node: `doctor`, `install`, `scaffold`, `add-brand`, `validate`, `new-job`, `ingest`, `transcribe`, `frames`, `render`, `review-frames`, `smoke-test`, `install-skill` and `update`. Each prints exactly one JSON object, with a plain-language `message` and `fix` when something goes wrong. `install` copies a small launcher to `~/.content-kit/kit.mjs`; skills and the workspace permission list call that launcher, so they keep working after the plugin updates.

**Fixes arrive on their own.** The desktop app can't update a plugin from its plugin screen, so the kit keeps itself current. About once a week, at the start of a new video, it looks up the latest published release of this repo (only tags named like `v1.2.3`, over https), checks it, and installs its working parts (`scripts/`, `render/`, `recipes/`, `templates/`) into `~/.content-kit/kit/<version>/`. The launcher runs the newest copy that passes a quick check, so the previous version is still there to fall back to. Saying "check my video setup" looks right away. Set `CONTENT_KIT_NO_UPDATE=1` to turn the automatic check off. The skills themselves still come from the plugin.

| Job | Tool | Where it lives |
| --- | --- | --- |
| Runtime | Node 26.13.1, official portable build | `~/.content-kit/tools/node/` |
| Speech to text | sherpa-onnx 2.0.1 (prebuilt, no compiler) with NVIDIA's Parakeet TDT 110M English model | `~/.content-kit/tools/stt/` |
| Cut, caption, brand, render | Remotion 4.0.544 (own headless Chrome and ffmpeg) | `~/.content-kit/render/` |

Before each render the kit copies the chosen moments out of the raw footage into small H.264 files with Remotion's own ffmpeg, so phone footage (HEVC, 4K, rotated, variable frame rate, files over 2 GB) renders the same as anything else.

## What install downloads

| From | What | About |
| --- | --- | --- |
| nodejs.org | Node 26.13.1 (setup does this step itself, with the computer's built-in `curl` and `tar`) | 30 to 50 MB |
| registry.npmjs.org | Remotion and its parts; sherpa-onnx | 335 MB download, 780 MB on disk |
| Remotion's download host | Remotion's headless Chrome | 100 MB |
| github.com | the speech model (a sherpa-onnx release file) | 108 MB |
| github.com | later fixes to the kit itself: this repo's tagged releases, about once a week at most | under 1 MB each |

Nothing is compiled on the computer. On a Mac the kit needs macOS 15 (Sequoia) or newer, because Remotion's bundled ffmpeg is built for it; `doctor` checks and says so in plain words.

## Credits

Speech recognition uses [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0) and NVIDIA's Parakeet TDT 110M model (`parakeet-tdt_ctc-110m`, CC-BY-4.0), downloaded at install time. Rendering uses [Remotion](https://www.remotion.dev). The fallback font is Inter (SIL Open Font License).

## Rules it keeps

- Original footage in `raw/` is only ever read.
- Nothing is posted or uploaded anywhere.
- No admin rights, no system package managers, nothing installed outside `~/.content-kit/`.
- Everything the owner sees is in plain words.
