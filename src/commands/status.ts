// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";
import { pickDrive } from "../core/usb.js";
import { usbPaths } from "../utils/paths.js";
import { ALL_TARGETS } from "../catalog/targets.js";
import { ollamaBinaryRel } from "../catalog/ollama.js";
import { opencodeBinaryRel } from "../catalog/opencode.js";
import { loadManifest, defaultModel } from "../state/manifest.js";
import { inspectOllamaData, inspectOllamaDataSizes, directorySizeBytes } from "../core/health.js";

interface StatusOptions { target?: string; }

export async function statusCommand(opts: StatusOptions): Promise<void> {
  log.banner("Status");

  const drivePath = await pickDrive(opts.target);
  log.info(`Drive: ${drivePath}`);

  const manifest = loadManifest(drivePath);
  if (!manifest) {
    log.error("No manifest found — installation is missing or corrupted.");
    log.info(`Run: code-stick install --target "${drivePath}"`);
    return;
  }

  log.info(`Installed:    ${manifest.installedAt}`);
  if (manifest.updatedAt) log.info(`Last updated: ${manifest.updatedAt}`);
  // Per-target version display: collapse to a single line when host+linux
  // agree, otherwise call them out separately so drift is visible.
  const { host, linux } = manifest.ollamaVersions;
  if (host === linux) {
    log.info(`Ollama:       ${host || "(unknown)"}`);
  } else {
    log.info(`Ollama:       host=${host || "?"}  linux=${linux || "?"}`);
  }
  log.info(`opencode:     ${manifest.opencodeVersion}`);

  log.blank();
  log.info(`Models (${manifest.models.length}):`);
  const def = defaultModel(manifest);
  if (!def) {
    log.dim("  (none — run `code-stick add-model` to install one)");
  } else {
    for (const m of manifest.models) {
      const star = m.id === def.id ? "★" : " ";
      log.dim(`  ${star} ${m.tag.padEnd(28)} (${m.id})`);
    }
  }

  const p = usbPaths(drivePath);
  log.blank();
  // Honor manifest.targets — a stick installed with `--targets host` should
  // only report the targets it was supposed to stage, not the full ALL_TARGETS
  // matrix (which would flag five "missing" entries by design). Legacy
  // manifests without a populated targets array fall back to ALL_TARGETS.
  const stagedTargets = manifest.targets.length > 0 ? manifest.targets : ALL_TARGETS;
  log.info(`Bundled targets (${stagedTargets.length} staged):`);
  for (const t of stagedTargets) {
    const ollama = path.join(p.engine(t), ollamaBinaryRel(t));
    const opencode = path.join(p.opencode(t), opencodeBinaryRel(t));
    const ok = fs.existsSync(ollama) && fs.existsSync(opencode);
    log.dim(`  ${t.padEnd(14)} ${ok ? "✓" : "✗ missing"}`);
  }
  const notStaged = ALL_TARGETS.filter((t) => !stagedTargets.includes(t));
  if (notStaged.length > 0) {
    log.dim(`  (not staged by design: ${notStaged.join(", ")} — run \`code-stick add-targets\` to add)`);
  }

  const health = inspectOllamaData(p.data);
  const storeSizes = await inspectOllamaDataSizes(p.data);
  log.blank();
  log.info("Model store:");
  log.dim(`  manifests: ${health.hasManifest ? "✓" : "✗"}${health.hasManifest ? ` (${formatBytes(storeSizes.manifestsBytes)})` : ""}`);
  log.dim(`  blobs:     ${health.hasBlobs ? "✓" : "✗"}${health.hasBlobs ? ` (${formatBytes(storeSizes.blobsBytes)})` : ""}`);
  if (storeSizes.totalBytes > 0) {
    log.dim(`  total:     ${formatBytes(storeSizes.totalBytes)}`);
  }

  const [engineBytes, opencodeBytes, dataBytes, cacheBytes, stateBytes, configBytes] = await Promise.all([
    directorySizeBytes(p.engineRoot),
    directorySizeBytes(p.opencodeRoot),
    directorySizeBytes(p.data),
    directorySizeBytes(p.cache),
    directorySizeBytes(p.state),
    directorySizeBytes(p.config),
  ]);

  log.blank();
  log.info("Disk usage:");
  for (const [label, dir, bytes] of [
    ["engine", p.engineRoot, engineBytes],
    ["opencode", p.opencodeRoot, opencodeBytes],
    ["data", p.data, dataBytes],
    ["cache", p.cache, cacheBytes],
    ["config", p.config, configBytes],
    ["state", p.state, stateBytes],
  ] as const) {
    log.dim(`  ${label.padEnd(10)} ${fs.existsSync(dir) ? formatBytes(bytes) : "missing"}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
