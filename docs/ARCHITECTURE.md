# Architecture

How code-stick lays out a USB and what runs at launch time.

## Stick layout

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

- `engine/` and `opencode/` hold per-target binaries — five trees on a
  fully portable stick. Each tree is independent; a stick trimmed with
  `--targets host` only contains one.
- `data/` is the Ollama model store. Format is OS-agnostic (sha256 blob
  files + JSON manifests), so the same blobs serve Windows, macOS, and
  Linux launches without re-downloading.
- `config/opencode/opencode.json` is opencode's normal config file —
  launchers redirect `XDG_CONFIG_HOME` (POSIX) and `APPDATA` (Windows) to
  `<USB>/config` so opencode reads it from the stick instead of the host.

## Runtime behavior

Each launcher does the same four things in order:

1. **Spawn `ollama serve`** from `<USB>/engine/<target>/ollama[.exe]`
   with `OLLAMA_MODELS=<USB>/data` and `OLLAMA_HOST=127.0.0.1:11434`. The
   server binds only to loopback — no exposure to the network.
2. **Wait for Ollama** to respond on `/api/version` (45 s health-check
   window).
3. **Redirect opencode's config dir** at `<USB>/config` via the env vars
   above, then run opencode in the foreground.
4. **On exit, kill only the Ollama process the launcher spawned** — by
   PID, never `taskkill /IM ollama.exe`. A host-installed Ollama is
   untouched.

The launcher tracks its child by PID. If it crashes, a stale `ollama
serve` can survive on port 11434 — `code-stick doctor` detects this and
prints the PID to kill manually.

## Why a temp Ollama during install / add-model

`code-stick install`, `code-stick add-model`, and `code-stick
upgrade-engine` all need to interact with Ollama (pull blobs, bake
`num_ctx`, list models) but the launcher's Ollama process isn't running
yet. They each spin up a **temporary Ollama server** pointed at the
stick's `data/` directory, run the needed subcommands, and tear it down
when finished. Same loopback-only safety as the launcher.

The temp server is registered with the process manager so SIGINT /
unexpected exit tears it down via tree-kill + grace period — orphaned
`ollama serve` processes never outlive the installer.

## Process isolation guarantees

- **Network:** Ollama binds only to `127.0.0.1:11434`. No outbound
  connections after install (model pulls happen at install time, not at
  run time).
- **Host filesystem:** opencode and Ollama read/write only within
  `<USB>/`. They never touch `~/.ollama` or the host's opencode config.
- **Exit:** The launcher kills only the Ollama PID it spawned. A
  host-installed Ollama on a different port stays running.
- **Residue:** Nothing is written to the host after exit. Pull the stick
  and the host has no record code-stick ever ran.

See [SECURITY.md](SECURITY.md) for the full trust model and threat
boundaries.
