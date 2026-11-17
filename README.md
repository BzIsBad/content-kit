# Content Kit

A Claude Code plugin that turns the Code tab of the Claude desktop app into a video editor that knows a business's brand. The owner answers a setup interview once. After that they drop a long recording into a folder, say what they want in plain words, and get back a short vertical video (15 to 90 seconds) with captions, their logo, their colours and an end card. Claude checks its own work by looking at frames from the draft before it hands anything over.

Everything it makes lives in a folder on the owner's computer, as plain files they own: the brand guide, the footage, the finished videos and the skills Claude edits with.

- **For the person using it:** start with [docs/client/quick-start.md](docs/client/quick-start.md).
- **What's inside the plugin:** [plugin/README.md](plugin/README.md).
- **The fixed interfaces** (folder layout, settings files, commands): [docs/spec/contracts.md](docs/spec/contracts.md).

## Install

In the Code tab of the Claude desktop app (Pro plan or higher), with the folder for the videos open:

```
/plugin marketplace add bzisbad/content-kit
/plugin install content-kit@content-kit
```

Then say "set me up". To try a local copy instead, use `claude --plugin-dir ./plugin` from this folder, or add the folder as a marketplace with `/plugin marketplace add <path to this folder>`.

## What it needs on the computer

- macOS 15 (Sequoia) or newer, Apple silicon or Intel; or Windows 10 or 11 on x64. Windows 11 on ARM runs the x64 build.
- About 2 GB for the kit's tools and 20 GB free for footage.
- No admin rights and no system installs. Setup downloads a pinned, portable Node and the video tools into `~/.content-kit/` (`%USERPROFILE%\.content-kit` on Windows). Deleting that folder removes them.
- No paid service beyond the Claude plan. The renderer, Remotion, is free for teams of up to three; larger businesses may need their own Remotion licence depending on how they use it (see remotion.dev/license).

## Layout

| Path | What it is |
| --- | --- |
| `.claude-plugin/marketplace.json` | This repo as a one-plugin marketplace |
| `plugin/` | The plugin: skills, the `kit.mjs` pipeline, the render project, templates and recipes |
| `tests/` | Tests that run on Linux: `node --test tests/unit.test.mjs tests/integration.test.mjs` (fast), `tests/e2e.test.mjs` (real install, a few minutes) |
| `docs/client/` | The page for the person using it |
| `docs/spec/` | The contracts between the parts |

## Licence

No open-source licence has been chosen yet for the kit's own code, so all rights are reserved for now. Remotion, sherpa-onnx, the Parakeet speech model (CC-BY-4.0, by NVIDIA) and the bundled Inter font keep their own licences; see [plugin/README.md](plugin/README.md#credits).
