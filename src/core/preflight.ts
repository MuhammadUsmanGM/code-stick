// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
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

export function warnIfLosesExecBit(info: FsInfo): void {
  if (!info.losesExecBit) return;
  log.warn(
    `Filesystem is ${info.raw} — it cannot store the executable bit. ` +
    `On Linux/macOS, launch with: bash start-linux.sh  (or)  bash start-mac.command`
  );
}
