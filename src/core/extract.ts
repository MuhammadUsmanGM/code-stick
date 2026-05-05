// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import extractZip from "extract-zip";
import * as tar from "tar";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Decompress } from "fzstd";
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
  await runExtraction(destDir, zipPath, opts, async (resolvedDest) => {
    await extractZip(zipPath, { dir: resolvedDest });
  });
}

export async function extractTarFile(tarPath: string, destDir: string, opts: ExtractOptions = {}): Promise<void> {
  await runExtraction(destDir, tarPath, opts, async () => {
    await tar.x({
      file: tarPath,
      cwd: destDir,
      // strip a single top-level directory if present (matches tarballs that ship
      // their content under "ollama-linux-amd64/").
      strip: 0,
    });
  });
}

export async function extractTarZstFile(archivePath: string, destDir: string, opts: ExtractOptions = {}): Promise<void> {
  await runExtraction(destDir, archivePath, opts, async () => {
    // fzstd's Decompress class consumes chunks via push() and emits decoded
    // bytes through the supplied callback. We adapt it to a Node Transform so
    // we can pipeline filesystem read -> zstd decode -> node-tar.
    const zstdTransform = new Transform({
      construct(this: Transform & { _decoder?: Decompress }, callback) {
        this._decoder = new Decompress((chunk, final) => {
          if (chunk.length > 0) this.push(Buffer.from(chunk));
          if (final) this.push(null);
        });
        callback();
      },
      transform(this: Transform & { _decoder?: Decompress }, chunk: Buffer, _enc, callback) {
        try {
          this._decoder!.push(new Uint8Array(chunk), false);
          callback();
        } catch (err) { callback(err as Error); }
      },
      flush(this: Transform & { _decoder?: Decompress }, callback) {
        try {
          this._decoder!.push(new Uint8Array(0), true);
          callback();
        } catch (err) { callback(err as Error); }
      },
    });

    const tarExtract = tar.x({ cwd: destDir, strip: 0 });
    await pipeline(fs.createReadStream(archivePath), zstdTransform, tarExtract);
  });
}

/**
 * Run an extraction step and verify the expected binary lands at the expected
 * path. On any failure (extractor throw OR missing binary) the partially-
 * populated destDir is removed so retries start clean and users never have to
 * delete a half-extracted tree by hand.
 */
async function runExtraction(
  destDir: string,
  archivePath: string,
  opts: ExtractOptions,
  extract: (resolvedDest: string) => Promise<void>,
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const resolvedDest = path.resolve(destDir);
  try {
    await extract(resolvedDest);
    assertExtractedBinary(resolvedDest, opts.expectBinary, archivePath);
    log.dim(`Extracted ${path.basename(archivePath)}`);
  } catch (err) {
    try { fs.rmSync(resolvedDest, { recursive: true, force: true }); }
    catch { /* best-effort cleanup */ }
    throw err;
  }
}

function assertExtractedBinary(destDir: string, expectBinary: string | undefined, archive: string): void {
  if (!expectBinary) return;
  const expected = path.join(destDir, expectBinary);
  if (fs.existsSync(expected)) return;
  throw new Error(
    `Archive ${path.basename(archive)} did not contain the expected binary at "${expectBinary}". ` +
    `The release asset may be malformed or the wrong target. Re-run install to retry.`
  );
}
