// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import extractZip from "extract-zip";
import * as tar from "tar";
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";

export async function extractZipFile(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const resolvedDest = path.resolve(destDir);
  await extractZip(zipPath, { dir: resolvedDest });
  log.dim(`Extracted ${path.basename(zipPath)}`);
}

export async function extractTarFile(tarPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  await tar.x({ file: tarPath, cwd: destDir, strip: 0 });
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
