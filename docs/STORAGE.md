# Storage and download sizing

code-stick writes three big things onto the USB: **engine binaries** (Ollama +
opencode, per OS/arch), **model weights** (`data/`), and a small **config**
tree. This guide is about planning free space before you run
`code-stick install`.

For flag syntax, see [COMMANDS.md](COMMANDS.md#trimming-the-stick-with---targets).
For model sizes, see [MODELS.md](MODELS.md).

## What the default install downloads

With **no** `--targets` flag, the installer stages **all six** platform
trees so the same stick boots on Windows (x64 + ARM64), macOS (Apple Silicon +
Intel), and Linux (x64 + ARM64):

| Component | Count on stick | Approx. size |
| --------- | -------------- | -------------- |
| Ollama archives (extracted) | 6 | **~4–5 GB** |
| opencode archives (extracted) | 6 | **~0.5–1 GB** |
| **Binaries total** | | **~5–7 GB** |

The Windows and Linux **x64** bundles are the heavy ones — each ships large
CUDA/ROCm runtime libraries inside the Ollama zip. macOS and ARM64 trees are
smaller, but you still pay for every target you stage.

On top of binaries you need:

- **Model blob(s)** — see the Size column in [MODELS.md](MODELS.md) (~2.2 GB
  for Phi-3 Mini up to ~20 GB for 32B tiers).
- **~1 GB headroom** — manifest, launchers, opencode config, temp files during
  install, and filesystem overhead.

## USB size cheat sheet

Formatted capacity is always less than the label (an “8 GB” stick is usually
**~7.2–7.5 GB** usable). Plan on the **usable** number, not the marketing size.

| USB label | Default install (all 6 targets) | Recommended approach |
| --------- | --------------------------------- | -------------------- |
| **8 GB** | **Does not fit** for a usable stick | **`--targets host`** + smallest model (`phi3-mini`, ~2.2 GB). See below. |
| **16 GB** | Tight; only small models with full portability | Full portable + Phi-3 or DeepSeek 6.7B; or `--targets host` + Qwen 7B if you only use one machine. |
| **32 GB** | Comfortable default | Full portable + **Qwen2.5-Coder 7B** (recommended default). |
| **64 GB+** | Room for medium tiers or multiple models | Full portable + 14B/16B class models; see [MODELS.md](MODELS.md). |

## 8 GB sticks: use `--targets host`

An 8 GB USB **cannot** hold a useful code-stick if you install the default
**all-target** engine set:

```
~5–7 GB  binaries (6× Ollama + 6× opencode)
+ ~2 GB  smallest model (phi3-mini)
+ ~1 GB  headroom
≈ 8–10 GB  → over capacity before you finish
```

The install may start, but you will run out of space during download or model
pull, or you will have almost no free space left for updates and extra models.

**Do this instead** on 8 GB:

```bash
code-stick install --targets host --model phi3-mini
```

`host` stages **only** the OS + CPU architecture you are installing from
(for example `windows-x64` on a typical Windows laptop). That cuts the binary
footprint to roughly **one** Ollama tree and **one** opencode tree (~1–2 GB
total, depending on platform) instead of six.

Trade-off: the stick **only boots on that OS/arch**. Plugging it into another
machine (Mac, Linux, 32-bit Windows, ARM64 Surface without the ARM64 tree,
etc.) will not work until you add targets:

```bash
code-stick add-targets all          # restore full portability later (needs free space)
code-stick add-targets darwin-arm64 # add one family at a time
```

You will get a confirmation prompt when `--targets` is not `all` (unless you
pass `--yes`).

## Examples by scenario

**Smallest usable stick (8 GB, single Windows PC):**

```bash
code-stick install --target E:\ --targets host --model phi3-mini --yes
```

**Full portability on 32 GB (default product behavior):**

```bash
code-stick install --target E:\ --model qwen25-coder-7b
```

**Two OS families, not all six arches (saves space vs `all`):**

```bash
code-stick install --targets windows,mac --model phi3-mini
```

## Other space gotchas

**Installer model picker.** The UI now reserves a **target-aware** binary
budget when greying out models — roughly **~1–2 GB** for `--targets host`,
and **~5–7 GB** for the default six-target install (Windows + Linux x64 each
ship ~1.6 GB of CUDA/ROCm libs; ARM64 + macOS land smaller). The picker
prints the exact number for your selection. If you still want to triple-check
fit on a small USB, use the cheat sheet above.

**Fast install mode** needs extra **temporary** space on the **install
machine** (~2× model size in `%TEMP%` / `/tmp`). It does not change how much
ends up on the USB. **Direct** uses host temp for Ollama pull scratch and
deletes each engine archive from the stick right after extract. See
[COMMANDS.md](COMMANDS.md#fast-vs-direct-install).

**FAT32** is rejected for models above ~4 GB (single-file limit). Use **exFAT**
or **NTFS**. See [README.md](../README.md#requirements).

**Adding models later** — each `code-stick add-model` adds another full model
blob under `data/`. `code-stick remove-model` frees that space.

**Upgrading engines** — `code-stick upgrade-engine` re-downloads only the
targets already on the stick; it does not silently add missing OS trees.

## Quick reference

| Goal | Command |
| ---- | ------- |
| Minimum binary footprint | `code-stick install --targets host` |
| Default (fully portable) | `code-stick install` (no `--targets`) |
| Add portability later | `code-stick add-targets all` |
| Check what is on the stick | `code-stick status` / `code-stick doctor` |
