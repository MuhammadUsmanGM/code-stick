// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { spawnSync } from "node:child_process";
import { log } from "../utils/logger.js";

/**
 * macOS Gatekeeper quarantines anything that arrived from "external media"
 * (USB, downloads, etc.). Without stripping the com.apple.quarantine xattr,
 * Ollama and opencode will refuse to launch from the stick.
 *
 * Best-effort: silently no-op on non-darwin hosts, on filesystems that don't
 * support xattrs (FAT/exFAT — common for cross-OS sticks), or when xattr is
 * missing. The mac launcher repeats the same call at runtime as a backstop.
 */
export function stripQuarantineIfMac(...paths: string[]): void {
  if (process.platform !== "darwin") return;
  for (const p of paths) {
    const res = spawnSync("xattr", ["-dr", "com.apple.quarantine", p], {
      stdio: "ignore", windowsHide: true,
    });
    if (res.status === 0) log.dim(`Stripped quarantine from ${p}`);
  }
}
