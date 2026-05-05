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

export async function extractTarZstFile(archivePath: string, destDir: string, opts: ExtractOptions = {}): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });

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

  log.dim(`Extracted ${path.basename(archivePath)}`);
  assertExtractedBinary(path.resolve(destDir), opts.expectBinary, archivePath);
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
