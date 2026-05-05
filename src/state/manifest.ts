// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { usbPaths } from "../utils/paths.js";
import type { Target } from "../catalog/targets.js";

export interface Manifest {
  version: string;
  installedAt: string;
  updatedAt?: string;
  model: {
    id: string;
    tag: string;
  };
  /** Targets actually present on this USB. */
  targets: Target[];
  ollamaVersion: string;
  opencodeVersion: string;
}

export function loadManifest(drivePath: string): Manifest | null {
  const p = usbPaths(drivePath);
  try {
    const raw = fs.readFileSync(p.manifest, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.version || !parsed.model?.id || !parsed.model?.tag || !Array.isArray(parsed.targets)) {
      return null;
    }
    if (parsed.updatedAt !== undefined) {
      const ok = typeof parsed.updatedAt === "string" && !Number.isNaN(Date.parse(parsed.updatedAt));
      if (!ok) delete parsed.updatedAt;
    }
    if (typeof parsed.installedAt !== "string" || Number.isNaN(Date.parse(parsed.installedAt))) {
      parsed.installedAt = "";
    }
    return parsed as Manifest;
  } catch {
    return null;
  }
}

const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 10 * 60 * 1000;

function acquireManifestLock(lockPath: string): void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const payload = JSON.stringify({ pid: process.pid, host: os.hostname(), at: Date.now() });

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try { fs.writeSync(fd, payload); } finally { fs.closeSync(fd); }
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;

      let stale = false;
      try {
        const raw = fs.readFileSync(lockPath, "utf-8");
        const info = JSON.parse(raw) as { pid?: number; host?: string; at?: number };
        const sameHost = info.host === os.hostname();
        const ageMs = info.at ? Date.now() - info.at : Infinity;
        if (sameHost && info.pid && !pidAlive(info.pid)) stale = true;
        if (ageMs > LOCK_STALE_MS) stale = true;
      } catch { stale = true; }

      if (stale) {
        try { fs.unlinkSync(lockPath); } catch { /* race */ }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Could not acquire manifest lock (${lockPath}) within ${LOCK_TIMEOUT_MS}ms.`
        );
      }
      sleepSync(100);
    }
  }
}

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms: number): void { Atomics.wait(sleepBuf, 0, 0, ms); }

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as NodeJS.ErrnoException).code === "EPERM"; }
}

export function saveManifest(drivePath: string, manifest: Manifest): void {
  const p = usbPaths(drivePath);
  const dir = path.dirname(p.manifest);
  const tmp = path.join(dir, `.${path.basename(p.manifest)}.${process.pid}.tmp`);
  const lockPath = `${p.manifest}.lock`;
  const data = JSON.stringify(manifest, null, 2);

  acquireManifestLock(lockPath);
  try {
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeSync(fd, data);
      try { fs.fsyncSync(fd); } catch { /* fsync may not be supported on FAT/exFAT */ }
    } finally { fs.closeSync(fd); }
    try { fs.renameSync(tmp, p.manifest); }
    catch (err) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw err; }
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* lock may have been stolen */ }
  }
}
