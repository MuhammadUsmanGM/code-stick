# code-stick

> **Portable AI coding agent on a USB drive.** Plug in. Launch opencode. Code offline.
> Works on **Windows, macOS (Apple Silicon + Intel), and Linux (x64 + ARM64)** from a single stick.

```bash
npx code-stick install
```

That's it. The CLI will:

1. Detect your USB drive
2. Let you pick a coding model
3. Download Ollama + opencode binaries for **all four target OSes** to the USB
4. Pull the model into the USB-local Ollama store
5. Generate launcher scripts: `start-windows.bat`, `start-mac.command`, `start-linux.sh`
6. Clean up installer archives and temp cruft

After setup, plug the USB into any supported machine and double-click the launcher for that OS. opencode runs in your terminal, talking to a USB-local Ollama. Nothing touches the host.

## Coding models (pick one at install time)

| Model                | Ollama tag             | Size    | Best for                                |
| -------------------- | ---------------------- | ------- | --------------------------------------- |
| Qwen2.5-Coder 7B ⭐  | `qwen2.5-coder:7b`     | ~4.7 GB | All-rounder for coding (recommended)    |
| DeepSeek-Coder 6.7B  | `deepseek-coder:6.7b`  | ~3.8 GB | Debugging, 80+ languages                |
| CodeGemma 7B         | `codegemma:7b`         | ~5.0 GB | Fill-in-middle, code completion         |
| Phi-3 Mini 3.8B      | `phi3:mini`            | ~2.2 GB | Lightweight, low-spec hardware          |

## Commands

| Command                        | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `npx code-stick install`       | Set up code-stick on a USB drive               |
| `npx code-stick start`         | Start opencode + Ollama from a USB drive       |
| `npx code-stick status`        | Show what's installed                          |
| `npx code-stick update`        | Update Ollama and opencode binaries            |

### Options

```bash
npx code-stick install --target E:
npx code-stick start --path E:
```

## Requirements

- A USB drive with **at least 8 GB free** (more for larger models)
- USB formatted as **exFAT or NTFS** (FAT32 cannot store the model blob — install will warn)
- Node 20+ on the install machine (`npx` will fetch it). The target machines need **nothing** installed.

## License

MIT — Muhammad Usman ([MuhammadUsmanGM](https://github.com/MuhammadUsmanGM))
