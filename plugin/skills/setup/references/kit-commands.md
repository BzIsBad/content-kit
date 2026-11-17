# How to call the kit

Every skill in this plugin talks to the pipeline through one program, `kit.mjs`, run by the kit's own copy of Node. The commands and their flags are fixed by the contract (section 5). Nothing else is called directly: no `npx`, no `ffmpeg`, no `remotion`.

## The three paths

Work these out once per session and reuse them.

| Name | What it is | Where |
| --- | --- | --- |
| `KIT_HOME` | The kit's home on this computer | The `CONTENT_KIT_HOME` environment variable if it's set (only tests set it); otherwise the `.content-kit` folder in the user's home folder (`/Users/<name>/.content-kit` on a Mac, `C:/Users/<name>/.content-kit` on Windows) |
| `NODE` | The kit's own Node | macOS and Linux: `KIT_HOME/tools/node/bin/node`. Windows: `KIT_HOME/tools/node/node.exe` |
| `KIT` | The kit program | `KIT_HOME/kit.mjs` once it exists (`install` and `scaffold` put it there). It's a small launcher that always runs the newest copy of the kit, so its path never changes when the plugin updates. Before the first `install`, use `PLUGIN_ROOT/scripts/kit.mjs` directly, where `PLUGIN_ROOT` is the plugin folder named at the top of the skill you came from. |

To find the home folder and `CONTENT_KIT_HOME`, run `echo "$HOME|$CONTENT_KIT_HOME"` in Bash or zsh, or `"$env:USERPROFILE|$env:CONTENT_KIT_HOME"` in PowerShell. In Git Bash on Windows, `$HOME` comes out as `/c/Users/sam`; run `cygpath -m "$HOME"` to get the `C:/Users/sam` form, and use that.

Write all three as **absolute paths with forward slashes**, also on Windows (`C:/Users/sam/.content-kit/tools/node/node.exe`). Node, Git Bash and PowerShell all accept forward slashes, and the workspace's permission list is written the same way, so a command only runs without a prompt if it matches exactly. If `PLUGIN_ROOT` came out with backslashes, turn them into forward slashes.

## The one command form

```
"NODE" "KIT" <command> --flag "value" --other-flag "value"
```

- Both paths in double quotes, always, even when there are no spaces in them. Same for flag values that are paths.
- **PowerShell:** put `& ` in front: `& "NODE" "KIT" doctor`.
- **One command per tool call.** Don't chain with `&&`, `;` or `|`, and don't add `cd` first. The permission list approves exactly this form, and anything chained to it asks the client again.
- Paths in flags: absolute, or relative to the workspace folder, forward slashes.

Example on a Mac:

```
"/Users/sam/.content-kit/tools/node/bin/node" "/Users/sam/.content-kit/kit.mjs" doctor
```

## Reading the result

- The result is a single JSON object on standard output. Progress lines go to standard error; ignore them unless something fails.
- `"ok": true`: carry on. Use any paths it reports rather than guessing them.
- `"ok": false`: it has `code`, `message` and `fix`. The message is already written for the client. Tell them in your own words what happened and what you'll do, then do the fix if you can. Don't paste raw output at them.
- Every command is safe to run twice. If one was cut off, run it again.

## Long commands

`install`, `ingest`, `transcribe` and `render` can take minutes (install and a long transcription can take much longer). Say so before starting, in one line. Run them in the background so the tool's time limit doesn't cut them off, and wait for them to finish before moving on.

## Reading what a command made

These are the fields to use from a successful result (the full list is in the contract, section 5):

| Command | Use |
| --- | --- |
| `doctor` | `ready` (true when everything works), `summary`, and `checks[]` (each with `id`, `label`, `status`, `detail`, `fix`) |
| `install` | `ready`, `summary`, `installed` |
| `scaffold` | `node` and `kit`: the exact paths the permission list allows |
| `add-brand` | `brandDir` |
| `new-job` | `job` (the folder name) and `jobDir` |
| `ingest` | `durationSec`, `video`, `audio` |
| `transcribe` | `txt` (the file to read) and `json` (word times) |
| `frames` | `sheets[].file` (the images to look at) |
| `render` | `out` (the video) and `warnings` |
| `review-frames` | `dir` and `frames[].file` (the images to look at), `checks` |
| `smoke-test` | `out` |
| `install-skill` | `skill` (where it was saved), `action` (`created`, `updated`, `unchanged`) |

`warnings` is a list of plain sentences about things that were left out (a missing logo, say). Mention any that matter to the client once, in your own words.

## Commands the skills use

| Command | Used by | Flags |
| --- | --- | --- |
| `doctor` | setup, add-brand, doctor | none |
| `install` | setup, doctor | `--only <tool>` (optional) |
| `scaffold` | setup, doctor | `--workspace <dir>` |
| `add-brand` | setup, add-brand | `--workspace <dir> --slug <slug> --name <name>` |
| `validate` | setup, add-brand, generated skills | `--file <path>` |
| `smoke-test` | setup, add-brand | `--brand-dir <dir>` |
| `install-skill` | setup, add-brand, doctor | `--workspace <dir> --from <draft> --name <skill name>` |
| `new-job`, `ingest`, `transcribe`, `frames`, `render`, `review-frames` | generated skills | see the contract |
