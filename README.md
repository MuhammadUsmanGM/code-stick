# code-stick

> **Plug in a USB. Get an offline AI coding agent on any laptop.**
> One stick. Five targets — **Windows, macOS (Apple Silicon + Intel), Linux (x64 + ARM64)**. Zero install on the host.

[![npm](https://img.shields.io/npm/v/code-stick.svg)](https://www.npmjs.com/package/code-stick)
[![license](https://img.shields.io/npm/l/code-stick.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/code-stick.svg)](https://nodejs.org)

![code-stick demo](./public/code-stick.gif)

```bash
npx code-stick install
```

## Why

You want an AI coding agent that works on:

- **Airgapped or restricted machines** — banks, defense, hospitals, lab VMs.
- **Shared / borrowed laptops** — internships, school computers, client sites.
- **Spotty wifi** — flights, trains, cafes, conferences.
- **Privacy-sensitive code** — closed-source clients, NDAs, personal projects.

Cloud agents won't work. Installing Ollama + a 5 GB model on every machine you touch won't either. code-stick is the in-between: install once on a USB, then run the agent from the stick on whatever laptop is in front of you. Host stays clean.

Under the hood it's [opencode](https://opencode.ai) (terminal coding agent) talking to [Ollama](https://ollama.com) (local model runner), both pre-built for every target, both serving from the USB on `127.0.0.1:11434`. Quit the agent, the Ollama process dies, the host has no residue.

## Status

**v0.2.0 — opencode v1.x upgrade.** What works today:

- Full install flow on Windows, macOS, Linux (x64 + ARM64) — tested manually per target.
- Docker-based Linux smoke test in CI (`npm run smoke:docker`).
- Vitest unit suite for launcher rendering, lock files, manifest, MAX_PATH preflight.
- Bug reports auto-write a **redacted** crash report to `%TEMP%`; manual upload only.
- No telemetry. No background HTTP. See [`docs/SECURITY.md`](docs/SECURITY.md).

Rough edges:

- macOS binaries are **not yet notarized** — first-launch Gatekeeper dialog, workaround in Troubleshooting.
- Windows long-path installs need either a short USB mount or `LongPathsEnabled` — the installer detects and bails clearly.
- No Windows / macOS CI runners yet — those targets rely on manual smokes.

File an issue or open a PR if you hit anything: [github.com/MuhammadUsmanGM/code-stick/issues](https://github.com/MuhammadUsmanGM/code-stick/issues).

## What the installer does

1. Auto-detects your USB drive (or takes `--target <path>`).
2. Lets you pick a coding model.
3. Asks **Fast vs Direct** install mode (see below).
4. Downloads Ollama + opencode binaries for **all 5 targets** onto the stick.
5. Pulls the model into a USB-local Ollama store (`<USB>/data`) — host temp is auto-cleaned.
6. Writes `start-windows.bat`, `start-mac.command`, `start-linux.sh` at the USB root.
7. Cleans up installer archives and temp dirs.

Press **Esc** at any prompt to step back.

### Fast vs Direct install

| Mode       | What it does                                                                   | Needs                                                            | Best when                              |
| ---------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| **Fast**   | Pull model into host temp, then copy blobs to USB.                             | ~2× model size of free space in `%TEMP%`/`/tmp` (auto-cleaned)   | Slow USB sticks — usually much faster  |
| **Direct** | Pull model straight onto the USB.                                              | Nothing extra on host                                            | Tiny host disk; fast USB 3 stick       |

If the host and USB resolve to the same physical device, Fast is auto-skipped (no perf gain, doubles disk use).

Plug the stick into any supported machine, double-click the launcher for that OS. opencode runs in the terminal talking to a USB-local Ollama on `127.0.0.1:11434`. Quitting opencode kills the Ollama process. Nothing is left behind on the host.

## Coding models

Pick one at install time, or add more later with `code-stick add-model`.
**Bigger stick → bigger model.** The picker filters out entries that won't
fit on the USB you selected.

### Curated

| Tier  | Model                  | Ollama tag                 | Size    | Stick / RAM  | Best for                          |
| ----- | ---------------------- | -------------------------- | ------- | ------------ | --------------------------------- |
| small | Phi-3 Mini 3.8B        | `phi3:mini`                | ~2.2 GB | 32 GB / 4 GB | Lightweight, low-spec hardware    |
| small | DeepSeek-Coder 6.7B    | `deepseek-coder:6.7b`      | ~3.8 GB | 32 GB / 8 GB | Debugging, 80+ languages          |
| small | Qwen2.5-Coder 7B ⭐    | `qwen2.5-coder:7b`         | ~4.7 GB | 32 GB / 8 GB | All-rounder for coding            |
| small | CodeGemma 7B           | `codegemma:7b`             | ~5.0 GB | 32 GB / 8 GB | Fill-in-middle, code completion   |
| medium| DeepSeek-Coder-V2 16B  | `deepseek-coder-v2:16b`    | ~8.9 GB | 64 GB / 16 GB| MoE coder, strong on refactors    |
| medium| Qwen2.5-Coder 14B      | `qwen2.5-coder:14b`        | ~9.0 GB | 64 GB / 16 GB| Stronger reasoning + multi-file   |
| large | DeepSeek-Coder 33B     | `deepseek-coder:33b`       | ~19 GB  | 128 GB / 32 GB| Deep reasoning on large codebases|
| large | Qwen2.5-Coder 32B      | `qwen2.5-coder:32b`        | ~20 GB  | 128 GB / 32 GB| Top-tier OSS coder, near-frontier|

The "Stick / RAM" column is **target laptop** RAM — the machine you plug the
USB into. Larger models will technically run with less, but tokens-per-second
drops off a cliff once Ollama spills to disk.

> ⚠ **First-prompt latency on large models.** A 32B model on a USB 3 stick
> can take 30–90 seconds for the first response after launch — Ollama is
> mmap'ing ~20 GB of weights off the USB. Subsequent prompts are fast because
> the OS page-caches the blob.
>
> **USB 2.0 sticks are unusable for medium/large tiers.** A USB 2.0 stick
> tops out at ~30 MB/s read — a 20 GB model would take ~11 minutes just to
> warm up. Use **USB 3.0 or better** (3.2 Gen 1 is the sweet spot) for any
> model >7B. The installer doesn't refuse USB 2 sticks; it just won't be fun.

### Bring your own Ollama tag

**Any tag from [ollama.com/library](https://ollama.com/library) works.**
Pass it directly to `add-model`:

```bash
code-stick add-model qwen2.5-coder:14b
code-stick add-model deepseek-coder-v2:16b
code-stick add-model qwen2.5-coder:32b-instruct-q4_K_M
code-stick add-model llama3.1:70b              # if your stick is huge
```

You'll get a confirmation prompt with the estimated size before the pull
starts (skip with `--yes` for scripts). The curated list above is what we've
tested and what shows up in the interactive picker; the tag escape hatch is
for everything else.

**Rule of thumb on quantization:** `Q4_K_M` is the sane default for code.
Below Q4 quality drops noticeably; above Q4 you get marginal gains for ~50%
more disk.

## Commands

| Command                                  | Description                                                         |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `code-stick install`                     | Set up code-stick on a USB                                          |
| `code-stick start`                       | Start opencode + Ollama from a USB                                  |
| `code-stick status`                      | Show what's installed                                               |
| `code-stick doctor`                      | Live audit (port + Ollama + opencode + model store)                 |
| `code-stick update`                      | Refresh launchers + opencode config                                 |
| `code-stick upgrade-engine`              | Re-download Ollama + opencode without nuking the model store        |
| `code-stick add-model [id]`              | Pull another model onto the stick                                   |
| `code-stick remove-model [id]`           | Remove a model from the stick                                       |
| `code-stick add-targets [list]`          | Add OS targets to a stick installed with `--targets` (restore portability) |
| `code-stick uninstall`                   | Wipe code-stick from the stick (binaries, models, config, launchers)|

### Common flags

```bash
code-stick install --target E:\           # skip USB picker
code-stick install --model phi3-mini      # non-interactive model pick
code-stick install --no-cleanup           # keep archives + temp for debugging
code-stick install --targets host         # only stage binaries for this OS (saves ~3-4 GB, breaks portability)
code-stick install --targets mac,linux    # multi-OS subset (still portable across listed ones)
code-stick add-targets all                # restore full portability later
code-stick add-model qwen25-coder-7b --set-default
code-stick add-model qwen2.5-coder:14b --yes      # raw Ollama tag, skip confirm
code-stick remove-model phi3-mini
code-stick uninstall --target E:\ --yes
```

Available curated model IDs: `phi3-mini`, `deepseek-coder-6_7b`, `qwen25-coder-7b`,
`codegemma-7b`, `qwen25-coder-14b`, `deepseek-coder-v2-16b`, `qwen25-coder-32b`,
`deepseek-coder-33b`. Or pass any raw Ollama tag to `add-model` — see
[Bring your own Ollama tag](#bring-your-own-ollama-tag) above.

### Trimming the stick with `--targets`

**The default is fully portable.** `code-stick install` with no `--targets` flag stages binaries for all 5 OS/arch combinations so the same stick boots anywhere. That's the whole point of the product.

`--targets` is a power-user escape hatch for one specific use case: *"I only want this on my own machine — I'll never plug this stick into another OS."* It saves ~3–4 GB of disk and ~5 minutes of download. In exchange, the stick will only boot on the OSes you list.

Accepted tokens (comma-separated):

| Token | Stages |
| ----- | ------ |
| `all` (default) | all 5 targets — fully portable |
| `host` | just the OS+arch you're installing from |
| `windows` / `mac` / `linux` | every arch in that OS family |
| `windows-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64` | one specific target |

Any value other than `all` prints a loud warning and asks for confirmation (unless `--yes` is set). The chosen subset is persisted in `code-stick.json`, so later you can fill in missing targets without wiping the model store:

```bash
code-stick add-targets darwin-arm64,darwin-x64   # add macOS later
code-stick add-targets all                       # restore full portability
```

`code-stick upgrade-engine` will only refresh the targets actually present on the stick — it never silently grows the set.

## Requirements

- USB free space, depending on the model tier you pick:
  - **small** (7B-class): 8+ GB free
  - **medium** (14B–16B): 16+ GB free
  - **large** (32B–33B): 32+ GB free
- Format **exFAT or NTFS** — FAT32's 4 GB file limit blocks every model
  blob above ~4 GB. The installer detects FAT32 and bails with a clear message.
- Node 20+ on the install machine. Target machines need **nothing**.
- Target laptop RAM: see the "Stick / RAM" column above. Rule of thumb: model
  size × 1.2.

## Troubleshooting

### Windows: `npm install` fails with node-gyp / MSB errors

`drivelist` has native bindings. Without Visual Studio Build Tools the prebuild-install step can fail. Two options:

- Install **Visual Studio Build Tools 2022** with the *Desktop development with C++* workload, then retry.
- Skip auto-detection entirely: `code-stick install --target E:\` does not need `drivelist`. The CLI will warn and fall back to manual path entry on its own if drivelist failed to load.

`drivelist` is declared as an **optional dependency**, so a build failure should not abort `npm install` — it just disables auto-detection.

### macOS: "ollama can't be opened, developer cannot be verified"

Gatekeeper quarantines unsigned binaries that arrived via "external media." We are not yet notarized (notarization needs an Apple Developer Program account — on the roadmap). Until then, the supported workflow on macOS Sonoma+ is:

1. **Right-click `start-mac.command` → Open → Open.** This adds a per-binary exception so future double-clicks work.
2. If the launcher exits with a "translocated to a read-only sandbox" message, that's macOS App Translocation copying the launcher to a randomized scratch mount before run. The right-click-Open ritual above also clears it.
3. As a last resort:
   ```bash
   xattr -dr com.apple.quarantine /Volumes/<your-usb>
   ```

Neither launchers nor `code-stick install` are affected — only the per-machine first-launch dialog. `code-stick doctor` runs the same probes from a CLI context where Gatekeeper does not apply.

### Linux/macOS: "Permission denied" launching from FAT32/exFAT

FAT32 and exFAT cannot store the POSIX `+x` bit, so binaries copied to such a stick lose executability. The installer warns about this at install time. Workaround: invoke launchers via `bash`:

```bash
bash start-linux.sh
bash start-mac.command
```

For long-term use, format the stick as **NTFS** (Windows + Linux) or **APFS/HFS+** (macOS-only) — or **exFAT** if you accept the `bash` workaround for cross-OS use.

### Windows: install aborts with "MAX_PATH risk"

Windows caps individual paths at 260 chars by default. Pre-staged opencode
dependencies live deep under `<USB>\cache\opencode\node_modules\@ai-sdk\
openai-compatible\dist\internal\...`, and a USB mounted at a long path
(e.g. `C:\Users\Long Name\Downloads\code-stick-stage\`) overflows the limit
mid-install. The installer detects this up-front and refuses to start.

Three fixes, in order of preference:

1. **Mount the USB at a short path.** Assign a single drive letter via Disk
   Management, or `subst X: <current-path>` in Command Prompt, then re-run
   with `--target X:\`.
2. **Enable Win10 1607+ long paths system-wide** (PowerShell as Admin):
   ```powershell
   New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem `
     -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
   ```
   Reboot, then re-run the installer.
3. **Re-run from a shorter working directory.** The installer's host-side
   stage dir lives under `%TEMP%`; if your user profile path is itself long,
   point `TMP`/`TEMP` at `C:\t` and retry.

### Ollama port 11434 already in use

Stop your host's Ollama process first. The launchers refuse to start a second instance on the same port.

### Debugging an install

```bash
CODE_STICK_DEBUG=1 code-stick install --target E:\ --no-cleanup
```

`--no-cleanup` keeps `.code-stick-tmp/` and the downloaded archives so you can inspect them.

### Reporting a bug

When `code-stick` crashes it writes a **redacted** report to your OS temp dir
(e.g. `%TEMP%\code-stick\bug-report-install-2026-...md`). The path is printed
to your terminal. The report has your home dir, hostname, USB path, and
common token shapes scrubbed before it is written. Open it, eyeball it, then
attach it to a new issue at
[github.com/MuhammadUsmanGM/code-stick/issues](https://github.com/MuhammadUsmanGM/code-stick/issues).

We do **not** ship telemetry. No background HTTP calls, no auto-reporting.
Bug submission is fully manual and entirely under your control. See
[`docs/SECURITY.md`](docs/SECURITY.md) for the full trust model.

## How it works

```
<USB>/
├── code-stick.json          manifest (v2: multi-model)
├── start-windows.bat        launcher → engine/windows-x64/ollama.exe + opencode
├── start-mac.command        launcher → engine/darwin-{arm64,x64}/...
├── start-linux.sh           launcher → engine/linux-{x64,arm64}/...
├── engine/<target>/         ollama binary per target
├── opencode/<target>/       opencode binary per target
├── data/                    OLLAMA_MODELS — model blobs (OS-agnostic)
└── config/opencode/         opencode.json (XDG_CONFIG_HOME / APPDATA redirect)
```

Launchers spawn `ollama serve` from the USB with `OLLAMA_MODELS=<USB>/data` and `OLLAMA_HOST=127.0.0.1:11434`, redirect opencode's config dir at `<USB>/config`, then run opencode in the foreground. On exit, only the Ollama process they spawned is killed (by PID — never `taskkill /IM ollama.exe`).

## Development

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # vitest run (unit + launcher snapshot tests)
npm run build         # tsup → dist/cli.js
npm run smoke:docker  # full end-to-end install + launch in Linux Docker (needs network)
```

`scripts/smoke.mjs` is a Linux-x64 end-to-end smoke: build → install with
`phi3-mini` (smallest model) → boot Ollama → probe `/api/version` → smoke
`opencode --version`. macOS / Windows smokes need licensed CI runners and
are not part of the default `smoke:docker` flow — run the launcher manually
on each target instead.

## License

MIT — Muhammad Usman ([github.com/MuhammadUsmanGM](https://github.com/MuhammadUsmanGM))
