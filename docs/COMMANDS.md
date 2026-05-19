# Commands and flags

Reference for every `code-stick` subcommand and the flags it accepts. For
the model catalog, see [MODELS.md](MODELS.md). For runtime architecture,
see [ARCHITECTURE.md](ARCHITECTURE.md).

## Subcommands

| Command                          | Description                                                                |
| -------------------------------- | -------------------------------------------------------------------------- |
| `code-stick install`             | Set up code-stick on a USB                                                 |
| `code-stick start`               | Start opencode + Ollama from a USB                                         |
| `code-stick status`              | Show what's installed                                                      |
| `code-stick doctor`              | Live audit (port + Ollama + opencode + model store)                        |
| `code-stick update`              | Refresh launchers + opencode config                                        |
| `code-stick upgrade-engine`      | Re-download Ollama + opencode without nuking the model store               |
| `code-stick add-model [id]`      | Pull another model onto the stick                                          |
| `code-stick remove-model [id]`   | Remove a model from the stick                                              |
| `code-stick add-targets [list]`  | Add OS targets to a stick installed with `--targets` (restore portability) |
| `code-stick uninstall`           | Wipe code-stick from the stick (binaries, models, config, launchers)       |

Press **Esc** at any interactive prompt to step back.

## Common flag examples

```bash
code-stick install --target E:\           # skip USB picker
code-stick install --model phi3-mini      # non-interactive model pick
code-stick install --no-cleanup           # keep archives + temp for debugging
code-stick install --targets host         # only stage binaries for this OS (saves ~3-4 GB, breaks portability)
code-stick install --targets mac,linux    # multi-OS subset (still portable across listed ones)
code-stick add-targets all                # restore full portability later
code-stick add-model qwen25-coder-7b --set-default
code-stick add-model qwen2.5-coder:14b --yes      # raw Ollama tag, skip confirm
code-stick add-model llama3.1:70b --num-ctx 32768 # override context window for a custom tag
code-stick remove-model phi3-mini
code-stick uninstall --target E:\ --yes
```

## Fast vs Direct install

`code-stick install` asks which mode to use after detecting the USB.

| Mode       | What it does                                       | Needs                                                          | Best when                              |
| ---------- | -------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| **Fast**   | Pull model into host temp, then copy blobs to USB. | ~2× model size of free space in `%TEMP%`/`/tmp` (auto-cleaned) | Slow USB sticks — usually much faster  |
| **Direct** | Pull model straight onto the USB.                  | Nothing extra on host                                          | Tiny host disk; fast USB 3 stick       |

If the host and USB resolve to the same physical device, Fast is
auto-skipped (no perf gain, doubles disk use).

## Trimming the stick with `--targets`

USB size planning (especially **8 GB sticks** and the ~4–5 GB cost of all
six Ollama binaries): [`STORAGE.md`](STORAGE.md).

**The default is fully portable.** `code-stick install` with no
`--targets` flag stages binaries for all 6 OS/arch combinations so the
same stick boots anywhere. That's the whole point of the product.

`--targets` is a power-user escape hatch for one specific use case:
*"I only want this on my own machine — I'll never plug this stick into
another OS."* It saves ~5–7 GB of disk and ~10 minutes of download (the
Windows + Linux x64 engine bundles each ship ~2 GB of CUDA/ROCm libs).
In exchange, the stick will only boot on the OSes you list.

Accepted tokens (comma-separated):

| Token                                                                                       | Stages                                  |
| ------------------------------------------------------------------------------------------- | --------------------------------------- |
| `all` (default)                                                                             | all 6 targets — fully portable          |
| `host`                                                                                      | just the OS+arch you're installing from |
| `windows` / `mac` / `linux`                                                                 | every arch in that OS family            |
| `windows-x64`, `windows-arm64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`    | one specific target                     |

The `windows` family token expands to both `windows-x64` and `windows-arm64`
so a single stick boots on commodity Windows hardware *and* Surface Pro /
Snapdragon X Copilot+ PCs. The Windows launcher (`start-windows.bat`)
detects `PROCESSOR_ARCHITECTURE` at runtime and picks the right binary.

Any value other than `all` prints a loud warning and asks for confirmation
(unless `--yes` is set). The chosen subset is persisted in
`code-stick.json`, so later you can fill in missing targets without
wiping the model store:

```bash
code-stick add-targets darwin-arm64,darwin-x64   # add macOS later
code-stick add-targets all                       # restore full portability
```

`code-stick upgrade-engine` will only refresh the targets actually present
on the stick — it never silently grows the set.

## Per-command flags worth knowing

Every subcommand accepts `-t, --target <path>` to skip the USB picker. The
flags below are the non-obvious ones — full options surface via
`code-stick <subcommand> --help`.

### `doctor`

- `--no-probe` — skip the live `ollama serve` / `opencode --version`
  probes and run static checks only. Useful for offline diagnosis or when
  port 11434 is already in use by something you don't want to touch.

### `remove-model [id]`

- `--force` — allow removing the last installed model, or the current
  default model. Without `--force`, code-stick refuses to leave the stick
  in a broken state. The stick will be unusable until you `add-model`
  something new.

### `uninstall`

- `--force` — proceed even if no `code-stick.json` manifest is detected
  at the target. Use this only when a previous install crashed mid-write
  and left the stick in a partial state.

### `add-model [id-or-tag]`

- `--set-default` — make the newly pulled model the default the launcher
  and opencode will use.
- `--num-ctx <n>` — override the baked context window (tokens) for a
  custom Ollama tag. Curated tags use a tuned per-model value
  automatically; this flag only applies to raw tags passed via
  `add-model <tag>`. Default for custom tags: 8192.

## opencode version pinning

`install` and `upgrade-engine` accept `--opencode-version <ver>` to swap
in a non-default opencode release. Non-default versions are not SHA-pinned
and require `CODE_STICK_ALLOW_UNVERIFIED=1` to download.

```bash
code-stick install --opencode-version v0.4.20
CODE_STICK_ALLOW_UNVERIFIED=1 code-stick upgrade-engine --opencode-version v0.4.20
```

## Environment variables

| Variable                       | Effect                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `CODE_STICK_DEBUG=1`           | Print the full untruncated stack trace on crash; verbose extractor logging during install.   |
| `CODE_STICK_ALLOW_UNVERIFIED=1`| Allow `--opencode-version <ver>` to download a release whose SHA is not pinned in code-stick.|

Both are off by default — set them only when you need them.

## Where launchers come from

`code-stick install`, `code-stick update`, and `code-stick upgrade-engine`
all (re-)write `start-windows.bat`, `start-mac.command`, and
`start-linux.sh` at the USB root. Those launchers live on the stick — you
do not need `code-stick` installed on the target machine to launch.

`code-stick start` is the host-side equivalent: it runs from the
**install machine** (where node + the `code-stick` CLI live) and starts
opencode + Ollama against a connected USB. Useful when you don't want to
mount-and-double-click for every test cycle during development. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the runtime details.
