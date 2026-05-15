// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import extractZip from "extract-zip";
import * as tar from "tar";
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";
import { toLongPath } from "../utils/paths.js";

export async function extractZipFile(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const resolvedDest = path.resolve(destDir);
  // extract-zip already rejects entries that resolve outside `dir` (CVE-2018-1002204
  // hardening), so we just hand it a fully-resolved destination. Use long-path
  // form on Win32 so deeply-nested zip entries (e.g. node_modules) survive the
  // MAX_PATH cap during extraction.
  await extractZip(zipPath, { dir: toLongPath(resolvedDest) });
  log.dim(`Extracted ${path.basename(zipPath)}`);
}

/**
 * Recursively grant +x to every file under `root` (subject to umask).
 *
 * Why: extract-zip strips POSIX permission bits — files come out 0o644 even if
 * the zip recorded 0o755. We previously chmod'd only the named binary, but
 * macOS opencode/Ollama bundles ship sidecar binaries, dylibs, and shell
 * helpers that also need to be executable. A recursive chmod is the simplest
 * correct answer; setting +x on a regular .json or .txt is harmless.
 *
 * No-op on Windows. No-op on FAT32/exFAT (chmod silently ignored).
 */
export function chmodExecRecursive(root: string): void {
  if (process.platform === "win32") return;
  if (!fs.existsSync(root)) return;
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(toLongPath(dir), { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // dirs need +x for traversal
        try { fs.chmodSync(toLongPath(full), 0o755); } catch { /* FAT/exFAT */ }
        stack.push(full);
      } else if (e.isFile()) {
        try { fs.chmodSync(toLongPath(full), 0o755); } catch { /* FAT/exFAT */ }
      }
    }
  }
}

/**
 * Probe whether the host filesystem at `destDir` can store POSIX symlinks.
 *
 * Two real-world failure modes drive this:
 *   1. Windows without Developer Mode + non-admin shell: fs.symlinkSync
 *      throws EPERM because SeCreateSymbolicLinkPrivilege is not granted.
 *   2. FAT32/exFAT (regardless of OS): the filesystem has no concept of a
 *      symlink. fs.symlinkSync usually throws EPERM/ENOSYS/EINVAL.
 *
 * Either way, tar.x() will abort mid-stream the first time it tries to
 * lay down a symlink — corrupting the staging dir for a perfectly valid
 * macOS Ollama tarball (which carries `libggml-base.dylib -> libggml-base.0.0.0.dylib`).
 *
 * We probe once per destination at extract time and switch to a
 * copy-the-target-bytes fallback when symlinks aren't available. Probing
 * costs one small write+symlink+unlink — negligible next to an N-MB tar.
 */
export function hostCanSymlink(destDir: string): boolean {
  fs.mkdirSync(destDir, { recursive: true });
  const targetPath = path.join(destDir, ".cs-symlink-probe-target");
  const linkPath = path.join(destDir, ".cs-symlink-probe-link");
  // Best-effort cleanup of anything left by a previous crashed probe.
  try { fs.unlinkSync(linkPath); } catch { /* ignore */ }
  try { fs.unlinkSync(targetPath); } catch { /* ignore */ }
  try {
    fs.writeFileSync(targetPath, "probe");
    fs.symlinkSync(targetPath, linkPath);
    // Confirm the link actually resolves — some Windows builds with the
    // privilege missing let symlinkSync succeed silently then fail on read.
    const round = fs.readFileSync(linkPath, "utf-8");
    return round === "probe";
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(linkPath); } catch { /* ignore */ }
    try { fs.unlinkSync(targetPath); } catch { /* ignore */ }
  }
}

interface DeferredLink {
  /** Path inside destDir where the link should be materialized. */
  destPath: string;
  /** Resolved on-disk path the link points at, normalized to destDir. */
  resolvedTarget: string;
  /** Original linkpath verbatim — used for warnings. */
  linkpath: string;
  /** "symlink" or "hardlink" — informs whether we copy or hard-link first. */
  kind: "symlink" | "hardlink";
}

/**
 * Resolve a tar entry's linkpath into an absolute, sandboxed on-disk path.
 *
 * tar entry semantics:
 *   - SymbolicLink: linkpath is relative to the symlink's own DIRECTORY.
 *   - Link (hardlink): linkpath is relative to the EXTRACTION ROOT.
 *
 * Returns null when the link escapes destDir (path-traversal guard).
 */
function resolveLinkTarget(
  destDir: string,
  entryRelPath: string,
  linkpath: string,
  kind: "symlink" | "hardlink",
): string | null {
  if (!linkpath) return null;
  const base = kind === "symlink"
    ? path.dirname(path.join(destDir, entryRelPath))
    : destDir;
  const resolved = path.resolve(base, linkpath);
  if (resolved !== destDir && !resolved.startsWith(destDir + path.sep)) return null;
  return resolved;
}

export async function extractTarFile(tarPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const resolvedDest = path.resolve(destDir);

  // Decide once whether to defer symlink/hardlink creation. The probe runs in
  // the *real* destDir so we catch the filesystem the binaries will actually
  // live on (USB stick formatted FAT32/exFAT will refuse symlinks even on
  // Linux/macOS hosts).
  const canSymlink = hostCanSymlink(resolvedDest);
  const deferredLinks: DeferredLink[] = [];

  // Path-traversal hardening: a malicious or corrupted tar could carry entries
  // like "../../etc/passwd". node-tar already strips leading "/" and resolves
  // "..", but we belt-and-brace it:
  //   - filter:  drop any entry whose path resolves outside destDir or contains
  //              ".." segments, and divert SymbolicLink/Link entries into
  //              deferredLinks when the host can't create them.
  //   - strict:  treat unrecognized headers as errors instead of silently
  //              skipping them
  //   - onwarn:  surface tar's own complaints so we don't paper over a broken
  //              archive
  let aborted: string | null = null;
  await tar.x({
    file: tarPath,
    cwd: toLongPath(resolvedDest),
    strip: 0,
    strict: true,
    // chmod / chown are no-ops on Win32 and irrelevant for our use case;
    // disabling them avoids tar walking each file's metadata after write.
    noChmod: process.platform === "win32",
    preserveOwner: false,
    filter: (entryPath, stat) => {
      if (entryPath.split(/[\\/]/).some((seg) => seg === "..")) {
        aborted ??= `archive contains path with '..' segment: ${entryPath}`;
        return false;
      }
      const target = path.resolve(resolvedDest, entryPath);
      if (target !== resolvedDest && !target.startsWith(resolvedDest + path.sep)) {
        aborted ??= `archive entry escapes destination: ${entryPath}`;
        return false;
      }
      // Divert link entries when the host can't materialize them as real
      // links. node-tar drops onentry for any entry the filter rejects, so
      // we capture linkpath HERE (stat exposes it for link types) and queue
      // a copy-from-target post-pass. Returning false then prevents tar
      // from calling symlinkSync at all — the failure mode we're avoiding.
      if (!canSymlink) {
        const typ = (stat as { type?: string }).type;
        if (typ === "SymbolicLink" || typ === "Link") {
          const kind: "symlink" | "hardlink" = typ === "SymbolicLink" ? "symlink" : "hardlink";
          const linkpath = (stat as { linkpath?: string }).linkpath ?? "";
          const destPath = path.join(resolvedDest, entryPath);
          const targetResolved = resolveLinkTarget(resolvedDest, entryPath, linkpath, kind);
          deferredLinks.push({
            destPath,
            resolvedTarget: targetResolved ?? "",
            linkpath,
            kind,
          });
          return false;
        }
      }
      return true;
    },
    onwarn: (code, message) => {
      log.warn(`tar warning [${code}]: ${message}`);
    },
  });
  if (aborted) {
    throw new Error(
      `Refused to extract ${path.basename(tarPath)}: ${aborted}. ` +
      "The archive may be corrupt or tampered with — re-run the install to re-download from the catalog mirrors."
    );
  }

  if (deferredLinks.length > 0) {
    materializeDeferredLinks(resolvedDest, deferredLinks);
  }

  log.dim(`Extracted ${path.basename(tarPath)}`);
}

/**
 * Resolve each deferred symlink/hardlink to its target's bytes and lay it
 * down as a regular file.
 *
 * Why this is correct for code-stick: the binaries we ship are read on
 * machines that DO support symlinks (macOS, Linux). They never need to be
 * "linked" — every symlink in upstream Ollama/opencode tarballs is purely
 * a space-saving alias (e.g. `libfoo.dylib -> libfoo.1.dylib`). Copying
 * costs disk but launches are unaffected.
 *
 * Multi-pass: links can point at other links. We resolve up to MAX_PASSES
 * times before giving up — a runaway loop in a malicious archive shouldn't
 * wedge the installer.
 */
function materializeDeferredLinks(destDir: string, links: DeferredLink[]): void {
  const MAX_PASSES = 8;
  let remaining = links;
  for (let pass = 0; pass < MAX_PASSES && remaining.length; pass++) {
    const next: DeferredLink[] = [];
    for (const link of remaining) {
      if (!link.resolvedTarget) {
        log.warn(
          `Skipping link ${path.relative(destDir, link.destPath)} -> ${link.linkpath} ` +
          `(target outside extracted tree or empty)`,
        );
        continue;
      }
      if (!fs.existsSync(link.resolvedTarget)) {
        // Target not laid down yet — could be a later entry in the same
        // tar that we already extracted, or another deferred link still
        // pending. Re-queue once and hope a later pass resolves it.
        next.push(link);
        continue;
      }
      try {
        // Ensure parent dir exists. The original tar entry's parent should
        // already be there from a directory entry, but Ollama bundles
        // sometimes ship a symlink at top level before any sibling dir.
        fs.mkdirSync(path.dirname(link.destPath), { recursive: true });
        // Always copy bytes — even for hardlinks. fs.linkSync would work on
        // Windows for hardlinks but fails across drives; copy is uniformly
        // safe and the size cost is negligible at our scale.
        fs.copyFileSync(toLongPath(link.resolvedTarget), toLongPath(link.destPath));
      } catch (err) {
        log.warn(
          `Could not materialize ${link.kind} ${path.relative(destDir, link.destPath)}` +
          ` -> ${link.linkpath}: ${(err as Error).message}`,
        );
      }
    }
    remaining = next;
  }
  for (const stuck of remaining) {
    log.warn(
      `Could not resolve ${stuck.kind} ${path.relative(destDir, stuck.destPath)} -> ` +
      `${stuck.linkpath} (target never appeared in the archive — skipping)`,
    );
  }
}

/**
 * Verify the binary we expect to run lives at `path.join(destDir, relBin)`
 * after extract. Two failure modes we recover from:
 *
 *  1. Ollama's macOS .tgz uses GNU sparse format; some node-tar versions
 *     leave the payload at `GNUSparseFile.0/<name>` instead of `<name>`.
 *     We move it into place when found.
 *  2. A future upstream layout change shifts the binary into a subdir.
 *     We do a shallow search and relocate so the launcher still works.
 *
 * If neither rescue path produces the expected file, throw — silent
 * "missing binary" makes every launch on the affected target fail
 * with a far less actionable error.
 */
export function ensureBinaryAt(destDir: string, relBin: string, label: string): void {
  const expected = path.join(destDir, relBin);
  if (fs.existsSync(expected)) return;

  // GNU sparse rescue: walk one level deep for a "GNUSparseFile.*" dir
  // that contains the same basename, and lift everything one level up.
  const sparseDir = findSparseDir(destDir);
  if (sparseDir) {
    log.dim(`Recovering ${label} from ${path.basename(sparseDir)}/...`);
    moveContents(sparseDir, destDir);
    fs.rmSync(sparseDir, { recursive: true, force: true });
    if (fs.existsSync(expected)) return;
  }

  // Shallow search: maybe the archive nested it under a single subdir.
  // Depth: macOS Ollama bundles have shipped binaries inside
  // `Ollama.app/Contents/Resources/<name>` (4 levels) and Linux .tgz puts
  // ollama under `bin/`, so 6 levels gives us the headroom for any layout
  // upstream is plausibly going to ship without traversing whole trees.
  const found = shallowSearch(destDir, path.basename(relBin), 6);
  if (found) {
    const target = expected;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(found, target);
    if (fs.existsSync(expected)) {
      // chmod here too — relocated file may be the only candidate ensureExecutable
      // sees later, and on macOS the .app/Contents/MacOS/ binaries are 755 in the
      // archive but the rename loses the bit on some filesystems.
      try { fs.chmodSync(expected, 0o755); } catch { /* FAT */ }
      return;
    }
  }

  throw new Error(
    `Extracted ${label} but expected binary is missing at ${relBin}. ` +
    `Archive layout may have changed upstream — re-run with CODE_STICK_DEBUG=1 ` +
    `--no-cleanup and inspect ${destDir}.`,
  );
}

function findSparseDir(root: string): string | null {
  try {
    for (const name of fs.readdirSync(root)) {
      if (/^GNUSparseFile\./.test(name)) {
        const full = path.join(root, name);
        if (fs.statSync(full).isDirectory()) return full;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function moveContents(srcDir: string, destDir: string): void {
  for (const name of fs.readdirSync(srcDir)) {
    const from = path.join(srcDir, name);
    const to = path.join(destDir, name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
}

/**
 * Find the best file matching `basename` under `root`.
 *
 * Naive BFS-first-match is wrong on case-insensitive APFS / macOS: an Ollama
 * .zip can ship both the headless CLI (`Resources/ollama`, ~30MB, exec) AND
 * the GUI app's main executable (`Ollama.app/Contents/MacOS/Ollama`, the
 * SwiftUI launcher). On HFS+/APFS the two collide on case-insensitive
 * comparison so a basename match can return the GUI app, which then fails to
 * `serve` headlessly. We score candidates and pick the highest-scoring one:
 *
 *   +3   exec bit set (st_mode & 0o111)  — non-exec data files lose
 *   -5   path contains `.app/`           — GUI bundles are always wrong here
 *   -2   exact basename mismatch (case)  — prefer the case the caller asked
 *   +1   parent dir is `bin/` or matches the binary basename
 *   -size penalty for files <100KB        — stub launchers / readmes named "ollama"
 *
 * Files smaller than 16KB are dropped outright; they can't possibly be the
 * binary we want.
 */
function shallowSearch(root: string, basename: string, maxDepth: number): string | null {
  interface Candidate { full: string; score: number; }
  const candidates: Candidate[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(toLongPath(dir), { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      // Case-insensitive match so APFS doesn't strand us, but score the case
      // mismatch down so we prefer "ollama" over "Ollama" when both exist.
      if (entry.name.toLowerCase() !== basename.toLowerCase()) continue;

      let stat: fs.Stats;
      try { stat = fs.statSync(toLongPath(full)); } catch { continue; }
      if (stat.size < 16 * 1024) continue;

      let score = 0;
      const isExec = (stat.mode & 0o111) !== 0;
      if (isExec) score += 3;
      if (full.includes(`.app${path.sep}`) || /\.app\//.test(full)) score -= 5;
      if (entry.name !== basename) score -= 2;
      const parent = path.basename(path.dirname(full));
      if (parent === "bin" || parent === basename) score += 1;
      if (stat.size < 100 * 1024) score -= 1;

      candidates.push({ full, score });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].full;
}
