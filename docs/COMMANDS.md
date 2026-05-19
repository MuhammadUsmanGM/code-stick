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

**The default is fully portable.** `code-stick install` with no
`--targets` flag stages binaries for all 5 OS/arch combinations so the
same stick boots anywhere. That's the whole point of the product.

`--targets` is a power-user escape hatch for one specific use case:
*"I only want this on my own machine — I'll never plug this stick into
another OS."* It saves ~3–4 GB of disk and ~5 minutes of download. In
exchange, the stick will only boot on the OSes you list.

Accepted tokens (comma-separated):

| Token                                                                  | Stages                                  |
| ---------------------------------------------------------------------- | --------------------------------------- |
| `all` (default)                                                        | all 5 targets — fully portable          |
| `host`                                                                 | just the OS+arch you're installing from |
| `windows` / `mac` / `linux`                                            | every arch in that OS family            |
| `windows-x64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`| one specific target                     |

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

## opencode version pinning

`install` and `upgrade-engine` accept `--opencode-version <ver>` to swap
in a non-default opencode release. Non-default versions are not SHA-pinned
and require `CODE_STICK_ALLOW_UNVERIFIED=1` to download.

```bash
code-stick install --opencode-version v0.4.20
CODE_STICK_ALLOW_UNVERIFIED=1 code-stick upgrade-engine --opencode-version v0.4.20
```
