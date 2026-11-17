# Writing the brand's skills and the workspace files

This happens after the brand guide and `brand.json` are done and the test clip has worked. It works for any recipe, so adding a new kind of video later means adding a recipe folder, not changing these steps.

`PLUGIN_ROOT` is the plugin folder named in the skill you came from. `NODE`, `KIT` and `KIT_HOME` are the paths from [kit-commands.md](kit-commands.md).

## 1. Which recipes

Every folder in `PLUGIN_ROOT/recipes/` that has a `recipe.json` is a recipe. Use the ones with `"enabledByDefault": true`, provided every tool in their `requiredTools` showed as ok in the last `doctor`. If a recipe can't be used because a tool is missing, say which kind of video isn't available yet and why, in one line.

## 2. One skill per brand per recipe

For each brand and each recipe:

1. Read `PLUGIN_ROOT/recipes/<recipe-id>/recipe.json` and its template (`skill.template`).
2. Work out the skill name from `skill.name` (for the reel recipe, `<slug>-reel`).
3. Fill every `{{PLACEHOLDER}}` in the template. The recipe's `placeholders` list says where each value comes from:
   - **`"kind": "value"`:** copy the value exactly (a name, a path, a number).
   - **`"kind": "distilled"`:** write it from the brand guide, following the `write` note. This is where the skill becomes this brand's own: its voice, openings, pacing, never-dos and approvals are written into the skill itself, not left as "see the guide". Rules for writing these:
     - Use the client's words. Shorten, don't paraphrase into marketing language.
     - Make each line something an editor can act on or check. "Warm" alone isn't usable; "warm: talks to one person, uses 'you', no hype words" is.
     - Keep every never-do and approval rule the client gave. Never drop or soften one to save space.
     - Where the guide says `_(not answered yet)_`, write a sensible default and mark it `(default, not yet confirmed)`.
     - Write markdown that fits where the placeholder sits: a bulleted list on its own lines, or one sentence inline, as the `write` note says.
4. Check there's no `{{` left anywhere in the result. A leftover placeholder means a step was missed. (`install-skill` checks this too.)
5. Write the filled skill to `brands/<slug>/docs/<skill name>.SKILL.md` (a draft inside the brand folder, which you're allowed to edit), then save it into place with `install-skill --workspace "<this folder>" --from "brands/<slug>/docs/<skill name>.SKILL.md" --name "<skill name>"`. Don't write into `.claude/` yourself: the app guards that folder and stops to ask, or refuses, every time, while the kit's own command is already allowed. `install-skill` checks the draft (frontmatter, name, no `{{` left), keeps any older skill as `SKILL.previous.md`, saves the new one, and removes the draft. If it reports a problem, fix the draft and run it again.
6. Check the first lines: the file must start with `---` on line 1, and `name:` must equal the folder name. If the brand name has a colon followed by a space, a ` #`, or starts with a symbol, the `description:` line won't read correctly as written. Wrap the whole description in double quotes, and put a backslash before any double quote inside it.

New skills under `.claude/skills/` are picked up straight away. If the folder `.claude/skills` didn't exist when this session started, they won't appear until `/reload-skills` is run (or the app is restarted). Say that in plain words if it applies: "Type /reload-skills, or close and reopen this folder, and your new skill will show up."

## 3. The permission list (`.claude/settings.json`)

`scaffold` writes this, and running it again refreshes it. Check it: it should contain the kit rules from `PLUGIN_ROOT/templates/settings.json`, with `{{NODE}}` and `{{KIT}}` replaced by the `node` and `kit` paths `scaffold` reported (absolute, forward slashes, exactly as you run them). `KIT` here is the launcher `KIT_HOME/kit.mjs`, which doesn't move when the plugin updates. The file paths in the list start with a single `/`, which means "this workspace folder", so they keep working even if a command runs from a subfolder.

- If those rules are missing or point at an old kit path, run `scaffold` again. It keeps every rule already in the file, adds the kit's rules, and removes only kit rules that point at a different `kit.mjs`.
- Never add rules the template doesn't have.
- Tell the client in one line: "I've set this folder up so I can run the kit's own commands without asking you each time." If the app still asks, it's because the folder hasn't been trusted yet: the app asks about that the first time a folder is opened, and saying yes switches the list on.

## 4. The workspace `CLAUDE.md`

Fill `PLUGIN_ROOT/templates/workspace-CLAUDE.md`:

- `{{BRANDS}}`: one bullet per brand: `- **<Name>**: folder \`brands/<slug>/\`, video skill \`/<slug>-reel\`` (add one skill per enabled recipe).
- `{{KIT_VERSION}}`, `{{GENERATED_ON}}`: as for the skills.

If `CLAUDE.md` doesn't exist, write it. If it exists and starts with the line `<!-- content-kit:workspace -->`, the kit wrote it: replace everything above the line `<!-- content-kit:end -->` and keep anything the client added below it. If it exists without that first line, the client wrote it: don't touch their text; add the filled template below it.

## 5. Tell them

Wrap-up comes from the skill you came from. Keep it short and plain.
