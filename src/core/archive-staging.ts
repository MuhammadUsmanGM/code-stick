// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
/**
 * Download + extract engine/opencode archives with:
 *   - dedupe by filename (e.g. one ollama-darwin.tgz for both mac arches)
 *   - delete each archive after all extractions for that file finish
 *   - pipeline: up to ARCHIVE_DOWNLOAD_CONCURRENCY downloads ahead while extracting
 */
import fs from "node:fs";
import path from "node:path";
import type { Target } from "../catalog/targets.js";
import { OLLAMA, ollamaBinaryRel } from "../catalog/ollama.js";
import type { OpencodeArtifact } from "../catalog/opencode.js";
import { opencodeBinaryRel } from "../catalog/opencode.js";
import { download } from "./downloader.js";
import {
  extractZipFile,
  extractTarFile,
  ensureBinaryAt,
  chmodExecRecursive,
} from "./extract.js";

/** Max simultaneous archive downloads (USB sticks saturate quickly above 2). */
export const ARCHIVE_DOWNLOAD_CONCURRENCY = 2;

export interface ArchiveDownloadSpec {
  filename: string;
  url: string;
  mirrors?: string[];
  sha256?: string;
  label: string;
  type: "zip" | "tgz";
}

export interface ArchiveExtractTask {
  target: Target;
  destDir: string;
  binaryRel: string;
  kind: "ollama" | "opencode";
}

/** One on-disk archive + every tree that must be extracted from it. */
export interface ArchiveWorkUnit {
  archive: ArchiveDownloadSpec;
  extractions: ArchiveExtractTask[];
}

/** Stable key for deduping archives in a temp dir (filename is unique per release asset). */
export function archiveDedupeKey(filename: string): string {
  return filename.toLowerCase();
}

/**
 * Group Ollama + opencode targets into work units keyed by archive filename.
 * Preserves first-seen order (Ollama targets, then opencode).
 */
export function buildArchiveWorkUnits(
  ollamaTargets: readonly Target[],
  opencodeTargets: readonly Target[],
  opencodeArtifacts: Record<Target, OpencodeArtifact>,
): ArchiveWorkUnit[] {
  const order: string[] = [];
  const units = new Map<string, ArchiveWorkUnit>();

  const add = (filename: string, archive: ArchiveDownloadSpec, task: ArchiveExtractTask) => {
    const key = archiveDedupeKey(filename);
    if (!units.has(key)) {
      units.set(key, { archive, extractions: [] });
      order.push(key);
    }
    units.get(key)!.extractions.push(task);
  };

  for (const t of ollamaTargets) {
    const art = OLLAMA[t];
    add(art.filename, {
      filename: art.filename,
      url: art.url,
      mirrors: art.mirrors,
      sha256: art.sha256,
      label: `ollama ${t}`,
      type: art.type,
    }, {
      target: t,
      destDir: "", // filled by caller before extract
      binaryRel: ollamaBinaryRel(t),
      kind: "ollama",
    });
  }

  for (const t of opencodeTargets) {
    const art = opencodeArtifacts[t];
    add(art.filename, {
      filename: art.filename,
      url: art.url,
      mirrors: art.mirrors,
      sha256: art.sha256,
      label: `opencode ${t}`,
      type: art.type,
    }, {
      target: t,
      destDir: "",
      binaryRel: opencodeBinaryRel(t),
      kind: "opencode",
    });
  }

  return order.map((k) => units.get(k)!);
}

/**
 * Bind extraction dest dirs on work units (engine vs opencode staging roots).
 */
export function bindArchiveDestDirs(
  units: ArchiveWorkUnit[],
  engineStaging: string,
  opencodeStaging: string,
  ollamaTargets: readonly Target[],
  opencodeTargets: readonly Target[],
): void {
  const ollamaSet = new Set(ollamaTargets);
  const opencodeSet = new Set(opencodeTargets);
  for (const unit of units) {
    for (const task of unit.extractions) {
      if (task.kind === "ollama") {
        if (!ollamaSet.has(task.target)) {
          throw new Error(`Internal: ollama target ${task.target} not in staging list`);
        }
        task.destDir = path.join(engineStaging, task.target);
      } else {
        if (!opencodeSet.has(task.target)) {
          throw new Error(`Internal: opencode target ${task.target} not in staging list`);
        }
        task.destDir = path.join(opencodeStaging, task.target);
      }
    }
  }
}

/**
 * Download (deduped), extract, and delete each archive. Keeps up to
 * `downloadConcurrency` downloads in flight while extracting the current unit.
 */
export async function runArchiveStagingPipeline(
  tempDir: string,
  units: ArchiveWorkUnit[],
  downloadConcurrency: number = ARCHIVE_DOWNLOAD_CONCURRENCY,
): Promise<void> {
  if (units.length === 0) return;
  fs.mkdirSync(tempDir, { recursive: true });

  const cap = Math.max(1, Math.min(downloadConcurrency, units.length));
  const downloadPromises: Array<Promise<string> | null> = units.map(() => null);

  const startDownload = (index: number): void => {
    if (index >= units.length || downloadPromises[index]) return;
    downloadPromises[index] = ensureArchiveOnDisk(tempDir, units[index]!.archive);
  };

  for (let i = 0; i < units.length; i++) {
    for (let j = i; j < Math.min(units.length, i + cap); j++) {
      startDownload(j);
    }

    const archivePath = await downloadPromises[i]!;
    downloadPromises[i] = null;

    await extractWorkUnit(units[i]!, archivePath);
    removeArchiveFile(archivePath);
  }
}

async function ensureArchiveOnDisk(tempDir: string, archive: ArchiveDownloadSpec): Promise<string> {
  const archivePath = path.join(tempDir, archive.filename);
  await download({
    url: archive.url,
    mirrors: archive.mirrors,
    dest: archivePath,
    expectedHash: archive.sha256,
    label: archive.label,
  });
  return archivePath;
}

async function extractWorkUnit(unit: ArchiveWorkUnit, archivePath: string): Promise<void> {
  for (const task of unit.extractions) {
    fs.mkdirSync(task.destDir, { recursive: true });
    if (unit.archive.type === "zip") {
      await extractZipFile(archivePath, task.destDir);
    } else {
      await extractTarFile(archivePath, task.destDir);
    }
    const label = `${task.kind} ${task.target}`;
    ensureBinaryAt(task.destDir, task.binaryRel, label);
    const binPath = path.join(task.destDir, task.binaryRel);
    if (
      unit.archive.type === "zip" &&
      task.kind === "ollama" &&
      task.target !== "windows-x64" &&
      task.target !== "windows-arm64"
    ) {
      chmodExecRecursive(task.destDir);
    }
    if (
      unit.archive.type === "zip" &&
      task.kind === "opencode" &&
      task.target !== "windows-x64" &&
      task.target !== "windows-arm64"
    ) {
      chmodExecRecursive(task.destDir);
    }
    ensureExecutable(binPath);
  }
}

/** Remove installer archive after extract — frees USB space during Direct installs. */
export function removeArchiveFile(archivePath: string): void {
  try {
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  } catch { /* best-effort */ }
}

function ensureExecutable(binPath: string): void {
  if (!fs.existsSync(binPath)) return;
  if (process.platform === "win32") return;
  try { fs.chmodSync(binPath, 0o755); }
  catch { /* FAT/exFAT */ }
}
