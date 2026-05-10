<!-- Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-c4l3-log0 -->

# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

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
