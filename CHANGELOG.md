<!-- Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-c4l3-log0 -->

# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## Unreleased

### Added
- **Windows ARM64 target support.** Surface Pro 11, Surface Laptop 7, and
  Snapdragon X Copilot+ PCs now boot natively from the stick — no Prism
  emulation required. The Windows launcher (`start-windows.bat`) runtime-
  detects `PROCESSOR_ARCHITECTURE` and selects the right binary directory
  (`engine/windows-arm64/` or `engine/windows-x64/`). A fallback path keeps
  ARM64 hosts working under x64 emulation if only the x64 target was staged.
  This brings the supported matrix from 5 to 6 targets:
  windows-x64, **windows-arm64**, darwin-arm64, darwin-x64, linux-x64,
  linux-arm64. Ollama pinned at v0.21.2 for both Windows variants;
  opencode pinned at v1.15.4 with verified SHA256.

## 0.2.1

### Fixed
- **Context window too small — models hallucinating tool calls and ignoring
  instructions.** Ollama's server default is 2048 tokens, which is smaller
  than opencode's system prompt plus tool definitions alone (~3–4k tokens).
  Without an explicit override the prompt was silently truncated and models
  would invent tool calls or drift off-task. Every catalog model now gets a
  per-tag `num_ctx` baked in immediately after `ollama pull` (e.g. 32k for
  Qwen2.5-Coder, 16k for DeepSeek-Coder, 8k for phi3-mini at its native RoPE
  limit). Existing sticks can pick up the fix without re-downloading weights
  via `code-stick upgrade-engine`, which rebakes all installed models in place.

### Added
- **`--num-ctx <n>` on `code-stick add-model`.** Override the baked context
  window when pulling a custom Ollama tag (e.g.
  `code-stick add-model llama3.1:70b --num-ctx 32768`).
- **`rebakeAllModels` during `upgrade-engine`.** Walks models listed in the
  stick manifest and re-runs `ollama create … PARAMETER num_ctx …` for each,
  using catalog defaults or the value stored at install time.
- **`numCtx` on `CodingModel`.** Each catalog entry declares a sane native
  context limit instead of a one-size-fits-all tier bucket.
- **Docs: `docs/ARCHITECTURE.md`, `docs/COMMANDS.md`, `docs/MODELS.md`,
  `docs/TROUBLESHOOTING.md`.** Architecture overview, per-command flags and
  usage, model tiers and context guidance, and a troubleshooting playbook
  (including the hallucination / context-window symptom). README trimmed and
  linked to these guides; command table now lists `update` and `add-targets`.


## 0.2.0

### Fixed
- **opencode `DecimalError` on Qwen models — resolved by upgrading to v1.15.4.**
  The previous bundled opencode (`v0.4.18`, from the now-archived
  `opencode-ai/opencode` repo) crashed mid-stream parsing Qwen response token
  counts as `Decimal`. The fix lives upstream in `sst/opencode` v1.x, which
  explicitly "tolerated legacy stored numeric values in sessions, diffs, retry
  events" and "fixed old sessions with negative token counts causing message
  loads to fail." code-stick now bundles `v1.15.4`; existing sticks can pull
  the new binary in place via `code-stick upgrade-engine` without touching
  the model store.

### Changed
- **Bundled opencode bumped `v0.4.18` → `v1.15.4`.** Source repo switched from
  the archived `opencode-ai/opencode` to the actively-maintained `sst/opencode`.
  Linux assets now ship as `.tar.gz` instead of `.zip` (extractor already
  handled both — no path changes for users).
- **`upgrade-engine` re-pre-stages opencode providers on every run.** Previous
  versions left provider pre-staging to `install` only, which created a gap on
  the v0.4 → v1.x boundary: the old `@ai-sdk/openai-compatible` `node_modules`
  could survive a binary swap. `upgrade-engine` now wipes the provider cache
  when crossing the v0.x → v1.x major boundary, then re-prestages cleanly so
  v1.x first-launch doesn't reach out to npm.
- **`code-stick doctor` warns on legacy opencode versions.** Sticks whose
  manifest reports `v0.3.x` or `v0.4.x` opencode now get a yellow warning with
  the upgrade-engine remedy inline, surfacing the DecimalError fix path
  proactively instead of waiting for the user to hit the bug.
- **`opencode.json` now declares `tools: true` per model.** Required by the
  v1.x provider schema; ignored by older v0.4.x binaries so a stick caught
  mid-upgrade still launches.

### Internal
- Doctor's `/api/tags` env-var check now receives the manifest as an
  argument — previously referenced an out-of-scope `manifest` symbol that
  would have thrown at runtime. Pre-existing bug from the v0.1.1 launcher
  fix, surfaced by typecheck during the v1.x catalog edits.


## 0.1.3

### Fixed
- **`OLLAMA_MODELS` not passed to spawned Ollama on Windows (launcher bug).**
  The previous Windows launcher used `$env:X = Y` before `Start-Process`, which
  fails silently when the USB mount path contains spaces — the string was
  interpolated unquoted inside the PowerShell command so anything after the
  first space was dropped. The spawned `ollama serve` process started pointing
  at `%HOMEPATH%\.ollama` instead of the USB `data/` directory, so no models
  were visible. Fixed by building a full environment hashtable from the current
  process environment and overriding `OLLAMA_MODELS` and `OLLAMA_HOST` inside
  it before calling `Start-Process` (`[System.Environment]::GetEnvironmentVariables()`
  + explicit key override), making the injection space-safe and robust.

- **exFAT USB compatibility — `@ai-sdk/openai-compatible` install failure.**
  `npm install --bin-links=false` only suppresses `.bin/` directory symlinks.
  npm's default hoisting algorithm still creates `node_modules` symlinks for
  nested packages, which fail silently on exFAT/FAT32 filesystems that cannot
  store POSIX symlinks. Added `--install-strategy=nested` (npm 9+) to force a
  fully nested, symlink-free install tree. npm <9 silently ignores the unknown
  flag, so the argument is safe to pass unconditionally across npm versions.

- **opencode `DecimalError` when parsing Qwen model responses (known upstream
  issue).** opencode v0.4.18 (and all v0.4.x releases) contain an upstream bug
  where Qwen models return token usage counts as floating-point numbers
  (e.g. `1.5`) that the opencode stream parser tries to coerce into a
  `Decimal`; the coercion fails on non-integer values and crashes the session.
  **Status**: confirmed not fixed in v0.4.18. The `sst/opencode` project has
  since moved to `anomalyco/opencode` and rebranded as a v1.x Electron+TUI
  app with a materially different binary structure — a direct upgrade path from
  code-stick's v0.4.x terminal-binary integration is not yet validated.
  **Workaround**: models with a smaller number of parameter quantisation
  levels (e.g. `qwen2.5-coder:7b-instruct-q4_K_M`) trigger the bug less
  frequently than higher-quant variants; using `deepseek-coder-v2:16b`
  as an alternative avoids the error entirely. A validated opencode engine
  upgrade path will be tracked in a follow-up release.

## 0.1.2

### Added
- **Medium + large model tiers in the curated catalog.** 64 GB sticks can now
  pick Qwen2.5-Coder 14B or DeepSeek-Coder-V2 16B; 128 GB sticks can pick
  Qwen2.5-Coder 32B or DeepSeek-Coder 33B. Curated entries gained `tier`
  (`small`/`medium`/`large`) and `recommendedRAMGB` so the picker and README
  can warn about target-laptop RAM, not just USB size.
- **`code-stick add-model <ollama-tag>` — bring your own model.** The
  command now accepts an arbitrary Ollama tag (e.g. `qwen2.5-coder:14b`,
  `deepseek-coder-v2:16b`, `llama3.1:70b`) in addition to curated ids.
  Loud confirm gate by default, suppressible with `--yes`. Tag-derived
  manifest ids are prefixed `custom-` so `status` / `remove-model` can
  tell curated from BYO at a glance. Tag validation rejects whitespace,
  control chars, and shell metacharacters before any spawn.
- **Free-space-aware install picker.** The model picker now stats the
  selected USB and disables entries that wouldn't fit (with a "needs X GB
  more" annotation) instead of letting the user pick a model they can't
  install. The dedicated space-check step still gets the final word.
- **`docs/TRUST.md`** — a high-level overview of the project's security and
  privacy pillars (Zero Residue, 100% Offline, Privacy-Preserving Bug Reports,
  Binary Integrity, and Transparency).
- README: rewritten "Coding models" section with size tiers, target-laptop
  RAM column, first-prompt-latency caveat for 32B models, and an explicit
  "bring your own Ollama tag" subsection.

### Fixed
- **exFAT compatibility for opencode providers.** The installer now uses
  `--bin-links=false` during `npm install` to avoid symlink errors on FAT32
  and exFAT USB sticks.
- **Robust `OLLAMA_MODELS` passing on Windows.** The Windows launcher now
  explicitly injects environment variables into the PowerShell spawn command,
  ensuring the Ollama process correctly inherits the USB model store path.
- **Improved `code-stick doctor` validation.** The doctor now hits Ollama's
  `/api/tags` endpoint to verify that the server can actually see the models
  on the USB, providing empirical proof of correct environment variable
  linkage.
- Install + add-model pickers no longer scroll the visible window when the
  list is longer than inquirer's 7-row default — render the full list at
  once (`pageSize: choices.length`, `loop: false`) so up/down moves the
  cursor in a static list.

### Internal
- `src/catalog/models.ts`: new helpers `isPlausibleOllamaTag` and
  `tagToCustomId`, plus the optional `tier` / `recommendedRAMGB` fields on
  `CodingModel`.
- `src/commands/add-model.ts`: factored argument-resolution into
  `resolveModelArg` + `resolveCustomTag`; size estimation for unknown tags
  derived from the `:Nb` parameter suffix.
- `--yes` flag wired through to `add-model` in `cli.ts`.
- `test/models.test.ts` (24 new cases) covering tag validation, id slugging,
  custom-tag size estimation, and catalog invariants (unique ids/tags,
  tier→sizeGB consistency).
- `package.json` keywords: dropped model-specific names (qwen, deepseek,
  codegemma, phi3) that bitrot as the catalog evolves; added durable
  concept keywords (airgapped, local-llm, byo-model, self-hosted, privacy).

## 0.1.1

### Fixed
- **EPERM symlink crash on Windows.** `code-stick install` no longer aborts
  with `EPERM: operation not permitted, symlink ...` when extracting the
  macOS or Linux Ollama tarballs on a Windows host without Developer Mode /
  admin rights. The extractor now probes the destination filesystem for
  POSIX symlink support up front (`hostCanSymlink`) and falls back to
  materializing tarball symlinks / hardlinks as regular file copies of
  their target's bytes. The runtime on the eventual target OS doesn't
  care — upstream uses symlinks purely as space-saving aliases — and the
  fix also unblocks installs to FAT32/exFAT USBs that can't store symlinks
  at all, regardless of host OS. ([#open issue: EPERM symlink darwin-arm64])
- `extract.ts`: deferred-link resolver runs multi-pass to handle
  link-to-link chains, and rejects link targets that resolve outside the
  extraction sandbox (path-traversal hardening preserved).
- `extractTarFile` now sets `noChmod: true` on Win32 + `preserveOwner: false`
  to skip per-entry stat work that's never useful on Windows.

### Added
- `code-stick install --targets <list>` flag — power-user escape hatch for
  reduced-portability installs. Tokens: `all` (default, fully portable),
  `host`, OS families (`windows`/`mac`/`linux`), or explicit Target IDs.
  Default behavior is unchanged: the stick stages all 5 OS/arch targets.
  Any subset prints a loud non-portability banner and (in interactive
  runs) asks for confirmation.
- `code-stick add-targets [list]` command — add OS targets to a stick
  that was installed with `--targets`. Diffs requested vs installed,
  downloads only the missing targets, and merges them into the live
  engine/opencode trees without touching the model store or existing
  targets. Run `code-stick add-targets all` to restore full portability.
- `code-stick.json` now persists `targets: Target[]`. `upgrade-engine`
  scopes refreshes to that subset rather than silently growing the set.
- Symlink-capability preflight: every command that extracts tarballs
  (`install`, `upgrade-engine`, `add-targets`) prints a one-line notice
  up front telling the user whether native symlinks or the copy fallback
  will be used.
- `test/targets.test.ts` (20 cases) + `test/extract-symlink.test.ts`
  (4 cases) + 2 new launcher subset cases.
- README: "Trimming the stick with `--targets`" section and a new
  Troubleshooting entry covering the symlink fallback.

### Internal
- `stageAndSwapBinaries(drivePath, tempDir, targets)` now accepts a
  subset; partial runs merge per-target into the live tree via
  `mergeStagedTargets` instead of replacing the whole engine/opencode
  directory. Full-set runs (default install) keep the original atomic
  full-tree swap behavior for crash safety.
- `renderLaunchers` skips writing `.bat` / `.command` / `.sh` files for
  OS families not present in the staged target set.

### Added
- Cross-OS GitHub Actions matrix CI (`.github/workflows/ci.yml`) — typecheck,
  build, vitest, launcher-snapshot, and pack-shape jobs run on
  ubuntu-latest, macos-latest, windows-latest on every PR.
- Nightly catalog drift detector (`.github/workflows/catalog-drift.yml`) —
  re-fetches every pinned binary URL daily and opens a tracking issue on
  sha256 drift.
- Tag-triggered publish workflow (`.github/workflows/publish.yml`) with npm
  provenance via Sigstore + GitHub OIDC.
- Stronger `scripts/verify-publish.mjs`: now runs `npm pack --dry-run` and
  asserts the tarball file set + size sanity. Wired into the
  `prepublishOnly` hook.
- Local-only redacted bug report on uncaught CLI errors
  (`src/utils/bug-report.ts`). No telemetry — the report is written to OS
  temp dir and the user attaches it to a GitHub issue manually.
- `docs/COMPATIBILITY.md` — pinned version matrix for ollama + opencode +
  code-stick across the five targets.
- `docs/SECURITY.md` — explicit trust model + threat list.
- `docs/MACOS-NOTARIZATION.md` — runbook for Apple Developer enrollment +
  signing pipeline (blocker for 1.0).
- `docs/BETA-PLAN.md` — recruiting + acceptance criteria for the pre-1.0
  external beta.
- `docs/RELEASE.md` — release runbook + 1.0-only pre-flight gates.
- `.github/ISSUE_TEMPLATE/{bug_report,beta_feedback}.md` — structured
  reporting templates.

### Fixed
- `test/usb.test.ts` POSIX-path tests now skip on Windows hosts (path.resolve
  is platform-bound regardless of `process.platform` mock). Surfaced by the
  new CI matrix.

## 0.1.0 — initial public preview

See git history for itemized 0.1 work.
