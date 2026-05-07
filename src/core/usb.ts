// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import inquirer from "inquirer";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { log } from "../utils/logger.js";
import { promptWithEsc } from "../utils/prompt.js";

interface DriveChoice { name: string; value: string; }

interface DrivelistMountpoint { path: string; label?: string; }
interface DrivelistEntry {
  isRemovable: boolean;
  mountpoints: DrivelistMountpoint[];
  size?: number;
  description?: string;
}
interface DrivelistApi { list: () => Promise<DrivelistEntry[]>; }

let drivelistCache: DrivelistApi | null | undefined;
let drivelistWarned = false;

/**
 * drivelist has native bindings — on hosts without the prebuilt addon for the
 * current arch (Windows without VS Build Tools is the common one) `npm install`
 * skips it (it's an optionalDependency). A static `import` would crash the
 * whole CLI at module-load time, including `--version` and `--target`. Load it
 * lazily so commands that don't need auto-detection still work.
 */
async function loadDrivelist(): Promise<DrivelistApi | null> {
  if (drivelistCache !== undefined) return drivelistCache;
  try {
    const mod: unknown = await import("drivelist");
    // CJS-via-ESM can yield: the module itself, { default: module }, or
    // { default: { list }, list }. Find whichever shape exposes `.list`.
    const candidates: unknown[] = [
      (mod as { default?: unknown })?.default,
      mod,
      (mod as { default?: { default?: unknown } })?.default?.default,
    ];
    for (const c of candidates) {
      if (c && typeof (c as DrivelistApi).list === "function") {
        drivelistCache = c as DrivelistApi;
        return drivelistCache;
      }
    }
    throw new Error("drivelist module loaded but `.list` is not a function");
  } catch (err) {
    drivelistCache = null;
    if (!drivelistWarned) {
      drivelistWarned = true;
      log.warn(
        "Could not load drivelist (likely missing native deps). " +
        "Auto-detection disabled — use --target <path> or enter the path manually."
      );
      log.dim(`  reason: ${(err as Error).message}`);
    }
    return null;
  }
}

export async function detectUSBDrives(): Promise<DriveChoice[]> {
  const dl = await loadDrivelist();
  if (dl) {
    const drives = await dl.list();
    const removable = drives.filter(
      (d) => d.isRemovable && d.mountpoints.length > 0 && d.size
    );
    return removable.map((d) => {
      const mount = d.mountpoints[0].path;
      const sizeGB = ((d.size || 0) / 1e9).toFixed(1);
      const label = d.mountpoints[0].label || d.description || "USB Drive";
      return { name: `${mount} — ${label} [${sizeGB} GB]`, value: mount };
    });
  }
  // drivelist failed (typical on Windows hosts without VS Build Tools).
  // Fall back to a per-platform native enumerator that doesn't need any
  // compiled bindings. Keeps auto-detection working on a stock Node install.
  return detectUSBDrivesNative();
}

/**
 * Drivelist-less USB enumeration. Currently implemented for Windows; macOS
 * and Linux still rely on drivelist (which builds reliably there because
 * the prebuilt addons cover those platforms or build tools are usually
 * present). Returns [] when the platform isn't supported.
 */
function detectUSBDrivesNative(): DriveChoice[] {
  if (process.platform !== "win32") return [];
  try {
    // Win32_LogicalDisk DriveType=2 → removable. Returns one row per drive
    // letter; we project the columns we need as JSON for parsing.
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | " +
        "Select-Object DeviceID,VolumeName,Size | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 8000 },
    );
    const trimmed = out.trim();
    if (!trimmed) return [];
    type Row = { DeviceID: string; VolumeName?: string | null; Size?: number | null };
    const rows: Row[] = (() => {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    })();
    const result: DriveChoice[] = [];
    for (const r of rows) {
      if (!r?.DeviceID) continue;
      const mount = r.DeviceID.endsWith("\\") ? r.DeviceID : `${r.DeviceID}\\`;
      const sizeGB = r.Size ? (r.Size / 1e9).toFixed(1) : "?";
      const label = r.VolumeName || "USB Drive";
      result.push({ name: `${mount} — ${label} [${sizeGB} GB]`, value: mount });
    }
    return result;
  } catch (err) {
    if (process.env.CODE_STICK_DEBUG === "1") {
      log.dim(`Native USB enumeration failed: ${(err as Error).message}`);
    }
    return [];
  }
}

export function looksLikeSystemPath(p: string): string | null {
  const norm = path.resolve(p).replace(/[\\/]+$/, "") || path.resolve(p);
  if (process.platform === "win32") {
    // Drive roots (E:\, F:\, ...) are the canonical USB install target — the
    // launcher templates rely on USB_ROOT being the drive root. Only block the
    // drive that actually hosts Windows (system drive).
    const driveLetterMatch = norm.match(/^([a-z]):$/i);
    if (driveLetterMatch) {
      const sysRoot = process.env.SystemRoot || "C:\\Windows";
      const sysDrive = sysRoot.match(/^([a-z]):/i)?.[1]?.toLowerCase();
      if (sysDrive && driveLetterMatch[1].toLowerCase() === sysDrive) {
        return `Refusing to install at the system drive root (${p}). Pick a USB drive.`;
      }
      return null;
    }
    const sysRoot = process.env.SystemRoot || "C:\\Windows";
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const blocked = [sysRoot, programFiles, programFilesX86].map((x) => path.resolve(x).toLowerCase());
    const lower = norm.toLowerCase();
    for (const b of blocked) {
      if (lower === b || lower.startsWith(b + path.sep)) {
        return `Refusing to install inside a system directory (${b}).`;
      }
    }
  } else {
    if (norm === "/" || norm === "") return `Refusing to install at the filesystem root (${p}).`;
    const blocked = ["/bin", "/sbin", "/usr", "/etc", "/var", "/boot", "/lib", "/lib64", "/System", "/Library"];
    for (const b of blocked) {
      if (norm === b || norm.startsWith(b + "/")) return `Refusing to install inside a system directory (${b}).`;
    }
  }
  return null;
}

async function isOnRemovableDrive(p: string): Promise<boolean> {
  const dl = await loadDrivelist();
  if (!dl) return false;
  try {
    const resolved = path.resolve(p).toLowerCase();
    const drives = await dl.list();
    for (const d of drives) {
      if (!d.isRemovable) continue;
      for (const mp of d.mountpoints || []) {
        const mount = path.resolve(mp.path).toLowerCase();
        if (
          resolved === mount ||
          resolved.startsWith(mount + path.sep) ||
          resolved.startsWith(mount + "/")
        ) return true;
      }
    }
  } catch { /* drivelist failure */ }
  return false;
}

/** Auto-detect like portable-ai: if exactly one USB is plugged in, confirm it.
 *  Otherwise show a list. Returns null on cancel. */
async function pickUSBDrive(): Promise<string | null> {
  log.info("Detecting USB drives...");
  const drives = await detectUSBDrives();

  if (drives.length === 0) {
    const answer = await promptWithEsc<{ manualPath: string }>([
      {
        type: "input",
        name: "manualPath",
        message: "No USB drives detected. Enter the drive path manually:",
        validate: (input: string) => fs.existsSync(input) || "Path does not exist",
      },
    ]);
    return answer ? answer.manualPath : null;
  }

  if (drives.length === 1) {
    const answer = await promptWithEsc<{ confirm: boolean }>([
      { type: "confirm", name: "confirm", message: `Use ${drives[0].name}?`, default: true },
    ]);
    if (!answer || !answer.confirm) return null;
    return drives[0].value;
  }

  const answer = await promptWithEsc<{ drive: string }>([
    {
      type: "list", name: "drive", message: "Select a USB drive:",
      choices: [...drives, { name: "Enter path manually...", value: "__manual__" }],
    },
  ]);
  if (!answer) return null;
  if (answer.drive === "__manual__") {
    const m = await promptWithEsc<{ manualPath: string }>([
      {
        type: "input", name: "manualPath", message: "Enter the drive path:",
        validate: (input: string) => fs.existsSync(input) || "Path does not exist",
      },
    ]);
    return m ? m.manualPath : null;
  }
  return answer.drive;
}

/** Pick install destination. Returns null on top-level cancel. */
export async function pickInstallDrive(targetOverride?: string): Promise<string | null> {
  if (targetOverride) {
    if (!fs.existsSync(targetOverride)) throw new Error(`Target path does not exist: ${targetOverride}`);
    const sysReason = looksLikeSystemPath(targetOverride);
    if (sysReason) throw new Error(sysReason);
    const removable = await isOnRemovableDrive(targetOverride);
    if (!removable) {
      log.warn(`${targetOverride} does not appear to be a removable USB drive.`);
      const answer = await promptWithEsc<{ proceed: boolean }>([
        { type: "confirm", name: "proceed", message: `Install to ${targetOverride} anyway?`, default: false },
      ]);
      if (!answer || !answer.proceed) { log.info("Cancelled."); return null; }
    }
    log.info(`Using target: ${targetOverride}`);
    return targetOverride;
  }
  return pickUSBDrive();
}

/** Find an existing installation. */
export async function pickDrive(targetOverride?: string): Promise<string> {
  if (targetOverride) {
    if (!fs.existsSync(targetOverride)) throw new Error(`Target path does not exist: ${targetOverride}`);
    const sysReason = looksLikeSystemPath(targetOverride);
    if (sysReason) throw new Error(sysReason);
    return targetOverride;
  }

  const cwd = process.cwd();
  const cwdManifest = path.join(cwd, "code-stick.json");
  const drives = await detectUSBDrives();
  const usbWithInstall = drives.filter((d) =>
    fs.existsSync(path.join(d.value, "code-stick.json")) && d.value !== cwd
  );

  const choices: { name: string; value: string }[] = [];
  if (fs.existsSync(cwdManifest)) choices.push({ name: `Current directory (${cwd})`, value: cwd });
  for (const d of usbWithInstall) choices.push(d);

  if (choices.length === 0) {
    log.error("No installation found.");
    log.info("Run: code-stick install");
    process.exit(1);
  }
  if (choices.length === 1) {
    log.info(`Found installation: ${choices[0].name}`);
    return choices[0].value;
  }
  const { drive } = await inquirer.prompt([
    { type: "list", name: "drive", message: "Multiple installations found. Select one:", choices },
  ]);
  return drive;
}

export function freeGBFromStats(stats: fs.StatsFsBase<number>): number | null {
  if (!stats.bsize || stats.bsize <= 0) return null;
  const bfree = BigInt(stats.bfree);
  const bsize = BigInt(stats.bsize);
  const freeBytes = bfree * bsize;
  const gbWhole = Number(freeBytes / 1_000_000_000n);
  const gbFrac = Number(freeBytes % 1_000_000_000n) / 1e9;
  const freeGB = gbWhole + gbFrac;
  return Number.isFinite(freeGB) && freeGB >= 0 ? freeGB : null;
}

export function assertDriveReady(drivePath: string): void {
  if (!fs.existsSync(drivePath)) {
    throw new Error(`Target drive ${drivePath} is not available. Reattach and re-run install.`);
  }
  let stat: fs.Stats;
  try { stat = fs.statSync(drivePath); }
  catch (err) { throw new Error(`Cannot access ${drivePath}: ${(err as Error).message}`); }
  if (!stat.isDirectory()) throw new Error(`Target ${drivePath} is not a directory.`);
  const probe = path.join(drivePath, `.code-stick-probe-${process.pid}`);
  try { fs.writeFileSync(probe, "ok"); }
  catch (err) {
    throw new Error(
      `Drive ${drivePath} is not writable: ${(err as Error).message}. ` +
      "Check the write-protect switch / mount options."
    );
  } finally { try { fs.unlinkSync(probe); } catch { /* ignore */ } }
}

/** Free space in GB at any path, or null if not determinable. */
export function getFreeSpaceGB(anyPath: string): number | null {
  try {
    const stats = fs.statfsSync(anyPath);
    return freeGBFromStats(stats);
  } catch { return null; }
}

/** True when both paths sit on the same physical device. */
export function sameDevice(pathA: string, pathB: string): boolean | null {
  try {
    const a = fs.statSync(pathA);
    const b = fs.statSync(pathB);
    return a.dev === b.dev;
  } catch { return null; }
}

export async function checkDiskSpace(drivePath: string, requiredGB: number): Promise<boolean> {
  try {
    const stats = fs.statfsSync(drivePath);
    const freeGB = freeGBFromStats(stats);
    if (freeGB === null) { log.warn("Could not determine free space — proceeding"); return true; }
    if (freeGB < requiredGB) {
      log.warn(`Only ${freeGB.toFixed(1)} GB free. Need at least ${requiredGB} GB.`);
      return false;
    }
    log.dim(`${freeGB.toFixed(1)} GB available`);
    return true;
  } catch { log.warn("Could not check disk space — proceeding"); return true; }
}

/**
 * Best-effort filesystem-type detection. Returns a lowercased identifier
 * (e.g. "fat32", "exfat", "ntfs", "apfs", "ext4") or null when we can't tell.
 *
 * Why this matters: FAT32 has a 4 GB per-file limit. Qwen2.5-Coder 7B's blob is
 * ~4.7 GB and CodeGemma 7B is ~5.0 GB — both exceed the limit. Detecting at
 * install time and bailing with a clear message is much better than a
 * mid-pull ENOSPC-shaped failure.
 */
export function detectFilesystem(drivePath: string): string | null {
  try {
    if (process.platform === "win32") {
      const driveLetter = drivePath.match(/^([a-z]):/i)?.[1];
      if (!driveLetter) return null;
      const out = execFileSync(
        "powershell",
        [
          "-NoProfile", "-NonInteractive", "-Command",
          `(Get-Volume -DriveLetter '${driveLetter}' -ErrorAction Stop).FileSystemType`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 5000 }
      );
      return out.trim().toLowerCase() || null;
    }
    if (process.platform === "darwin") {
      const out = execFileSync("diskutil", ["info", drivePath], { encoding: "utf8", timeout: 5000 });
      const m = out.match(/File System Personality:\s+([^\n]+)/i);
      return m ? m[1].trim().toLowerCase() : null;
    }
    // linux
    const out = execFileSync("findmnt", ["-no", "FSTYPE", "--target", drivePath], { encoding: "utf8", timeout: 5000 });
    return out.trim().toLowerCase() || null;
  } catch { return null; }
}
