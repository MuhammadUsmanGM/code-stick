# Coding models

Pick one at install time, or add more later with `code-stick add-model`.
**Bigger stick → bigger model.** The picker filters out entries that won't
fit on the USB you selected.

## Curated

| Tier  | Model                  | Ollama tag                 | Size    | Stick / RAM    | Best for                          |
| ----- | ---------------------- | -------------------------- | ------- | -------------- | --------------------------------- |
| small | Phi-3 Mini 3.8B        | `phi3:mini`                | ~2.2 GB | 32 GB / 4 GB   | Lightweight, low-spec hardware    |
| small | DeepSeek-Coder 6.7B    | `deepseek-coder:6.7b`      | ~3.8 GB | 32 GB / 8 GB   | Debugging, 80+ languages          |
| small | Qwen2.5-Coder 7B ⭐    | `qwen2.5-coder:7b`         | ~4.7 GB | 32 GB / 8 GB   | All-rounder for coding            |
| small | CodeGemma 7B           | `codegemma:7b`             | ~5.0 GB | 32 GB / 8 GB   | Fill-in-middle, code completion   |
| medium| DeepSeek-Coder-V2 16B  | `deepseek-coder-v2:16b`    | ~8.9 GB | 64 GB / 16 GB  | MoE coder, strong on refactors    |
| medium| Qwen2.5-Coder 14B      | `qwen2.5-coder:14b`        | ~9.0 GB | 64 GB / 16 GB  | Stronger reasoning + multi-file   |
| large | DeepSeek-Coder 33B     | `deepseek-coder:33b`       | ~19 GB  | 128 GB / 32 GB | Deep reasoning on large codebases |
| large | Qwen2.5-Coder 32B      | `qwen2.5-coder:32b`        | ~20 GB  | 128 GB / 32 GB | Top-tier OSS coder, near-frontier |

The "Stick / RAM" column is **target laptop** RAM — the machine you plug
the USB into. Larger models will technically run with less, but
tokens-per-second drops off a cliff once Ollama spills to disk.

## Latency and USB speed

> ⚠ **First-prompt latency on large models.** A 32B model on a USB 3 stick
> can take 30–90 seconds for the first response after launch — Ollama is
> mmap'ing ~20 GB of weights off the USB. Subsequent prompts are fast
> because the OS page-caches the blob.

> ⚠ **USB 2.0 sticks are unusable for medium/large tiers.** A USB 2.0
> stick tops out at ~30 MB/s read — a 20 GB model would take ~11 minutes
> just to warm up. Use **USB 3.0 or better** (3.2 Gen 1 is the sweet spot)
> for any model >7B. The installer doesn't refuse USB 2 sticks; it just
> won't be fun.

## Context windows

code-stick v0.2.1+ bakes a per-model `num_ctx` into every pulled tag so
opencode's system prompt + tool definitions are never truncated. Values
are sized to each model's native training range:

| Model family       | Baked `num_ctx` |
| ------------------ | --------------- |
| qwen2.5-coder      | 32768           |
| deepseek-coder     | 16384           |
| deepseek-coder-v2  | 16384           |
| codegemma          | 8192            |
| phi3-mini          | 8192            |
| custom / unknown   | 8192 (default)  |

You can override per-pull for raw tags with `--num-ctx <n>` on
`code-stick add-model`. See
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#model-hallucinates-or-invents-tool-calls)
for the bug this fixes.

## Bring your own Ollama tag

**Any tag from [ollama.com/library](https://ollama.com/library) works.**
Pass it directly to `add-model`:

```bash
code-stick add-model qwen2.5-coder:14b
code-stick add-model deepseek-coder-v2:16b
code-stick add-model qwen2.5-coder:32b-instruct-q4_K_M
code-stick add-model llama3.1:70b              # if your stick is huge
```

You'll get a confirmation prompt with the estimated size before the pull
starts (skip with `--yes` for scripts). The curated list above is what
we've tested and what shows up in the interactive picker; the tag escape
hatch is for everything else.

## Quantization

**Rule of thumb:** `Q4_K_M` is the sane default for code. Below Q4 quality
drops noticeably; above Q4 you get marginal gains for ~50% more disk.

## Available curated model IDs

For `--model <id>` flags and `code-stick add-model <id>`:

`phi3-mini`, `deepseek-coder-6_7b`, `qwen25-coder-7b`, `codegemma-7b`,
`qwen25-coder-14b`, `deepseek-coder-v2-16b`, `qwen25-coder-32b`,
`deepseek-coder-33b`.

Or pass any raw Ollama tag to `add-model` — see [Bring your own Ollama
tag](#bring-your-own-ollama-tag) above.
