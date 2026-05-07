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
  // An empty `models` array is a legitimate state — `code-stick remove-model
  // --force` of the last model leaves the manifest in this shape until the
  // user runs add-model again. Reject only the truly malformed cases.
  if (!Array.isArray(m.models)) return null;
  if (typeof m.defaultModelId !== "string") return null;
  if (!Array.isArray(m.targets)) return null;
  if (typeof m.installedAt !== "string" || Number.isNaN(Date.parse(m.installedAt))) m.installedAt = "";
  if (m.updatedAt !== undefined) {
    const ok = typeof m.updatedAt === "string" && !Number.isNaN(Date.parse(m.updatedAt));
    if (!ok) delete m.updatedAt;
  }
  return m;
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

export function defaultModel(manifest: Manifest): ManifestModel | null {
  if (manifest.models.length === 0) return null;
  const m = manifest.models.find((x) => x.id === manifest.defaultModelId);
  if (!m) {
    // Manifest claims a default that doesn't exist — fall back to first.
    return manifest.models[0];
  }
  return m;
}
