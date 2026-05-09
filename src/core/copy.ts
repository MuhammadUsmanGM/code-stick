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

/** Copy a directory tree with a real progress bar (MB / speed / ETA). */
export async function copyDirWithProgress(
  src: string,
  dest: string,
  label: string,
): Promise<void> {
  fs.mkdirSync(dest, { recursive: true });
  const { files, totalBytes } = walkTree(src, dest);
  if (files.length === 0) return;

  const totalMB = Math.max(1, Math.round(totalBytes / 1e6));
  const bar = createProgress();

  bar.start(totalMB, 0, {
    label: label.padEnd(30),
    speed: "0.00",
    current: 0,
    total: totalMB,
    eta_display: "calculating...",
  });

  const startTime = Date.now();
  let copiedBytes = 0;
  let lastTime = startTime;
  let lastBytes = 0;

  try {
    const dirs = new Set<string>();
    for (const f of files) dirs.add(path.dirname(f.dest));
    for (const d of dirs) fs.mkdirSync(toLongPath(d), { recursive: true });

    for (const f of files) {
      const longSrc = toLongPath(f.src);
      const longDest = toLongPath(f.dest);
      // Skip files that already match by size — protects re-runs after a USB
      // unplug/ENOSPC: anything fully copied last time is preserved.
      try {
        const st = fs.statSync(longDest);
        if (st.isFile() && st.size === f.size) {
          copiedBytes += f.size;
          continue;
        }
      } catch { /* dest doesn't exist yet — normal first-pass case */ }
      // Atomic file write: stage as <dest>.partial, fsync, then rename. If
      // the user unplugs the USB or hits ENOSPC mid-copy, only a .partial
      // file remains — Ollama never sees a torn blob, and a re-run will
      // overwrite the partial with a fresh copy.
      const stagePath = `${longDest}.partial`;
      try { fs.unlinkSync(stagePath); } catch { /* not present, that's fine */ }
      fs.copyFileSync(longSrc, stagePath);
      try {
        const fd = fs.openSync(stagePath, "r+");
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      } catch { /* fsync best-effort: FAT/exFAT may not support it */ }
      fs.renameSync(stagePath, longDest);
      copiedBytes += f.size;

      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed >= 0.3 || copiedBytes === totalBytes) {
        const speedVal = (copiedBytes - lastBytes) / Math.max(elapsed, 0.001) / 1e6;
        lastTime = now;
        lastBytes = copiedBytes;

        let eta_display = "calculating...";
        if (speedVal > 0 && totalBytes > copiedBytes) {
          const remainingSecs = Math.round((totalBytes - copiedBytes) / (speedVal * 1e6));
          if (remainingSecs < 60) eta_display = `${remainingSecs}s`;
          else if (remainingSecs < 3600) {
            const mins = Math.floor(remainingSecs / 60);
            const secs = remainingSecs % 60;
            eta_display = `${mins}m ${secs}s`;
          } else {
            const hrs = Math.floor(remainingSecs / 3600);
            const mins = Math.floor((remainingSecs % 3600) / 60);
            eta_display = `${hrs}h ${mins}m`;
          }
        } else if (copiedBytes === totalBytes) eta_display = "0s";

        bar.update(Math.round(copiedBytes / 1e6), {
          speed: speedVal.toFixed(2),
          current: Math.round(copiedBytes / 1e6),
          eta_display,
        });
      }
    }
  } finally { bar.stop(); }
}
