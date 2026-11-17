---
name: add-brand
description: Add another brand to a content kit workspace that's already set up. Interviews the owner about the new brand one question at a time, builds its folder, guide and settings, renders a test clip, and writes its video skill. Use this whenever someone says "add a brand", "set up my other business", "I have another page", "new brand" or "another account", or asks for videos for a business that has no folder under brands/ yet. For a brand-new folder with nothing set up, use the setup skill instead.
argument-hint: "[the new brand's name]"
---

# Add a brand

The owner already has a working setup and wants to add another brand: a second business, a separate page, a new line. This is the brand part of setup on its own.

**Plugin folder (`PLUGIN_ROOT`):** `${CLAUDE_PLUGIN_ROOT}`
**Kit program (`KIT`):** the launcher `KIT_HOME/kit.mjs` once it exists, otherwise `${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs` (see `kit-commands.md`)

This skill reuses the setup skill's reference files. They're in `${CLAUDE_PLUGIN_ROOT}/skills/setup/references/`:

- `kit-commands.md`: how to run the kit. Read it first.
- `interview.md`: the questions, what a good-enough answer is, when to stop and clarify.
- `brand-json-mapping.md`: how answers become the brand's settings.
- `generate-skills.md`: writing the brand's skill and updating the workspace files.

Talk the same way setup does: plain words, one question per message, no technical terms.

## Steps

1. **Check things still work.** Run `doctor`. If something's missing or broken, tell them in a line and run `install` in the background (see `kit-commands.md`). If the kit's own Node is missing, follow `machine-check.md` in the same folder first.
2. **Check this is the right folder.** There should be a `brands/` folder with at least one brand in it. If there isn't, this is a first-time setup: say so and use the setup skill instead.
3. **Team size.** Read `teamSize` from an existing brand's `brand.json`. Ask: "Is this brand part of the same business, with the same <N> people?" If yes, reuse the number. If no, ask question W2 from the interview, including the licence note if it applies.
4. **Name and folder.** Ask question 1a (use `$ARGUMENTS` as the name if they gave one, and confirm the spelling). Agree a short folder name that isn't already used under `brands/`. Run `add-brand --workspace "<this folder>" --slug "<slug>" --name "<name>"`. Copy `PLUGIN_ROOT/templates/brand-guide.md` to `brands/<slug>/brand-guide.md` with `{{BRAND_NAME}}` and `{{UPDATED_ON}}` filled in, and make sure `brands/<slug>/docs/lessons.md` exists (the setup skill's step 3 describes it).
5. **The interview.** Sections 1 to 9 plus the recipe questions, as in `interview.md`. Where an answer is likely the same as an existing brand's (fonts, who approves), offer it: "Same as <other brand>: <answer>. Keep that?" Never copy a brand's voice, examples or never-do list across without asking. Brands from one owner often differ most in exactly those.
6. **Settings.** Fill `brands/<slug>/brand.json` from the guide using `brand-json-mapping.md`, then run `validate`.
7. **Test clip.** Run `smoke-test --brand-dir "brands/<slug>"`, ask them to look, and adjust once or twice if needed.
8. **The skill.** Follow `generate-skills.md` for this brand only: write its skill for each recipe, and update the workspace `CLAUDE.md` so its brand list includes the new brand. Leave the other brands' skills alone.
9. **Wrap up** in a few lines: the guide, the test clip, the new skill's name (`/<slug>-reel`), and how to make the first video. Add one line for anything that was skipped.
