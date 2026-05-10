# code-stick

> **Portable AI coding agent on a USB drive.** Plug in. Launch [opencode](https://opencode.ai). Code offline.
> One stick boots on **Windows, macOS (Apple Silicon + Intel), Linux (x64 + ARM64)**.

```bash
npx code-stick install
```

The CLI will:

1. Auto-detect your USB drive (or take `--target <path>`)
2. Let you pick a coding model
3. Ask **Fast vs Direct** install mode (see below)
4. Download Ollama + opencode binaries for **all 5 targets** onto the stick
5. Pull the model into a USB-local Ollama store (`<USB>/data`) — host temp is auto-cleaned
6. Write `start-windows.bat`, `start-mac.command`, `start-linux.sh` at the USB root
7. Clean up installer archives and temp dirs

Press **Esc** at any prompt to step back.

### Fast vs Direct install

| Mode       | What it does                                                                   | Needs                                                            | Best when                              |
| ---------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| **Fast**   | Pull model into host temp, then copy blobs to USB.                             | ~2× model size of free space in `%TEMP%`/`/tmp` (auto-cleaned)   | Slow USB sticks — usually much faster  |
| **Direct** | Pull model straight onto the USB.                                              | Nothing extra on host                                            | Tiny host disk; fast USB 3 stick       |

If the host and USB resolve to the same physical device, Fast is auto-skipped (no perf gain, doubles disk use).

Plug the stick into any supported machine, double-click the launcher for that OS. opencode runs in the terminal talking to a USB-local Ollama on `127.0.0.1:11434`. Quitting opencode kills the Ollama process. Nothing is left behind on the host.

## Coding models

Pick one at install time. Add more later with `code-stick add-model`.

| Model                | Ollama tag             | Size    | Best for                                |
| -------------------- | ---------------------- | ------- | --------------------------------------- |
| Qwen2.5-Coder 7B ⭐  | `qwen2.5-coder:7b`     | ~4.7 GB | All-rounder for coding (recommended)    |
| DeepSeek-Coder 6.7B  | `deepseek-coder:6.7b`  | ~3.8 GB | Debugging, 80+ languages                |
| CodeGemma 7B         | `codegemma:7b`         | ~5.0 GB | Fill-in-middle, code completion         |
| Phi-3 Mini 3.8B      | `phi3:mini`            | ~2.2 GB | Lightweight, low-spec hardware          |

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
| `code-stick uninstall`                   | Wipe code-stick from the stick (binaries, models, config, launchers)|

### Common flags

```bash
code-stick install --target E:\           # skip USB picker
code-stick install --model phi3-mini      # non-interactive model pick
code-stick install --no-cleanup           # keep archives + temp for debugging
code-stick add-model qwen25-coder-7b --set-default
code-stick remove-model phi3-mini
code-stick uninstall --target E:\ --yes
```

Available model IDs: `qwen25-coder-7b`, `deepseek-coder-6_7b`, `codegemma-7b`, `phi3-mini`.

## Requirements

- USB with **8+ GB free** (more for larger models)
- Format **exFAT or NTFS** — FAT32's 4 GB file limit blocks Qwen and CodeGemma blobs (the installer detects this and bails with a clear message)
- Node 20+ on the install machine. Target machines need **nothing**.

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
