// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import path from "node:path";
import type { Target } from "../catalog/targets.js";

/**
 * Win32 MAX_PATH=260 has bitten us in pre-staged node_modules trees: a USB
 * mounted at a deep mount point plus `cache/opencode/node_modules/@ai-sdk/
 * openai-compatible/dist/internal/...` blows past 260 chars and fs ops fail
 * with ENAMETOOLONG. The `\\?\` namespace prefix lifts the limit to ~32K
 * chars per segment for individual fs calls.
 *
 * Rules for a safe prefix:
 *   - only on Win32
 *   - only for ABSOLUTE paths (relative paths must remain relative)
 *   - skip if already prefixed with \\?\ or \\.\
 *   - UNC paths use \\?\UNC\server\share form; we leave plain UNC alone since
 *     code-stick targets local USB mounts (drive-letter paths)
 *   - normalize forward slashes — \\?\ namespace is literal, no path resolver
 */
export function toLongPath(p: string): string {
  if (process.platform !== "win32") return p;
  if (!p) return p;
  if (p.startsWith("\\\\?\\") || p.startsWith("\\\\.\\")) return p;
  if (!path.isAbsolute(p)) return p;
  const normalized = path.normalize(p).replace(/\//g, "\\");
  if (normalized.startsWith("\\\\")) {
    // UNC: \\server\share\... → \\?\UNC\server\share\...
    return `\\\\?\\UNC\\${normalized.slice(2)}`;
  }
  return `\\\\?\\${normalized}`;
}

/**
 * Layout written to the USB:
 *   <root>/code-stick.json              manifest
 *   <root>/engine/<target>/             ollama binary for each target
 *   <root>/opencode/<target>/           opencode binary for each target
 *   <root>/data/                        OLLAMA_MODELS — model blobs live here
 *   <root>/config/                      XDG_CONFIG_HOME redirect (opencode/opencode.json lives here)
 *   <root>/cache/                       XDG_CACHE_HOME redirect (opencode/node_modules pre-staged here)
 *   <root>/state/                       XDG_STATE_HOME redirect (opencode runtime state)
 *   <root>/start-windows.bat
 *   <root>/start-mac.command
 *   <root>/start-linux.sh
 */
export function usbPaths(root: string) {
  return {
    root,
    manifest: path.join(root, "code-stick.json"),
    engine: (target: Target) => path.join(root, "engine", target),
    opencode: (target: Target) => path.join(root, "opencode", target),
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    opencodeConfig: path.join(root, "config", "opencode.json"),
    // opencode resolves npm-declared providers under
    // $XDG_CACHE_HOME/opencode/node_modules. Pre-staged at install time so
    // the standalone binary never reaches out to npm at runtime.
    opencodeCache: path.join(root, "cache", "opencode"),
    launcher: (kind: "windows" | "mac" | "linux") => {
      if (kind === "windows") return path.join(root, "start-windows.bat");
      if (kind === "mac") return path.join(root, "start-mac.command");
      return path.join(root, "start-linux.sh");
    },
  };
}

export type USBPaths = ReturnType<typeof usbPaths>;

/** path.join with a traversal guard. Throws when child escapes parent. */
export function safeJoin(parent: string, child: string): string {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(parentResolved, child);
  const rel = path.relative(parentResolved, childResolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Refusing to write outside ${parentResolved}: "${child}" resolves to ${childResolved}`
    );
  }
  return childResolved;
}
