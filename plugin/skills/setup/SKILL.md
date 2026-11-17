---
name: setup
description: First-time setup for the content kit. Checks the computer, installs the video tools, interviews the owner about their brand one question at a time, builds the brand folders, renders a short test clip, and writes a video-editing skill for each brand. Use this whenever someone says "set me up", "get started", "set up the content kit", "set up my brand" or "how do I start", opens an empty folder after adding the content kit, or asks to make videos in a folder that has no brands/ folder yet, even if they don't name the kit.
argument-hint: "[optional: your business name]"
---

# Content kit setup

You're setting up a small-business owner's computer so Claude can edit their videos in their brand's style. They're not technical. They might be sitting with the person who sold them this, or on their own. By the end they'll have a folder of their own with a brand guide, a short test video in their colours, and a skill that turns their long recordings into short vertical videos.

**Plugin folder (`PLUGIN_ROOT`):** `${CLAUDE_PLUGIN_ROOT}`
**Kit program (`KIT`):** the launcher `KIT_HOME/kit.mjs` once it exists, otherwise `${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs` (see `kit-commands.md`)

The references below use `PLUGIN_ROOT` to mean the folder above. Read each one when you reach its step, not all at the start:

- [references/kit-commands.md](references/kit-commands.md): how to run the kit and read what it says. **Read this first.**
- [references/machine-check.md](references/machine-check.md): step 1.
- [references/interview.md](references/interview.md): step 3.
- [references/brand-json-mapping.md](references/brand-json-mapping.md): step 4.
- [references/generate-skills.md](references/generate-skills.md): step 6.

## How to talk

Plain, warm and short, like a person helping out, not a program. No jargon: say "the video tool", "your settings", "a short name for folders", never JSON, render, slug, schema, repo, CLI. Say what you're doing in a line before anything that takes a while. Ask **one question per message**. When something goes wrong, say what happened and what you'll do next, in a sentence each. Everything you make here belongs to them; say so once, near the end.

Start with one short message: who you are, what's about to happen, and how long it takes (about 10 minutes of setup while tools download, then 20 to 40 minutes of questions per brand). Then begin. If they passed a business name (`$ARGUMENTS`), use it for the first brand.

## 0. Where are we?

Look at the open folder before doing anything:

- **Empty, or no `brands/` folder:** a fresh setup. Do every step.
- **`brands/` exists, and every brand has a finished guide and a skill in `.claude/skills/`:** they're already set up. Say so, and offer to add a brand (the `add-brand` skill) or check the setup (the `doctor` skill).
- **A brand's guide still has `_(not answered yet)_` in its early sections, or it has no skill yet:** an earlier setup stopped partway. Say where you're picking up, run steps 1 and 2 again (they're quick and safe to repeat), then carry on from where it stopped.

## 1. Check the computer and install the tools

Follow [machine-check.md](references/machine-check.md): check the folder is local and not synced, install the kit's own Node if needed, run `doctor`, then start `install` in the background for anything missing. Don't wait for `install` to finish: go on to step 2 and the interview while it runs.

## 2. Make the workspace

Run `scaffold --workspace "<this folder, absolute, forward slashes>"`. It creates the folder skeleton and the permission list in `.claude/settings.json`. Then check the permission list as described in section 3 of [generate-skills.md](references/generate-skills.md).

## 3. The interview

Follow [interview.md](references/interview.md). In short:

- Ask the workspace questions once: which brands, team size (and the licence note if it applies).
- Then, for each brand in turn:
  1. Ask question 1a (what the business does, and its exact name). Agree a short folder name with them (the rules are in the mapping file under `slug`).
  2. Run `add-brand --workspace "<this folder>" --slug "<slug>" --name "<name>"`.
  3. Copy `PLUGIN_ROOT/templates/brand-guide.md` to `brands/<slug>/brand-guide.md`, filling `{{BRAND_NAME}}` and `{{UPDATED_ON}}` (today's date). If the guide already exists, keep it: you're resuming.
  4. Make sure `brands/<slug>/docs/lessons.md` exists. If it doesn't, create it with a heading `# What we've learned: <name>` and one line: `_Claude adds a line here whenever your feedback should change the next video._`
  5. Carry on through the nine sections, one question at a time, plus the recipe questions from each `recipe.json`. Write each section into the guide as soon as it's done.
- Stop and clarify when an answer is vague or would make you guess. That section of the interview file says how. Don't fill gaps with made-up details.

## 4. Write the settings and check them

For each brand, fill `brands/<slug>/brand.json` from the guide using [brand-json-mapping.md](references/brand-json-mapping.md). Edit the starter file `add-brand` made; keep its keys. Then run `validate --file "brands/<slug>/brand.json"` and fix anything it reports until it passes.

## 5. The test clip

Run `doctor` again. Once the tools are installed, run `smoke-test --brand-dir "brands/<slug>"`. It makes a 5-second clip in the brand's colours, fonts and logo.

Tell them where it is and ask them to open it: "Open this and tell me: do the colours look right, can you read the words, and does the logo look OK?" If something's off, fix the guide and `brand.json` together, validate, and run the test again. Two rounds is usually plenty. Small things they can change later. The usual asks: logo too small or big (`reel.watermark.sizePct`), words too small or big (`captions.fontSizePct`), a colour off (`colors.*`); the mapping file has the steps for each.

If the tools are still installing, say so and wait. If install failed, see what `doctor` says, tell them plainly, and try `install` once more. If it fails a second time, finish the guide and settings anyway, skip the test clip and the skills, and tell them to contact the person who set this up, with the message they saw. The interview isn't lost; running setup again picks up from here.

## 6. Write their skills

Follow [generate-skills.md](references/generate-skills.md): one skill per brand for each recipe, the workspace `CLAUDE.md`, and a last check of the permission list.

## 7. Wrap up

Keep it to a short message in plain words, using this shape (fill it in; don't add more):

> You're all set. Here's what you've got:
>
> - **Your brand guide** for <Name>: `brands/<slug>/brand-guide.md`. It's yours; change it any time.
> - **Your test clip:** `<path>`.
> - **Your video skill:** `/<slug>-reel`.
>
> **To make a video:** drop a recording into `brands/<slug>/raw/`, then tell me what you want, like "Make a 45-second reel from the new recording, about <one of their topics>."
>
> Everything here lives in this folder, on your computer, and it all belongs to you.

If more than one brand was set up, list each. If something was skipped (no logo yet, no examples yet), add one line for each: what's missing and what to do about it. If the licence note applied, repeat it in one short line as something for later, not a to-do.
