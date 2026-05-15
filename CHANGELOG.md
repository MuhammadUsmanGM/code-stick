<!-- Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-c4l3-log0 -->

# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

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
