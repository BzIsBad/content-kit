---
name: doctor
description: Check and repair a content kit setup. Checks the computer, the kit's tools, the workspace, each brand's settings and each brand's video skill, fixes what it safely can, and explains the rest in plain words. Use this whenever someone says "check my video setup", "something's broken", "it's not working", "the video didn't come out", "fix my setup", or "update my video kit", or after the content kit has been updated, or when a brand's video skill can't find the kit.
---

# Check and repair the setup

Someone's video setup isn't working, or they want to know it's healthy. Find out what's wrong, fix what's safe to fix, and explain the rest simply. Don't change their brand guide, footage or finished videos.

**Plugin folder (`PLUGIN_ROOT`):** `${CLAUDE_PLUGIN_ROOT}`
**Kit program (`KIT`):** the launcher `KIT_HOME/kit.mjs` once it exists, otherwise `${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs` (see `kit-commands.md`)

How to run the kit and read its results: `${CLAUDE_PLUGIN_ROOT}/skills/setup/references/kit-commands.md`. Read it first.

Say what you're doing in one line ("I'll run a quick check of your setup"), then work through the list. Talk in plain words throughout.

## 1. The kit's Node

Work out `NODE` as in `kit-commands.md` and run `"NODE" --version`. If it isn't `v26.13.1`, follow `${CLAUDE_PLUGIN_ROOT}/skills/setup/references/machine-check.md` to install it, then carry on.

## 2. The kit's latest fixes

Run `update` (once `KIT_HOME/kit.mjs` exists; before the first `install` there's nothing to update). It fetches the latest published version of the kit's working parts, if there is a newer one, and the launcher uses it from the next command on. Read `action`:

- `updated`: say one plain sentence, such as "I picked up the latest fixes for your video kit first." If `recipesChanged` lists a recipe, the way that kind of video is made has improved, so refresh each brand's skill for it in step 5 (it keeps a copy of the old one), and tell them so in one line.
- `up-to-date`, `no-release` or `held-back`: say nothing about it.
- `ok: false` (offline, or the download didn't pass its checks): their kit is unchanged and still works. Mention it in one line only if they asked about updates; otherwise carry on.

Never ask them to update anything through the plugin screen or a terminal. This step is how the kit gets its fixes.

## 3. The tools

Run `doctor`. Its `kit` field says which kit version is in use (`version`), where it came from (`source`: `plugin` or `self-update`) and whether a newer release exists (`updateAvailable`). If `updateAvailable` is still true after step 2, run `update` once more; if it fails, carry on with the kit they have. For anything else missing or broken, say which part in plain words ("the speech-to-text tool isn't installed"), then run `install` in the background (or `install --only <tool>` for one part). Run `doctor` again afterwards and report the result. Right after an update, the renderer can show as needing a refresh; that's expected, and `install --only render` does it (usually a quick copy). If it's still broken after one repair, stop there and tell them to contact the person who set this up, quoting the message `doctor` gave.

## 4. The folder

Only if a workspace is open (there's a `brands/` folder):

- Check the folder isn't in a synced location (section 1 of `machine-check.md`). If it is, explain and suggest moving it; don't move it yourself.
- Run `scaffold --workspace "<this folder>"` to put back any missing folders. It's safe to run on a working setup.
- `scaffold` also refreshes the permission list in `.claude/settings.json`: it points it at the launcher `KIT_HOME/kit.mjs` and removes rules an older kit wrote for other kit paths. Check its result's `node` and `kit` match the `NODE` and `KIT` you're using (section 3 of `${CLAUDE_PLUGIN_ROOT}/skills/setup/references/generate-skills.md`).

## 5. Each brand

For each folder in `brands/`:

- Run `validate --file "brands/<slug>/brand.json"`. If it fails, compare it with `brand-guide.md` and fix `brand.json` to match the guide (`${CLAUDE_PLUGIN_ROOT}/skills/setup/references/brand-json-mapping.md`). Tell them what you changed.
- Check every file `brand.json` points to (logo, fonts, music) exists. If one is missing, say which, and that videos will still work without it.
- Check the brand has a skill in `.claude/skills/<slug>-<recipe>/` for each recipe. In each one, check the paths in its "How to run the kit" section are the current `NODE` and the launcher `KIT_HOME/kit.mjs` (skills made by kit 0.1.0 point inside the plugin folder instead). If it doesn't, or the skill is missing, or it was made by an older kit, or step 2 listed its recipe in `recipesChanged`, regenerate it as in `generate-skills.md` (it keeps a copy of the old one).
- Note anything in `brand-guide.md` still marked `_(not answered yet)_`. Don't ask about it now; just mention it at the end.

## 6. Report

A few lines, plain words:

- What was fine.
- What you fixed (including "picked up the latest fixes for your video kit", if step 2 did).
- What still needs them (with the one thing to do for each).

If everything was fine, say so in one sentence.
