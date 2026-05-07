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
import { inspectOllamaData } from "../core/health.js";

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
  log.info(`Ollama:       ${manifest.ollamaVersion}`);
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
  log.info("Bundled targets:");
  for (const t of ALL_TARGETS) {
    const ollama = path.join(p.engine(t), ollamaBinaryRel(t));
    const opencode = path.join(p.opencode(t), opencodeBinaryRel(t));
    const ok = fs.existsSync(ollama) && fs.existsSync(opencode);
    log.dim(`  ${t.padEnd(14)} ${ok ? "✓" : "✗ missing"}`);
  }

  const health = inspectOllamaData(p.data);
  log.blank();
  log.info("Model store:");
  log.dim(`  manifests: ${health.hasManifest ? "✓" : "✗"}`);
  log.dim(`  blobs:     ${health.hasBlobs ? "✓" : "✗"}`);
}
