# Machine check and Node bootstrap

This runs before anything else. It makes sure the folder is a good place to work and that the kit's own Node is installed. Everything after this uses that Node. Paths and the command form are in [kit-commands.md](kit-commands.md).

Tell the client what's happening in one or two lines, not a list of steps: "First I'm checking your computer and installing the tools the kit needs. Nothing here needs your password, and it all goes in one folder you can delete any time."

## 1. Is the folder a good place to work?

The workspace is the folder that's open right now. It must be on this computer's own disk, not in a folder that syncs to the cloud. Raw video is large, and syncing breaks half-finished videos.

Look at the full path. It's a synced folder if any part of it is one of these (any capitals):
- `Dropbox`, `Google Drive`, `GoogleDrive`, `My Drive`, `OneDrive`, `iCloud Drive`, `iCloudDrive`, `Mobile Documents`, `CloudStorage`, `Box`, `pCloud`, `Sync`.
- On a Mac, also `Desktop` or `Documents` when iCloud "Desktop & Documents" is turned on. You can't tell from the path alone, so if the folder is under one of those two, ask: "Is your Desktop and Documents folder synced to iCloud?"

If it's synced, stop and say:

> "This folder syncs to the cloud, and big video files don't mix well with that. Please make a new folder somewhere that doesn't sync (on a Mac, your home folder works, like **Videos** or a new folder called **Content**; on Windows, something like `C:\Content`), open that folder here instead, and say 'set me up' again."

Also stop, the same way, if the folder is on a removable drive or a network drive.

If the folder already has things in it that aren't from the kit (lots of unrelated files), ask whether this is the folder they want to use. An empty folder is best.

## 2. Is the kit's Node there?

Work out `KIT_HOME` and `NODE` as in kit-commands.md. Then run `"NODE" --version`.

- It prints `v26.13.1`: done, skip to section 4.
- Anything else (not found, or another version): install it (section 3).

The kit uses only its own copy of Node, never one already on the computer. Its version is pinned, so an update to the computer's own Node can't break the kit.

## 3. Install the kit's Node

_This section is the one place the Node download steps are written down. The pinned version must match `PINS.node` in `PLUGIN_ROOT/scripts/lib/common.mjs`; the kit's tests check that._

The pinned version is **v26.13.1** (Node 26 LTS). Download it from nodejs.org, check it against the published checksum, unpack it into `KIT_HOME/tools/node/` so the program sits directly in that folder, then delete the download. No installer and no admin password, and nothing outside `KIT_HOME` changes.

When it's done, Node is at `KIT_HOME/tools/node/bin/node` on a Mac (and Linux), and at `KIT_HOME/tools/node/node.exe` on Windows.

Pick the file:

| Computer | How to tell | File |
| --- | --- | --- |
| Mac, Apple chip | `sysctl -n hw.optional.arm64` prints `1` (this stays right even if the shell runs under Rosetta, where `uname -m` says `x86_64`) | `node-v26.13.1-darwin-arm64.tar.gz` |
| Mac, Intel chip | `sysctl -n hw.optional.arm64` prints `0` or nothing | `node-v26.13.1-darwin-x64.tar.gz` |
| Windows, any PC | always this one, including Windows on ARM | `node-v26.13.1-win-x64.zip` |
| Linux (testing only) | `uname -m`: `x86_64` / `aarch64` | `node-v26.13.1-linux-x64.tar.gz` / `-linux-arm64.tar.gz` |

**Windows always gets the x64 build.** The video tool only ships for x64 Windows. Windows 11 on ARM runs x64 programs fine. Windows 10 on ARM can't, so the kit doesn't work there; if `PROCESSOR_ARCHITECTURE` is `ARM64` on Windows 10, stop and say so plainly.

The download address is `https://nodejs.org/dist/v26.13.1/<file>`, and the checksums are in `https://nodejs.org/dist/v26.13.1/SHASUMS256.txt`.

Run each line below as its own command. Replace `KH` with the absolute `KIT_HOME` path (forward slashes) and `FILE` with the file name.

### macOS (and Linux) in Bash or zsh

```
mkdir -p "KH/tools/node" "KH/downloads"
curl -fL --retry 3 -o "KH/downloads/FILE" "https://nodejs.org/dist/v26.13.1/FILE"
curl -fsSL -o "KH/downloads/SHASUMS256.txt" "https://nodejs.org/dist/v26.13.1/SHASUMS256.txt"
shasum -a 256 "KH/downloads/FILE"
grep " FILE$" "KH/downloads/SHASUMS256.txt"
tar -xzf "KH/downloads/FILE" -C "KH/tools/node" --strip-components 1
"KH/tools/node/bin/node" --version
rm "KH/downloads/FILE" "KH/downloads/SHASUMS256.txt"
```

On Linux, use `sha256sum` if `shasum` is missing. The two checksum lines must show the same long code. If they don't, delete the download, try once more, and if it still doesn't match, stop and tell the client the download was damaged and to try again on a different internet connection.

### Windows in Git Bash (the usual case in the Code tab)

Git Bash has its own `tar` that can't open `.zip` files, so call Windows' built-in one by its full path.

```
mkdir -p "KH/tools/node" "KH/downloads"
curl.exe -fL --retry 3 -o "KH/downloads/FILE" "https://nodejs.org/dist/v26.13.1/FILE"
curl.exe -fsSL -o "KH/downloads/SHASUMS256.txt" "https://nodejs.org/dist/v26.13.1/SHASUMS256.txt"
sha256sum "KH/downloads/FILE"
grep " FILE$" "KH/downloads/SHASUMS256.txt"
"$SYSTEMROOT/System32/tar.exe" -xf "KH/downloads/FILE" -C "KH/tools/node" --strip-components 1
"KH/tools/node/node.exe" --version
rm "KH/downloads/FILE" "KH/downloads/SHASUMS256.txt"
```

### Windows in PowerShell

Write `curl.exe`, never `curl`: in Windows PowerShell, `curl` is a different command.

```
New-Item -ItemType Directory -Force -Path "KH/tools/node", "KH/downloads"
curl.exe -fL --retry 3 -o "KH/downloads/FILE" "https://nodejs.org/dist/v26.13.1/FILE"
curl.exe -fsSL -o "KH/downloads/SHASUMS256.txt" "https://nodejs.org/dist/v26.13.1/SHASUMS256.txt"
(Get-FileHash "KH/downloads/FILE" -Algorithm SHA256).Hash.ToLower()
Select-String -Path "KH/downloads/SHASUMS256.txt" -Pattern " FILE$"
& "$env:SystemRoot/System32/tar.exe" -xf "KH/downloads/FILE" -C "KH/tools/node" --strip-components 1
& "KH/tools/node/node.exe" --version
Remove-Item "KH/downloads/FILE", "KH/downloads/SHASUMS256.txt"
```

### If it doesn't work

- **No internet, or the download stops:** say so plainly and ask them to check their connection, then run the same step again.
- **A firewall or antivirus blocks it** (common on work computers): tell the client the kit needs to download Node from nodejs.org, and that their IT person may need to allow it.
- **The version check doesn't print `v26.13.1`:** delete `KH/tools/node`, and do this section again once. If it fails again, stop and tell them to contact the person who set this up, with the last message they saw.

## 4. Check the rest

Run `doctor` (see kit-commands.md). It reports each part (system, disk space, kit home, Node, speech-to-text, video tool) as ok, missing or broken.

- If anything is missing or broken, tell the client in one line, then run `install` in the background. It can take a while: the speech-to-text tool and its language model are a big download. Say roughly how long ("this usually takes 5 to 15 minutes, depending on your internet"), then go on with the interview while it runs. Run `doctor` again before the test clip.
- If `doctor` reports low disk space, say how much is free and that raw video needs room. 20 GB free is a comfortable minimum.
- If it reports an unsupported computer (for example Windows 10 on ARM), stop and say plainly which part won't run there.
