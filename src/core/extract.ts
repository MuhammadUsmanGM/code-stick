// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import extractZip from "extract-zip";
import * as tar from "tar";
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";

export async function extractZipFile(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const resolvedDest = path.resolve(destDir);
  // extract-zip already rejects entries that resolve outside `dir` (CVE-2018-1002204
  // hardening), so we just hand it a fully-resolved destination.
  await extractZip(zipPath, { dir: resolvedDest });
  log.dim(`Extracted ${path.basename(zipPath)}`);
}

export async function extractTarFile(tarPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const resolvedDest = path.resolve(destDir);
  // Path-traversal hardening: a malicious or corrupted tar could carry entries
  // like "../../etc/passwd". node-tar already strips leading "/" and resolves
  // "..", but we belt-and-brace it:
  //   - filter:  drop any entry whose path resolves outside destDir or contains
  //              ".." segments
  //   - strict:  treat unrecognized headers as errors instead of silently
  //              skipping them
  //   - onwarn:  surface tar's own complaints so we don't paper over a broken
  //              archive
  let aborted: string | null = null;
  await tar.x({
    file: tarPath,
    cwd: resolvedDest,
    strip: 0,
    strict: true,
    filter: (entryPath) => {
      if (entryPath.split(/[\\/]/).some((seg) => seg === "..")) {
        aborted ??= `archive contains path with '..' segment: ${entryPath}`;
        return false;
      }
      const target = path.resolve(resolvedDest, entryPath);
      if (target !== resolvedDest && !target.startsWith(resolvedDest + path.sep)) {
        aborted ??= `archive entry escapes destination: ${entryPath}`;
        return false;
      }
      return true;
    },
    onwarn: (code, message) => {
      log.warn(`tar warning [${code}]: ${message}`);
    },
  });
  if (aborted) {
    throw new Error(`Refused to extract ${path.basename(tarPath)}: ${aborted}`);
  }
  log.dim(`Extracted ${path.basename(tarPath)}`);
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
  const found = shallowSearch(destDir, path.basename(relBin), 3);
  if (found) {
    const target = expected;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(found, target);
    if (fs.existsSync(expected)) return;
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

function shallowSearch(root: string, basename: string, maxDepth: number): string | null {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === basename) return full;
      if (entry.isDirectory() && depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}
