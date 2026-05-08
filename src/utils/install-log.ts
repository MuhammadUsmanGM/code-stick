// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-d3f2-4b7c
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Append-only JSONL log for install / upgrade / model operations.
 *
 * Bug reports without a log are guesses. The entire chain of "downloaded X,
 * extracted to Y, picked binary at Z, pull failed with W" is captured here so
 * the user can attach a single file and we can reconstruct what happened.
 *
 * The logger is opt-in per command — call `openInstallLog(drivePath, command)`
 * at the top of a command, log freely, then `closeInstallLog()` in a finally.
 * If `openInstallLog` fails (USB ejected mid-run, FS read-only) we degrade
 * silently — no user-facing log is worse than no install.
 */

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "dim" | "debug";
  msg: string;
  /** Optional structured payload — counters, sizes, target ids, etc. */
  meta?: Record<string, unknown>;
}

interface ActiveLog {
  fd: number;
  filePath: string;
  drivePath: string;
  command: string;
  /** Bytes written this session. Caps file at MAX_BYTES — pre-existing content
   *  is rotated on open if already too large. */
  written: number;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB — generous; we're appending JSONL.
const ROTATE_KEEP = 2; // keep .1 and .2

let active: ActiveLog | null = null;

export function openInstallLog(drivePath: string, command: string): void {
  if (active) closeInstallLog();
  try {
    const stateDir = path.join(drivePath, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const filePath = path.join(stateDir, "install.log");
    rotateIfTooLarge(filePath);
    const fd = fs.openSync(filePath, "a");
    active = { fd, filePath, drivePath, command, written: 0 };
    write({
      level: "info",
      msg: "session start",
      meta: {
        command,
        drivePath,
        version: typeof (globalThis as { PKG_VERSION?: string }).PKG_VERSION === "string"
          ? (globalThis as { PKG_VERSION?: string }).PKG_VERSION
          : "dev",
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        host: os.hostname(),
        pid: process.pid,
      },
    });
  } catch {
    // Read-only USB, missing dir, etc. — silently disable.
    active = null;
  }
}

export function closeInstallLog(reason?: string): void {
  if (!active) return;
  try {
    write({ level: "info", msg: "session end", meta: { reason: reason ?? "ok" } });
    fs.fsyncSync(active.fd);
  } catch { /* ignore */ }
  try { fs.closeSync(active.fd); } catch { /* ignore */ }
  active = null;
}

export function logToInstall(level: LogEntry["level"], msg: string, meta?: Record<string, unknown>): void {
  if (!active) return;
  write({ level, msg, meta });
}

function write(entry: Omit<LogEntry, "ts">): void {
  if (!active) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  try {
    fs.writeSync(active.fd, line);
    active.written += Buffer.byteLength(line, "utf8");
    // Periodic fsync — on USB sticks the OS may buffer for minutes. We don't
    // need every line durable, but we do need the log to survive a crash.
    if (active.written % (64 * 1024) < line.length) {
      try { fs.fsyncSync(active.fd); } catch { /* fsync may not be supported on FAT */ }
    }
  } catch { /* USB ejected mid-write — drop silently */ }
}

function rotateIfTooLarge(filePath: string): void {
  let size = 0;
  try { size = fs.statSync(filePath).size; }
  catch { return; } // no existing file → nothing to rotate
  if (size < MAX_BYTES) return;
  // Rotate filePath -> .1, .1 -> .2, drop .2.
  for (let i = ROTATE_KEEP; i >= 1; i--) {
    const from = i === 1 ? filePath : `${filePath}.${i - 1}`;
    const to = `${filePath}.${i}`;
    try { fs.renameSync(from, to); }
    catch { /* missing rung */ }
  }
}

/** Drive path of the currently active log session, or null. Used by error
 *  formatters to point users at the right file in remediation messages. */
export function activeLogPath(): string | null {
  return active?.filePath ?? null;
}
