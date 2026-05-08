// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";
import { promptWithEsc } from "../utils/prompt.js";
import { pickDrive, assertDriveReady } from "../core/usb.js";
import { usbPaths } from "../utils/paths.js";
import { loadManifest } from "../state/manifest.js";

interface UninstallOptions {
  target?: string;
  yes?: boolean;
  force?: boolean;
}

const REMOVE_DIRS = ["engine", "opencode", "data", "config", "cache", "state", ".code-stick-tmp"];
const REMOVE_FILES = [
  "code-stick.json",
  "code-stick.json.lock",
  "start-windows.bat",
  "start-mac.command",
  "start-linux.sh",
];

export async function uninstallCommand(opts: UninstallOptions): Promise<void> {
  log.banner("Uninstall");

  const drivePath = await pickDrive(opts.target);
  assertDriveReady(drivePath);

  const manifest = loadManifest(drivePath);
  if (manifest) {
    log.info(`Drive: ${drivePath}`);
    log.dim(`  Models: ${manifest.models.map((m) => m.tag).join(", ")}`);
    log.dim(`  Installed: ${manifest.installedAt}`);
  } else {
    // No manifest = we cannot prove this directory was ever a code-stick
    // install. Generic dir names like `data/`, `config/`, `cache/`, `state/`
    // collide with anything a user might keep in their home dir or on a
    // shared volume — refusing here prevents accidental destruction of
    // unrelated user data when someone passes the wrong --target.
    if (!opts.force) {
      log.error(
        `No code-stick manifest (code-stick.json) at ${drivePath}.\n` +
        `Refusing to wipe directories that may not belong to code-stick.\n` +
        `If you are sure this is the right target, re-run with --force.`,
      );
      process.exitCode = 1;
      return;
    }
    log.warn(`No code-stick manifest at ${drivePath} — proceeding because --force was passed.`);
  }

  if (!opts.yes) {
    const ans = await promptWithEsc<{ confirm: boolean }>([
      {
        type: "confirm",
        name: "confirm",
        message: `This will permanently delete code-stick from ${drivePath}. Continue?`,
        default: false,
      },
    ]);
    if (!ans || !ans.confirm) { log.info("Cancelled."); return; }
  }

  const p = usbPaths(drivePath);
  const before = directorySize(drivePath, REMOVE_DIRS);
  let removedBytes = 0;

  for (const rel of REMOVE_DIRS) {
    const full = path.join(drivePath, rel);
    if (!fs.existsSync(full)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true });
      log.dim(`Removed ${rel}/`);
    } catch (err) {
      log.warn(`Could not remove ${rel}/: ${(err as Error).message}`);
    }
  }

  for (const rel of REMOVE_FILES) {
    const full = rel === "code-stick.json" ? p.manifest : path.join(drivePath, rel);
    if (!fs.existsSync(full)) continue;
    try {
      fs.unlinkSync(full);
      log.dim(`Removed ${rel}`);
    } catch (err) {
      log.warn(`Could not remove ${rel}: ${(err as Error).message}`);
    }
  }

  removedBytes = before;
  log.success(`Uninstalled code-stick from ${drivePath}`);
  if (removedBytes > 0) {
    log.dim(`Freed approximately ${(removedBytes / 1e9).toFixed(2)} GB`);
  }
}

function directorySize(root: string, subdirs: string[]): number {
  let total = 0;
  for (const sub of subdirs) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
        const full = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(full);
        else if (e.isFile()) {
          try { total += fs.statSync(full).size; } catch { /* ignore */ }
        }
      }
    }
  }
  return total;
}
