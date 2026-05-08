// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { usbPaths } from "../utils/paths.js";
import type { Target } from "../catalog/targets.js";
import { log } from "../utils/logger.js";

export interface ManifestModel {
  id: string;
  tag: string;
  /** ISO timestamp the model was first pulled to this stick. */
  addedAt: string;
}

/**
 * Structured Ollama version map. Win/macOS pin a different release than Linux
 * (linux-only stayed on the last .tgz release until our extractor speaks
 * .tar.zst), so a single string can't represent reality. Keep `host` for
 * the Win/macOS pin, `linux` for the Linux pin.
 */
export interface OllamaVersionMap {
  host: string;
  linux: string;
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
  /**
   * Ollama version per target family. Stored as a structured object so
   * upgrade tooling can reason about per-target drift. We accept a string
   * on read for backwards compatibility with manifests written before the
   * split (those get migrated on the next saveManifest).
   */
  ollamaVersions: OllamaVersionMap;
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

/**
 * Parse the legacy free-form `ollamaVersion` strings written by older
 * code-stick installs. The historical format was either a bare semver
 * ("v0.21.2") or "v0.21.2 (linux=v0.13.0)". Anything we can't parse falls
 * back to the same string for both fields — better than dropping data.
 */
function parseLegacyOllamaVersion(s: unknown): OllamaVersionMap {
  if (typeof s !== "string" || !s) return { host: "", linux: "" };
  const m = /^([^\s(]+)\s*\(linux=([^)]+)\)$/.exec(s.trim());
  if (m) return { host: m[1].trim(), linux: m[2].trim() };
  return { host: s.trim(), linux: s.trim() };
}

function normalizeOllamaVersions(raw: unknown): OllamaVersionMap | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.host === "string" && typeof o.linux === "string") {
      return { host: o.host, linux: o.linux };
    }
  }
  if (typeof raw === "string") return parseLegacyOllamaVersion(raw);
  return null;
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
      ollamaVersions: parseLegacyOllamaVersion(v1.ollamaVersion),
      opencodeVersion: v1.opencodeVersion,
    };
  }

  if (obj.version !== "2") return null;
  // Read the v2 shape carefully — some fields may be in their pre-split
  // legacy form on existing sticks. We normalize on read so consumers see
  // a stable shape; the on-disk file gets upgraded on the next saveManifest.
  const m = obj as unknown as Record<string, unknown>;
  if (!Array.isArray(m.models)) return null;
  if (typeof m.defaultModelId !== "string") return null;
  if (!Array.isArray(m.targets)) return null;

  const versions = normalizeOllamaVersions(
    (m as { ollamaVersions?: unknown; ollamaVersion?: unknown }).ollamaVersions
      ?? (m as { ollamaVersion?: unknown }).ollamaVersion,
  );
  if (!versions) return null;

  const out: Manifest = {
    version: "2",
    installedAt: typeof m.installedAt === "string" && !Number.isNaN(Date.parse(m.installedAt as string))
      ? (m.installedAt as string)
      : "",
    models: m.models as ManifestModel[],
    defaultModelId: m.defaultModelId as string,
    targets: m.targets as Target[],
    ollamaVersions: versions,
    opencodeVersion: typeof m.opencodeVersion === "string" ? m.opencodeVersion : "",
  };
  if (typeof m.updatedAt === "string" && !Number.isNaN(Date.parse(m.updatedAt))) {
    out.updatedAt = m.updatedAt;
  }
  return out;
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

// Module-local guard so the warning fires once per process, not on every
// caller (start, status, opencode-config can all invoke this within one run).
let warnedFallback = false;

export function defaultModel(manifest: Manifest): ManifestModel | null {
  if (manifest.models.length === 0) return null;
  const m = manifest.models.find((x) => x.id === manifest.defaultModelId);
  if (!m) {
    // Manifest's defaultModelId points at a model that's no longer installed
    // (e.g. the user removed the default with `remove-model --force`). Fall
    // back to the first model so the launcher still works, but make it
    // visible — silently launching the wrong model is a worse failure mode
    // than printing a one-line warning.
    const fallback = manifest.models[0];
    if (!warnedFallback) {
      warnedFallback = true;
      log.warn(
        `Manifest defaultModelId "${manifest.defaultModelId}" is not installed. ` +
        `Falling back to "${fallback.id}". ` +
        `Run \`code-stick add-model ${manifest.defaultModelId} --set-default\` to restore, ` +
        `or pick a new default with \`code-stick add-model <id> --set-default\`.`,
      );
    }
    return fallback;
  }
  return m;
}
