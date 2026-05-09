// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import path from "node:path";
import { spawnSync } from "node:child_process";
import { detectFilesystem } from "./usb.js";
import { log } from "../utils/logger.js";
import type { CodingModel } from "../catalog/models.js";

const FAT32_MAX_FILE_GB = 4;

const FAT_FAMILY = new Set(["fat32", "fat", "msdos", "vfat"]);
const EXFAT_FAMILY = new Set(["exfat"]);

export interface FsInfo {
  raw: string | null;
  isFat32: boolean;
  isExfat: boolean;
  /** True for any filesystem that cannot store the POSIX +x bit. */
  losesExecBit: boolean;
}

export function classifyFilesystem(drivePath: string): FsInfo {
  const raw = detectFilesystem(drivePath);
  const norm = raw?.toLowerCase() ?? null;
  const isFat32 = !!norm && FAT_FAMILY.has(norm);
  const isExfat = !!norm && EXFAT_FAMILY.has(norm);
  return { raw: norm, isFat32, isExfat, losesExecBit: isFat32 || isExfat };
}

/**
 * FAT32 caps individual files at 4 GB. Qwen2.5-Coder 7B (~4.7 GB) and
 * CodeGemma 7B (~5.0 GB) blobs exceed that limit. Detect early and bail with
 * a clear remediation message instead of failing mid-pull.
 */
export function preflightFilesystem(drivePath: string, model: CodingModel): FsInfo {
  const info = classifyFilesystem(drivePath);
  if (!info.raw) {
    log.warn("Could not determine filesystem type — proceeding (FAT32 would block large models).");
    return info;
  }
  log.dim(`Filesystem: ${info.raw}`);
  if (info.isFat32 && model.sizeGB >= FAT32_MAX_FILE_GB) {
    throw new Error(
      `${model.name} (~${model.sizeGB} GB) exceeds the FAT32 4 GB per-file limit on ${drivePath}. ` +
      `Reformat the USB to exFAT or NTFS, or pick a smaller model (e.g. Phi-3 Mini, DeepSeek-Coder 6.7B).`
    );
  }
  return info;
}

/**
 * Win32 MAX_PATH=260 includes the trailing NUL. The deepest path the install
 * pipeline writes is in the pre-staged opencode npm cache:
 *
 *   <USB>\cache\opencode\node_modules\@ai-sdk\openai-compatible\dist\internal\<file>.d.ts
 *
 * Real-world worst case observed: ~110 chars from the USB root onward. We add
 * a safety buffer for files we don't control (transitive deps, .d.ts maps).
 *
 * The `\\?\` namespace prefix lifts the per-call limit to ~32K, so all our
 * own fs ops survive. But Node's `fs.cp`/older APIs and any child process
 * (npm.exe, ollama.exe) that we don't pass long-paths through still see
 * MAX_PATH. Win10 1607+ has a registry opt-in (LongPathsEnabled=1) that
 * lifts the limit globally for processes with the manifest declaration —
 * we surface that as the systemic fix.
 */
const WIN_MAX_PATH = 260;
const PRESTAGE_RELATIVE_BUDGET = 160;

export function winPathPreflight(drivePath: string): void {
  if (process.platform !== "win32") return;
  const rootLen = path.resolve(drivePath).length;
  const worstCaseLen = rootLen + PRESTAGE_RELATIVE_BUDGET;
  if (worstCaseLen < WIN_MAX_PATH - 8) {
    log.dim(`Windows path budget OK (worst-case ~${worstCaseLen}/${WIN_MAX_PATH} chars).`);
    return;
  }

  const longPathsEnabled = isLongPathsEnabledOnWindows();
  if (longPathsEnabled === true) {
    log.dim(
      `USB mount point is long (${rootLen} chars), but Windows LongPathsEnabled=1 is set — proceeding.`,
    );
    return;
  }

  const head = `Windows MAX_PATH risk: USB mounted at "${drivePath}" (${rootLen} chars). ` +
    `Pre-staged opencode dependencies need ~${PRESTAGE_RELATIVE_BUDGET} more chars, ` +
    `which exceeds the ${WIN_MAX_PATH}-char limit and will fail with ENAMETOOLONG mid-install.`;
  const fixes = [
    "  Fix A (preferred): plug the USB at a shorter mount, e.g. assign drive letter X: via Disk Management or `subst X: <current>`.",
    "  Fix B (system-wide): on Win10 1607+, set HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem\\LongPathsEnabled=1 (REG_DWORD), reboot, retry.",
    "  Fix C: re-run from PowerShell as Admin: `New-ItemProperty -Path HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force`",
  ].join("\n");
  throw new Error(`${head}\n${fixes}`);
}

/**
 * Probe the LongPathsEnabled DWORD via `reg query`. Returns:
 *   true  → enabled
 *   false → present but disabled, OR query failed in a way we shouldn't trust
 *   null  → couldn't probe (no `reg.exe` on PATH)
 *
 * We intentionally treat any non-1 value as disabled — partial enablement
 * (registry set but app manifest missing) still hits MAX_PATH for child
 * processes that lack the manifest declaration, and we'd rather force the
 * shorter-mount workaround than gamble.
 */
function isLongPathsEnabledOnWindows(): boolean | null {
  if (process.platform !== "win32") return null;
  try {
    const out = spawnSync(
      "reg.exe",
      ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem", "/v", "LongPathsEnabled"],
      { encoding: "utf-8", windowsHide: true, timeout: 5000 },
    );
    if (out.error || out.status !== 0) return false;
    return /LongPathsEnabled\s+REG_DWORD\s+0x1/i.test(out.stdout || "");
  } catch {
    return null;
  }
}

export function warnIfLosesExecBit(info: FsInfo): void {
  if (!info.losesExecBit) return;
  log.warn(
    `Filesystem is ${info.raw} — it cannot store the executable bit. ` +
    `On Linux/macOS, launch with: bash start-linux.sh  (or)  bash start-mac.command`
  );
}
