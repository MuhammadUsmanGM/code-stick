<!-- Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-sec-doc-01 -->

# code-stick — Security & Trust Model

This document describes what code-stick does and does not do on your machine,
what trust assumptions are baked into the install pipeline, and how to verify
those claims against the code if you don't want to take this README at its
word.

If you find a security issue, please **do not** open a public GitHub issue.
Email the author via the address listed on
[github.com/MuhammadUsmanGM](https://github.com/MuhammadUsmanGM) so we can
coordinate disclosure. See [Reporting a vulnerability](#reporting-a-vulnerability)
below.

This is a 0.x release. The threat model is "individual developer running an
opt-in CLI from npm." It is **not** an enterprise-grade attestation surface,
and we say so explicitly where that matters.

---

## TL;DR

| Question | Answer |
| --- | --- |
| Does code-stick send telemetry? | **No.** Zero outbound HTTP except the explicit downloads listed below. |
| Does it auto-upload crash reports? | **No.** Bug reports are written to your OS temp dir; you choose whether to attach them to an issue. |
| Are the binaries it downloads pinned and verified? | **Yes.** Ollama and opencode releases are pinned by version + SHA-256. Downloads that don't match abort the install. |
| Are model blobs verified? | **Yes**, indirectly — they are pulled via `ollama serve` from `registry.ollama.ai`, which is the same channel a host-installed Ollama would use, and Ollama verifies its own manifests. |
| Are macOS binaries notarized? | **No, not yet.** Apple Developer Program enrollment is on the roadmap. First launch will show a Gatekeeper dialog. |
| Does the installer need admin / root? | **No.** Everything writes to the USB you chose plus `%TEMP%`/`/tmp`. No registry edits, no service install, no PATH mutation. |

---

## What runs where

```
Install host (your laptop)               Target host (any laptop the stick plugs into)
─────────────────────────────────────    ──────────────────────────────────────────────
node + npx + code-stick CLI       ──►    nothing — code-stick never runs on the target
node-tar + extract-zip                   <USB>/engine/<target>/ollama           ── runs
got (HTTPS downloader)                   <USB>/opencode/<target>/opencode       ── runs
hasha (SHA-256 verifier)                 reads <USB>/data, <USB>/config
ollama serve (only during model pull)
opencode prestage (npm — host only)
```

Once the install completes, the host has zero residue (caveat: see "Host
artifacts left behind" below). The launchers shipped on the USB are plain
shell scripts you can read in any text editor.

---

## Trust roots

code-stick downloads three classes of bytes. Each has a different trust story.

### 1. Ollama + opencode binary releases

**Pinned by version + SHA-256 in `src/catalog/ollama.ts` and
`src/catalog/opencode.ts`.** Every download is hashed by
`src/core/downloader.ts` and the install aborts if the hash doesn't match.

You can verify the pins:

```bash
git show HEAD:src/catalog/ollama.ts | grep sha256
git show HEAD:src/catalog/opencode.ts | grep sha256
```

…and cross-check against the upstream release pages
([ollama/ollama releases](https://github.com/ollama/ollama/releases),
[sst/opencode releases](https://github.com/sst/opencode/releases)).

There is also a nightly catalog drift detector
(`.github/workflows/catalog-drift.yml` — see CHANGELOG) that re-fetches each
URL and opens a tracking issue if its SHA-256 changes from the pinned value.
A clean pinned hash + a green drift run = the bytes you install today are
bit-identical to the bytes audited when the catalog entry was written.

**What this does NOT cover:**

- Upstream upstreams. If a malicious actor compromised the
  `ollama/ollama` release artifacts and we re-pinned to the bad version,
  the verification chain doesn't catch it. The pin protects you from
  in-transit tampering and CDN drift, not from supply-chain compromise of
  the upstream project itself. We mitigate this by reading the upstream
  release notes / diffs before each catalog bump, but this is judgment, not
  a verifiable claim. Treat this as a known limitation.
- Mirrors. Each catalog entry can list mirror URLs the downloader tries
  on retry. Mirrors are subject to the same SHA-256 check — a malicious
  mirror cannot serve bytes that pass — but if the primary upstream URL
  itself is poisoned, mirrors won't save you.

### 2. The model blob (Qwen2.5-Coder, Phi-3, etc.)

Pulled via `ollama serve` + `ollama pull <tag>` (`src/core/model-pull.ts`).
This is a direct call to `registry.ollama.ai` — the exact same channel that
a host-installed Ollama would use to fetch the same tag. Ollama itself
verifies model manifests; code-stick does not add a separate hash check on
top.

What this means practically:

- The model blob's integrity rests on Ollama's registry + your TLS chain.
- If your threat model includes "Ollama's registry is compromised," that
  threat applies equally to anyone running `ollama pull` anywhere.
- code-stick does not (and will not) ship pre-packaged model blobs from
  any third-party CDN. The model always comes from registry.ollama.ai.

### 3. The opencode provider prestage (`@ai-sdk/openai-compatible`)

When you install, code-stick runs a one-shot `npm install
@ai-sdk/openai-compatible` against `<USB>/cache/opencode/` so opencode can
load this provider package offline on the target machine
(`src/core/opencode-prestage.ts`).

- This is the only step that calls npm.
- It runs on the **install host**, not the target.
- If npm is missing, code-stick prints a warning and continues — the
  install still succeeds; only the offline-launch experience degrades
  until the cache is populated.
- The package is npm's standard tarball, not customized by code-stick.

If you want zero-network installs at this step, run `code-stick install`
once on an online host, then carry the resulting `<USB>/cache/opencode/`
across to your offline machines.

---

## Network behavior

During `code-stick install`:

- `https://github.com/ollama/...` and `https://github.com/sst/...` — release
  asset downloads. SHA-256 checked.
- `https://registry.ollama.ai/...` — model manifest + blob pull. Performed by
  the bundled `ollama serve` process, not by code-stick code directly.
- `https://registry.npmjs.org/...` — the one-shot opencode provider prestage.

That's it.

During `code-stick start` (launching from the USB):

- **No outbound HTTP from code-stick itself.** The launcher starts
  `ollama serve` bound to `127.0.0.1:11434` and runs `opencode` against it.
- opencode talks only to that loopback Ollama endpoint by default.
- If a user has set their own `OPENAI_BASE_URL` / `ANTHROPIC_API_KEY` /
  similar in `<USB>/config/opencode/opencode.json`, opencode WILL contact
  the corresponding provider. That is the user's choice and is outside
  code-stick's control — but code-stick never installs such credentials.

During `code-stick doctor` and `code-stick status`:

- **No network.** These commands inspect the local USB only.

---

## What code-stick does NOT do

Stated explicitly so users on airgapped / NDA / regulated networks know
what to expect:

1. **No telemetry.** There is no analytics endpoint, no usage ping, no
   "anonymous metrics." Grep the source for `fetch(` / `https://` — every
   hit is one of the four URLs listed above (or a comment / test fixture).
2. **No auto-update.** code-stick never modifies itself or the binaries it
   shipped to the stick after install. Refresh is opt-in via
   `code-stick upgrade-engine`.
3. **No PATH / registry mutation.** Nothing is written outside
   `<USB>/`, `%TEMP%`/`/tmp`, and `~/.npm` (only via the explicit prestage).
4. **No background processes.** `ollama serve` is spawned only while the
   user-facing opencode session is in the foreground. Quitting opencode
   sends a kill signal to the Ollama PID it spawned — never a broad
   `taskkill /IM ollama.exe`, so a separately-running host Ollama is not
   affected.
5. **No credential collection.** code-stick does not read or copy SSH
   keys, npm tokens, browser cookies, shell history, or anything outside
   the directories listed above.

---

## Bug reports

When the CLI crashes uncaught, `src/utils/bug-report.ts` builds a
**redacted** Markdown report in your OS temp dir
(`%TEMP%\code-stick\bug-report-*.md` on Windows,
`/tmp/code-stick/bug-report-*.md` elsewhere). The path is printed to your
terminal so you can review it before attaching to an issue.

The report is never transmitted automatically. You choose whether to upload
it.

Redaction rules (defense in depth — not a guarantee, but a strong default):

- `os.homedir()` is replaced with `$HOME`.
- `os.hostname()` is replaced with `$HOST`.
- The USB target path is replaced with `$USB`.
- Windows `C:\Users\<name>` style paths are collapsed to `$HOME`.
- Common token shapes are pattern-matched and replaced with `$REDACTED_*`:
  - `npm_<token>` → `$REDACTED_NPM_TOKEN`
  - `ghp_<token>` → `$REDACTED_GH_TOKEN`
  - `sk-<token>` → `$REDACTED_API_KEY`

Redaction is best-effort. Always eyeball the report before posting. The
file is written with normal user permissions; if you'd rather it not exist
on disk at all, delete it after copying what you need.

The implementation lives in a single short file you can review:
[`src/utils/bug-report.ts`](../src/utils/bug-report.ts). The unit tests
([`test/bug-report.test.ts`](../test/bug-report.test.ts)) cover the
redaction rules.

---

## macOS Gatekeeper

The macOS Ollama and opencode binaries shipped on the USB are **not yet
notarized**. Apple notarization requires an active Apple Developer Program
membership ($99/year) and a signed build pipeline. This is on the roadmap
but not yet done.

Practically:

- First-launch on macOS Sonoma+ will show a Gatekeeper dialog ("can't be
  opened, developer cannot be verified").
- The supported workflow is **right-click `start-mac.command` → Open →
  Open**, which adds a per-binary exception. Future double-clicks work.
- The README's Troubleshooting section has the full workaround including
  the `xattr -dr com.apple.quarantine` last-resort.
- `code-stick doctor` does not trip Gatekeeper because it runs from a
  CLI context with no quarantine attribute on the spawned binary.

Until notarization lands, macOS-on-external-media is a manual-trust
moment per machine. This is the same trade-off any unsigned tool ships
with on macOS; we are not pretending otherwise.

---

## Filesystem & POSIX permissions

- USB target must be **exFAT or NTFS**. FAT32 is rejected at preflight
  because the 4 GB file limit blocks the larger model blobs
  (`src/core/preflight.ts`).
- FAT-family filesystems cannot store the POSIX `+x` bit, so launchers
  invoked directly from a FAT/exFAT stick on Linux/macOS need
  `bash start-linux.sh`. The installer warns about this at install time.
- The tar extractor (`src/core/extract.ts`) probes the destination for
  POSIX symlink support up front. On Windows without Developer Mode /
  admin, and on FAT32/exFAT regardless of host, it materializes tarball
  symlinks as **regular file copies of the linked bytes**. This is the
  fix for the v0.1.0 → v0.1.1 `EPERM: operation not permitted, symlink`
  crash. It is *not* a security weakening: the bytes copied are the
  exact bytes the symlink would have pointed at, and the resolver
  refuses any link target that escapes the extraction sandbox
  (`resolveLinkTarget`).

---

## Host artifacts left behind

Strictly speaking, "zero install on the host" is *almost* true. What does
remain after `code-stick install` completes:

| Artifact | Path | When it's cleaned |
| --- | --- | --- |
| `npx` cache of the code-stick package | `~/.npm/_npx/<hash>` (Linux/macOS), `%LocalAppData%\npm-cache\_npx\<hash>` (Windows) | When npm's npx cache expires or you clear it. |
| Opencode provider prestage (one-shot, ~10 MB) | `~/.npm/_cacache/...` via the standard npm cache | Survives until you `npm cache clean --force`. |
| Bug reports (only if a crash happened) | `%TEMP%\code-stick\` / `/tmp/code-stick/` | Cleared on next OS temp-dir sweep. |
| Install log (only when CLI was running) | `<USB>/state/install.log` | Lives on the USB, not the host. |

`code-stick install` does not write to the registry (Windows), launchctl
(macOS), or systemd (Linux). No PATH mutation. No shell-rc injection.

On the **target** host (the machine you plug the stick into and launch
from), the only host-side artefact is the foreground process itself. When
opencode exits, the launcher kills the Ollama PID it spawned. Nothing
persists.

---

## Threat model

What we defend against:

- **In-transit tampering of binary downloads.** SHA-256 pin per artefact.
- **CDN drift / silent upstream re-publishes.** Catch via nightly drift
  detector + pinned hash.
- **Stale `.partial` download splicing across catalog bumps.** A sidecar
  `.partial.meta` records the URL + hash that started the partial; mismatch
  → discard, not resume (`src/core/downloader.ts`).
- **Path-traversal in tarballs.** `extractTarFile`'s filter refuses
  entries containing `..` segments or paths that resolve outside the
  destination. The deferred-link materializer applies the same check to
  `linkpath`. Malicious archives that try to escape are aborted.
- **Lock-file race on manifest writes.** `saveManifest` takes a sibling
  `.lock`, with PID + comm checks to detect recycled PIDs and a 10-minute
  mtime cap to recover from abandoned locks.
- **PID-target confusion during shutdown.** Launchers kill by stored PID,
  never `taskkill /IM ollama.exe`. A user's separately-running host Ollama
  is unaffected.
- **Accidental credential exfiltration via bug reports.** Multi-layer
  redaction (home dir, hostname, USB path, token-shape regex). Manual
  upload only.

What we explicitly do NOT defend against (yet):

- **Supply-chain compromise of Ollama or opencode upstream.** If their
  release pipeline is owned by an attacker and we re-pin, we ship the bad
  bytes. Mitigation: human review on every catalog bump. No verifiable
  claim today.
- **Compromised npm registry serving a malicious
  `@ai-sdk/openai-compatible`.** Same shape as above; prestage trusts
  npm's TLS + the package metadata.
- **Malicious USB hardware ("BadUSB" / HID injection).** Out of scope.
  code-stick assumes the stick is a passive mass-storage device.
- **An attacker with admin on the install host.** No tool can defend
  against this; the trust boundary is "user already trusts their own
  machine."
- **Forensic recovery of model bytes from `%TEMP%` in Fast install
  mode.** Fast mode stages blobs in `os.tmpdir()` then copies to the
  USB. The temp dir is deleted on success, but undeleted blocks may
  linger until overwritten. Pick Direct install mode if this matters.

---

## Reporting a vulnerability

1. **Do not** open a public GitHub issue.
2. Email the author at the address on
   [github.com/MuhammadUsmanGM](https://github.com/MuhammadUsmanGM)
   with subject prefix `[code-stick security]`.
3. Include: code-stick version (`code-stick --version`), Node version,
   host OS, a minimal repro, and any redacted bug-report file
   (`%TEMP%\code-stick\bug-report-*.md`).
4. You will receive an acknowledgement within 5 business days. If the
   issue is confirmed, a coordinated-disclosure timeline will be agreed
   before a patch lands publicly.

This is a solo-maintained project at v0.x. There is no security SLA. The
fastest fix path is a clean repro + a willingness to test a patch.

---

## Verifying these claims yourself

You don't have to take this document's word for any of this. The repo is
under 5,000 lines of TypeScript. Useful starting points:

| Claim | Where to look |
| --- | --- |
| Pinned SHA-256 per artefact | `src/catalog/ollama.ts`, `src/catalog/opencode.ts` |
| Hash verification on every download | `src/core/downloader.ts` (look for `hashFile`) |
| No telemetry / outbound HTTP outside the listed URLs | `git grep -E 'fetch\(\|got\(\|http' src/` |
| Tar path-traversal filter | `src/core/extract.ts` (search `aborted`) |
| Bug report redaction rules | `src/utils/bug-report.ts` + `test/bug-report.test.ts` |
| Manifest lock + PID checks | `src/state/manifest.ts` (search `acquireManifestLock`) |
| Symlink probe + fallback | `src/core/extract.ts` (`hostCanSymlink`, `materializeDeferredLinks`) |

If something in this document doesn't match the code, that's a bug.
File an issue.
