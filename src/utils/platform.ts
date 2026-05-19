// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import os from "node:os";
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
