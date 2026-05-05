# code-stick

> **Portable AI coding agent on a USB drive.** Plug in. Launch [opencode](https://opencode.ai). Code offline.
> One stick boots on **Windows, macOS (Apple Silicon + Intel), Linux (x64 + ARM64)**.

```bash
npx code-stick install
```

The CLI will:

1. Auto-detect your USB drive (or take `--target <path>`)
2. Let you pick a coding model
3. Download Ollama + opencode binaries for **all 5 targets** onto the stick
4. Pull the model into a USB-local Ollama store (`<USB>/data`) — never touches the host
5. Write `start-windows.bat`, `start-mac.command`, `start-linux.sh` at the USB root
6. Clean up installer archives and temp dirs

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
| `code-stick update`                      | Refresh launchers + opencode config                                 |
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

Gatekeeper quarantines binaries that arrived via "external media." The macOS launcher strips the `com.apple.quarantine` xattr automatically before launch. If you somehow still hit the dialog:

```bash
xattr -dr com.apple.quarantine /Volumes/<your-usb>
```

### Linux/macOS: "Permission denied" launching from FAT32/exFAT

FAT32 and exFAT cannot store the POSIX `+x` bit, so binaries copied to such a stick lose executability. The installer warns about this at install time. Workaround: invoke launchers via `bash`:

```bash
bash start-linux.sh
bash start-mac.command
```

For long-term use, format the stick as **NTFS** (Windows + Linux) or **APFS/HFS+** (macOS-only) — or **exFAT** if you accept the `bash` workaround for cross-OS use.

### A model pull was interrupted

Re-run `code-stick add-model <id>` (or `install --model <id>`). Ollama's pull is resumable, and code-stick prunes any `sha256-*-partial` blobs left from the previous attempt before retrying.

### Ollama port 11434 already in use

Stop your host's Ollama process first. The launchers refuse to start a second instance on the same port.

### Debugging an install

```bash
CODE_STICK_DEBUG=1 code-stick install --target E:\ --no-cleanup
```

`--no-cleanup` keeps `.code-stick-tmp/` and the downloaded archives so you can inspect them.

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

## License

MIT — Muhammad Usman ([github.com/MuhammadUsmanGM](https://github.com/MuhammadUsmanGM))
