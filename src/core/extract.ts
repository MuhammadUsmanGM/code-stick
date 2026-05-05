// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import extractZip from "extract-zip";
import * as tar from "tar";
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";

export interface ExtractOptions {
  /**
   * Relative path that MUST exist under destDir after extraction. The archive
   * is rejected (and the partially-extracted dir cleaned up) if missing — this
   * catches malformed/wrong-target uploads and surfaces them at install time
   * instead of at `code-stick start`.
   */
  expectBinary?: string;
}

export async function extractZipFile(zipPath: string, destDir: string, opts: ExtractOptions = {}): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const resolvedDest = path.resolve(destDir);
  await extractZip(zipPath, { dir: resolvedDest });
  log.dim(`Extracted ${path.basename(zipPath)}`);
  assertExtractedBinary(resolvedDest, opts.expectBinary, zipPath);
}

export async function extractTarFile(tarPath: string, destDir: string, opts: ExtractOptions = {}): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  await tar.x({
    file: tarPath,
    cwd: destDir,
    // strip a single top-level directory if present (matches tarballs that ship
    // their content under "ollama-linux-amd64/").
    strip: 0,
  });
  log.dim(`Extracted ${path.basename(tarPath)}`);
  assertExtractedBinary(path.resolve(destDir), opts.expectBinary, tarPath);
}

function assertExtractedBinary(destDir: string, expectBinary: string | undefined, archive: string): void {
  if (!expectBinary) return;
  const expected = path.join(destDir, expectBinary);
  if (fs.existsSync(expected)) return;
  throw new Error(
    `Archive ${path.basename(archive)} did not contain the expected binary at "${expectBinary}". ` +
    `The release asset may be malformed or the wrong target. Re-run install to retry, or remove ` +
    `${destDir} and try a fresh download.`
  );
}
