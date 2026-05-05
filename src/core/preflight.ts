// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { detectFilesystem } from "./usb.js";
import { log } from "../utils/logger.js";
import type { CodingModel } from "../catalog/models.js";

const FAT32_MAX_FILE_GB = 4;

/**
 * FAT32 caps individual files at 4 GB. Qwen2.5-Coder 7B (~4.7 GB) and
 * CodeGemma 7B (~5.0 GB) blobs exceed that limit. Detect early and bail with
 * a clear remediation message instead of failing mid-pull.
 */
export function preflightFilesystem(drivePath: string, model: CodingModel): void {
  const fs = detectFilesystem(drivePath);
  if (!fs) {
    log.warn("Could not determine filesystem type — proceeding (FAT32 would block large models).");
    return;
  }
  log.dim(`Filesystem: ${fs}`);
  const isFat32 = fs === "fat32" || fs === "fat" || fs === "msdos" || fs === "vfat";
  if (isFat32 && model.sizeGB >= FAT32_MAX_FILE_GB) {
    throw new Error(
      `${model.name} (~${model.sizeGB} GB) exceeds the FAT32 4 GB per-file limit on ${drivePath}. ` +
      `Reformat the USB to exFAT or NTFS, or pick a smaller model (e.g. Phi-3 Mini, DeepSeek-Coder 6.7B).`
    );
  }
}
