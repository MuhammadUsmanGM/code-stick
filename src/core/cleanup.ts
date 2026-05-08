// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";
import { ALL_TARGETS } from "../catalog/targets.js";

/**
 * After a successful install, sweep installer archives, partial downloads, and
 * temp staging dirs.
 *
 * IMPORTANT: this used to walk the entire USB root 6 levels deep, which would
 * delete unrelated user .zip / .tar.gz files the user happens to keep on the
 * stick. We now restrict the sweep to dirs we actually own:
 *   - tempDir (where the downloader writes archives + .partial files)
 *   - engine/<target>/ and opencode/<target>/ (extract destinations — the
 *     archive may have lingered if extraction left a copy alongside).
 *
 * Model blobs under <root>/data are never touched.
 */
export function postInstallCleanup(drivePath: string, tempDir: string): void {
  let removed = 0;
  let bytes = 0;

  const sweepRoots: string[] = [];
  for (const t of ALL_TARGETS) {
    sweepRoots.push(path.join(drivePath, "engine", t));
    sweepRoots.push(path.join(drivePath, "opencode", t));
  }

  const visit = (dir: string, depth = 0) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { visit(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      const isArchive =
        lower.endsWith(".zip") ||
        lower.endsWith(".tgz") ||
        lower.endsWith(".tar.gz") ||
        lower.endsWith(".tar");
      const isPartial = lower.endsWith(".partial");
      if (!isArchive && !isPartial) continue;
      try {
        const sz = fs.statSync(full).size;
        fs.unlinkSync(full);
        removed++; bytes += sz;
      } catch { /* ignore */ }
    }
  };

  for (const root of sweepRoots) visit(root);

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
