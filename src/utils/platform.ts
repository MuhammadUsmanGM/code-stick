// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a | MUGM-fix4-arch
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Target } from "../catalog/targets.js";

export type Platform = "windows" | "mac" | "linux";

/** Identify the host OS family. Throws on unsupported (e.g. freebsd). */
export function getPlatform(): Platform {
  const p = os.platform();
  if (p === "win32") return "windows";
  if (p === "darwin") return "mac";
  if (p === "linux") return "linux";
  throw new Error(
    `code-stick must be run on Windows, macOS, or Linux (detected: ${p}).`
  );
}

export function isWindows(): boolean { return os.platform() === "win32"; }
export function isMac(): boolean { return os.platform() === "darwin"; }
export function isLinux(): boolean { return os.platform() === "linux"; }

/** Map the host platform + arch to the bundled-asset target. */
export function hostTarget(): Target {
  const plat = getPlatform();
  const arch = os.arch();
  if (plat === "windows") return (arch === "arm64" || arch === "aarch64") ? "windows-arm64" : "windows-x64";
  if (plat === "mac") return arch === "x64" ? "darwin-x64" : "darwin-arm64";
  // linux
  return arch === "arm64" || arch === "aarch64" ? "linux-arm64" : "linux-x64";
}

/**
 * Same fallback chain the Windows `start.bat` launcher uses at runtime: if the
 * native target isn't staged on this stick, fall back to the closest emulated
 * arch. Windows ARM64 hosts can run x64 binaries via Prism; macOS ARM64 runs
 * x64 binaries via Rosetta. Linux ARM64 → x64 has no fast emulation layer that
 *'s worth recommending, so we refuse and surface a clear error instead of
 * pretending qemu will fix it.
 *
 * Returns the Target that should actually be invoked on this host given what's
 * available on the stick. `installedTargets` is typically `manifest.targets`.
 * A stick that lists nothing (legacy manifest) is treated as fully portable.
 */
export function resolveEngineTarget(
  installedTargets: readonly Target[] | undefined,
  isOnStick: (t: Target) => boolean,
): Target {
  const native = hostTarget();
  const staged = (installedTargets && installedTargets.length > 0)
    ? new Set<Target>(installedTargets)
    : null; // null = unknown → trust the on-disk check only

  const tryTarget = (t: Target): boolean => {
    if (staged && !staged.has(t)) return false;
    return isOnStick(t);
  };

  if (tryTarget(native)) return native;

  // Per-arch fallback. Order matters: native first (above), then emulated.
  if (native === "windows-arm64" && tryTarget("windows-x64")) return "windows-x64";
  if (native === "darwin-arm64" && tryTarget("darwin-x64")) return "darwin-x64";

  // No safe fallback — surface what we tried so the remedy is obvious.
  const candidates: Target[] =
    native === "windows-arm64" ? ["windows-arm64", "windows-x64"] :
    native === "darwin-arm64"  ? ["darwin-arm64", "darwin-x64"] :
    [native];
  throw new Error(
    `No usable engine target on this stick for host ${native}. ` +
    `Tried: ${candidates.join(", ")}. ` +
    `Run \`code-stick add-targets ${native}\` to stage the missing binaries.`,
  );
}

/**
 * Convenience: probe the on-disk binary directly via the engine binary path.
 * Used by command code that already has a `drivePath` and the helper that
 * builds `<USB>/engine/<target>/...`.
 */
export function makeBinaryProbe(
  engineDirOf: (t: Target) => string,
  ollamaBinaryRel: (t: Target) => string,
): (t: Target) => boolean {
  return (t: Target) => {
    const bin = path.join(engineDirOf(t), ollamaBinaryRel(t));
    try { return fs.statSync(bin).isFile(); } catch { return false; }
  };
}
