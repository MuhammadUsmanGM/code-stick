// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";

/**
 * After a successful install, sweep installer archives, partial downloads, and
 * temp staging dirs from the USB. Model blobs under <root>/data are preserved.
 */
export function postInstallCleanup(drivePath: string, tempDir: string): void {
  let removed = 0;
  let bytes = 0;

  const visit = (dir: string, depth = 0) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      // Never recurse into the model-blob store.
      if (e.isDirectory() && depth === 0 && e.name === "data") continue;
      if (e.isDirectory()) { visit(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      const isArchive = lower.endsWith(".zip") || lower.endsWith(".tgz") || lower.endsWith(".tar.gz") || lower.endsWith(".tar");
      const isPartial = lower.endsWith(".partial");
      if (!isArchive && !isPartial) continue;
      try {
        const sz = fs.statSync(full).size;
        fs.unlinkSync(full);
        removed++; bytes += sz;
      } catch { /* ignore */ }
    }
  };

  visit(drivePath);

  if (fs.existsSync(tempDir)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      log.dim(`Removed temp staging dir`);
    } catch (err) {
      log.dim(`Could not remove temp dir: ${(err as Error).message}`);
    }
  }

  if (removed > 0) {
    log.dim(`Cleaned up ${removed} installer file(s) — ${(bytes / 1e9).toFixed(2)} GB freed`);
  }
}
