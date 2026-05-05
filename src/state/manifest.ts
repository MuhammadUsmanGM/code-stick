// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { usbPaths } from "../utils/paths.js";
import type { Target } from "../catalog/targets.js";

export interface ManifestModel {
  id: string;
  tag: string;
  /** ISO timestamp the model was first pulled to this stick. */
  addedAt: string;
}

/** v2 schema — multi-model. v1 (single `model`) is migrated transparently. */
export interface Manifest {
  version: "2";
  installedAt: string;
  updatedAt?: string;
  /** All coding models currently stored on this stick. */
  models: ManifestModel[];
  /** Tag of the model launchers + opencode default to. */
  defaultModelId: string;
  /** Targets actually present on this USB. */
  targets: Target[];
  ollamaVersion: string;
  opencodeVersion: string;
}

interface ManifestV1 {
  version: "1";
  installedAt: string;
  updatedAt?: string;
  model: { id: string; tag: string };
  targets: Target[];
  ollamaVersion: string;
  opencodeVersion: string;
}

export function loadManifest(drivePath: string): Manifest | null {
  const p = usbPaths(drivePath);
  let parsed: unknown;
  try {
    const raw = fs.readFileSync(p.manifest, "utf-8");
    parsed = JSON.parse(raw);
  } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  // v1 → v2 migration. Stick stays on disk in v1 shape until next saveManifest.
  if (obj.version === "1") {
    const v1 = obj as unknown as ManifestV1;
    if (!v1.model?.id || !v1.model?.tag || !Array.isArray(v1.targets)) return null;
    return {
      version: "2",
      installedAt: v1.installedAt || "",
      updatedAt: v1.updatedAt,
      models: [{ id: v1.model.id, tag: v1.model.tag, addedAt: v1.installedAt || new Date().toISOString() }],
      defaultModelId: v1.model.id,
      targets: v1.targets,
      ollamaVersion: v1.ollamaVersion,
      opencodeVersion: v1.opencodeVersion,
    };
  }

  if (obj.version !== "2") return null;
  const m = obj as unknown as Manifest;
  if (!Array.isArray(m.models) || m.models.length === 0 || !m.defaultModelId) return null;
  if (!Array.isArray(m.targets)) return null;
  if (typeof m.installedAt !== "string" || Number.isNaN(Date.parse(m.installedAt))) m.installedAt = "";
  if (m.updatedAt !== undefined) {
    const ok = typeof m.updatedAt === "string" && !Number.isNaN(Date.parse(m.updatedAt));
    if (!ok) delete m.updatedAt;
  }
  return m;
}

const LOCK_TIMEOUT_MS = 30_000;
// Long-running operations (model pull on slow USB) can easily exceed 10 min.
// The lock holder refreshes the timestamp periodically so other processes
// don't reclaim it; this stale window is the absolute fallback if the holder
// crashes without releasing.
const LOCK_STALE_MS = 60 * 60 * 1000;
const LOCK_HEARTBEAT_MS = 5 * 60 * 1000;

function writeLockPayload(lockPath: string): void {
  const payload = JSON.stringify({ pid: process.pid, host: os.hostname(), at: Date.now() });
  try { fs.writeFileSync(lockPath, payload); } catch { /* best-effort heartbeat */ }
}

function acquireManifestLock(lockPath: string): void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        const payload = JSON.stringify({ pid: process.pid, host: os.hostname(), at: Date.now() });
        fs.writeSync(fd, payload);
      } finally { fs.closeSync(fd); }
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

function writeManifestUnlocked(drivePath: string, manifest: Manifest): void {
  const p = usbPaths(drivePath);
  const dir = path.dirname(p.manifest);
  const tmp = path.join(dir, `.${path.basename(p.manifest)}.${process.pid}.tmp`);
  const data = JSON.stringify(manifest, null, 2);

  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, data);
    try { fs.fsyncSync(fd); } catch { /* fsync may not be supported on FAT/exFAT */ }
  } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, p.manifest); }
  catch (err) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw err; }
}

export function saveManifest(drivePath: string, manifest: Manifest): void {
  const p = usbPaths(drivePath);
  const lockPath = `${p.manifest}.lock`;
  acquireManifestLock(lockPath);
  try { writeManifestUnlocked(drivePath, manifest); }
  finally { try { fs.unlinkSync(lockPath); } catch { /* lock may have been stolen */ } }
}

/**
 * Hold the manifest lock across the entire load → mutate → save cycle so
 * concurrent invocations cannot lose writes. `fn` receives the freshly-loaded
 * manifest; if it returns a Manifest the file is rewritten, if it returns null
 * the lock is released without writing.
 */
export async function withManifestLock<T>(
  drivePath: string,
  fn: (manifest: Manifest | null) => Promise<{ manifest: Manifest | null; result: T }>,
): Promise<T> {
  const p = usbPaths(drivePath);
  const lockPath = `${p.manifest}.lock`;
  acquireManifestLock(lockPath);
  const heartbeat = setInterval(() => writeLockPayload(lockPath), LOCK_HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();
  try {
    const current = loadManifest(drivePath);
    const { manifest, result } = await fn(current);
    if (manifest) writeManifestUnlocked(drivePath, manifest);
    return result;
  } finally {
    clearInterval(heartbeat);
    try { fs.unlinkSync(lockPath); } catch { /* lock may have been stolen */ }
  }
}

export function defaultModel(manifest: Manifest): ManifestModel {
  const m = manifest.models.find((x) => x.id === manifest.defaultModelId);
  if (!m) {
    // Manifest claimed a default that doesn't exist — fall back to first.
    return manifest.models[0];
  }
  return m;
}
