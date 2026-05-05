// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import path from "node:path";
import type { Target } from "../catalog/targets.js";

/**
 * Layout written to the USB:
 *   <root>/code-stick.json              manifest
 *   <root>/engine/<target>/             ollama binary for each target
 *   <root>/opencode/<target>/           opencode binary for each target
 *   <root>/data/                        OLLAMA_MODELS — model blobs live here
 *   <root>/config/                      opencode.json + per-app config (XDG/APPDATA redirect target)
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
    opencodeConfig: path.join(root, "config", "opencode.json"),
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
