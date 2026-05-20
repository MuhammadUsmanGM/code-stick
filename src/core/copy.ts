// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { createProgress } from "../utils/logger.js";
import { toLongPath } from "../utils/paths.js";

interface WalkResult {
  files: { src: string; dest: string; size: number }[];
  totalBytes: number;
}

function walkTree(src: string, dest: string): WalkResult {
  const files: WalkResult["files"] = [];
  let totalBytes = 0;
  // Walk uses long-path form on Win32 so deeply-nested trees (e.g. staged
  // model blobs nested under @scope/pkg/dist/...) don't trip MAX_PATH while
  // we readdir/stat. The src/dest strings recorded for later copy ops are
  // also long-path so the per-file copy path stays consistent.
  const walk = (s: string, d: string) => {
    for (const entry of fs.readdirSync(toLongPath(s), { withFileTypes: true })) {
      const sp = path.join(s, entry.name);
      const dp = path.join(d, entry.name);
      if (entry.isDirectory()) walk(sp, dp);
      else if (entry.isFile()) {
        const size = fs.statSync(toLongPath(sp)).size;
        files.push({ src: sp, dest: dp, size });
        totalBytes += size;
      }
    }
  };
  walk(src, dest);
  return { files, totalBytes };
}

export interface CopyDirOptions {
  /**
   * Parallel file copies (host → USB). USB 2 sticks may saturate with 2;
   * host SSD → USB 3 often benefits from 4. Default 1 (sequential).
   */
  fileConcurrency?: number;
}

async function copyOneFile(src: string, dest: string, size: number): Promise<number> {
  const longSrc = toLongPath(src);
  const longDest = toLongPath(dest);
  try {
    const st = await fs.promises.stat(longDest);
    if (st.isFile() && st.size === size) return size;
  } catch { /* dest missing */ }
  const stagePath = `${longDest}.partial`;
  try { await fs.promises.unlink(stagePath); } catch { /* ignore */ }
  // Async copyFile is the whole point of this refactor: it releases the event
  // loop while the OS-level read/write pump runs, so a Promise.all worker pool
  // (below) can have multiple host→USB transfers in flight concurrently. The
  // old sync path serialized everything no matter how many workers you spun up.
  await fs.promises.copyFile(longSrc, stagePath);
  // fsync best-effort. Open + sync + close via the promise API; failures
  // (FAT32 / read-only mounts) are silent — we already wrote the bytes.
  let handle: import("node:fs/promises").FileHandle | null = null;
  try {
    handle = await fs.promises.open(stagePath, "r+");
    await handle.sync();
  } catch { /* fsync may not be supported on the target FS */ }
  finally { if (handle) { try { await handle.close(); } catch { /* ignore */ } } }
  await fs.promises.rename(stagePath, longDest);
  return size;
}

function formatEta(remainingSecs: number): string {
  if (remainingSecs < 60) return `${remainingSecs}s`;
  if (remainingSecs < 3600) {
    const mins = Math.floor(remainingSecs / 60);
    const secs = remainingSecs % 60;
    return `${mins}m ${secs}s`;
  }
  const hrs = Math.floor(remainingSecs / 3600);
  const mins = Math.floor((remainingSecs % 3600) / 60);
  return `${hrs}h ${mins}m`;
}

/** Copy a directory tree with a real progress bar (MB / speed / ETA). */
export async function copyDirWithProgress(
  src: string,
  dest: string,
  label: string,
  options?: CopyDirOptions,
): Promise<void> {
  fs.mkdirSync(dest, { recursive: true });
  const { files, totalBytes } = walkTree(src, dest);
  if (files.length === 0) return;

  const concurrency = Math.max(1, Math.min(options?.fileConcurrency ?? 1, 8));
  const totalMB = Math.max(1, Math.round(totalBytes / 1e6));
  const bar = createProgress();

  bar.start(totalMB, 0, {
    label: label.padEnd(30),
    speed: "0.00",
    current: 0,
    total: totalMB,
    eta_display: "calculating...",
  });

  let copiedBytes = 0;
  let lastTime = Date.now();
  let lastBytes = 0;

  const bumpProgress = (added: number) => {
    copiedBytes += added;
    const now = Date.now();
    const elapsed = (now - lastTime) / 1000;
    if (elapsed < 0.3 && copiedBytes < totalBytes) return;
    const speedVal = (copiedBytes - lastBytes) / Math.max(elapsed, 0.001) / 1e6;
    lastTime = now;
    lastBytes = copiedBytes;
    let eta_display = "calculating...";
    if (speedVal > 0 && totalBytes > copiedBytes) {
      eta_display = formatEta(Math.round((totalBytes - copiedBytes) / (speedVal * 1e6)));
    } else if (copiedBytes === totalBytes) eta_display = "0s";
    bar.update(Math.round(copiedBytes / 1e6), {
      speed: speedVal.toFixed(2),
      current: Math.round(copiedBytes / 1e6),
      eta_display,
    });
  };

  try {
    const dirs = new Set<string>();
    for (const f of files) dirs.add(path.dirname(f.dest));
    for (const d of dirs) fs.mkdirSync(toLongPath(d), { recursive: true });

    if (concurrency === 1) {
      for (const f of files) {
        bumpProgress(await copyOneFile(f.src, f.dest, f.size));
      }
    } else {
      // Work-stealing pool: each worker grabs the next file off the shared
      // counter, awaits its copy, then loops. The `await` is what makes this
      // *actually* parallel — the previous sync implementation pinned a single
      // worker on copyFileSync and the others never got scheduled until it
      // finished. With async copyFile the OS pumps multiple transfers at once.
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++;
          if (i >= files.length) return;
          const f = files[i]!;
          bumpProgress(await copyOneFile(f.src, f.dest, f.size));
        }
      };
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    }
    bumpProgress(0);
  } finally { bar.stop(); }
}

/** Rough peak host temp (GB) for Fast install: model stage + optional full binary stage on host. */
export function estimateFastHostTempGB(modelSizeGB: number, fullBinaryStageOnHost: boolean): number {
  const binaryPeak = fullBinaryStageOnHost ? 8 : 2;
  return Math.ceil(modelSizeGB * 2 + 1 + binaryPeak);
}
