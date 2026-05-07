// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { log } from "../utils/logger.js";
import { pickDrive, assertDriveReady } from "../core/usb.js";
import { loadManifest, saveManifest, defaultModel } from "../state/manifest.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { writeOpencodeConfig } from "../core/opencode-config.js";

interface UpdateOptions { target?: string; }

/**
 * Re-render launchers from current templates and bump updatedAt. Heavy updates
 * (new Ollama / opencode versions or model swaps) should go through `install`
 * with the appropriate flags — this is a light refresh.
 */
export async function updateCommand(opts: UpdateOptions): Promise<void> {
  log.banner("Update");

  const drivePath = await pickDrive(opts.target);
  assertDriveReady(drivePath);

  const manifest = loadManifest(drivePath);
  if (!manifest) {
    log.error("No installation found at this drive.");
    log.info(`Run: code-stick install --target "${drivePath}"`);
    process.exit(1);
  }

  const def = defaultModel(manifest);
  writeOpencodeConfig(drivePath, manifest);
  if (def) {
    renderLaunchers(drivePath, { modelTag: def.tag });
  } else {
    log.warn("No default model on this stick — skipping launcher render. Run `code-stick add-model` first.");
  }
  manifest.updatedAt = new Date().toISOString();
  saveManifest(drivePath, manifest);

  log.success("Refreshed launchers, opencode config, and manifest");
}
