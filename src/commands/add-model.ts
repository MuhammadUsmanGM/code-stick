// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { log } from "../utils/logger.js";
import { promptWithEsc } from "../utils/prompt.js";
import { pickDrive, assertDriveReady, checkDiskSpace } from "../core/usb.js";
import { MODELS, findModel, type CodingModel } from "../catalog/models.js";
import { withManifestLock } from "../state/manifest.js";
import { preflightFilesystem } from "../core/preflight.js";
import { pullModelTag } from "../core/model-pull.js";
import { writeOpencodeConfig } from "../core/opencode-config.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { setupShutdownHooks, stopAll } from "../core/process-manager.js";

interface AddModelOptions {
  target?: string;
  setDefault?: boolean;
}

export async function addModelCommand(modelId: string | undefined, opts: AddModelOptions): Promise<void> {
  setupShutdownHooks();
  log.banner("Add model");

  const drivePath = await pickDrive(opts.target);
  assertDriveReady(drivePath);

  const result = await withManifestLock(drivePath, async (manifest) => {
    if (!manifest) {
      log.error("No installation found at this drive.");
      log.info(`Run: code-stick install --target "${drivePath}"`);
      process.exit(1);
    }

    const model = await pickModelExcluding(modelId, manifest.models.map((m) => m.id));
    if (!model) { log.info("Cancelled."); return { manifest: null, result: null }; }

    if (manifest.models.some((m) => m.id === model.id)) {
      log.warn(`${model.name} is already installed on this stick.`);
      return { manifest: null, result: null };
    }

    preflightFilesystem(drivePath, model);

    const requiredGB = Math.ceil(model.sizeGB + 1);
    const ok = await checkDiskSpace(drivePath, requiredGB);
    if (!ok) {
      throw new Error(`Not enough free space on ${drivePath}. Need ~${requiredGB} GB for ${model.name}.`);
    }

    log.info(`Pulling ${model.tag} into USB store...`);
    try {
      await pullModelTag(drivePath, model.tag);
    } finally {
      await stopAll().catch(() => undefined);
    }

    manifest.models.push({ id: model.id, tag: model.tag, addedAt: new Date().toISOString() });
    if (opts.setDefault) manifest.defaultModelId = model.id;
    manifest.updatedAt = new Date().toISOString();

    writeOpencodeConfig(drivePath, manifest);
    renderLaunchers(drivePath, { modelTag: manifest.models.find((m) => m.id === manifest.defaultModelId)?.tag ?? model.tag });

    return { manifest, result: { model, defaultModelId: manifest.defaultModelId } };
  });

  if (!result) return;
  log.blank();
  log.success(`Added ${result.model.name} to ${drivePath}`);
  if (opts.setDefault) log.info(`Default model is now ${result.model.tag}`);
  else log.dim(`Default model still ${result.defaultModelId}. Pass --set-default to change.`);
}

async function pickModelExcluding(modelId: string | undefined, alreadyInstalled: string[]): Promise<CodingModel | null> {
  if (modelId) {
    const m = findModel(modelId);
    if (!m) {
      const ids = MODELS.map((x) => x.id).join(", ");
      throw new Error(`Unknown model "${modelId}". Available: ${ids}`);
    }
    return m;
  }
  const remaining = MODELS.filter((m) => !alreadyInstalled.includes(m.id));
  if (remaining.length === 0) {
    log.info("All four catalog models are already installed on this stick.");
    return null;
  }
  const choices = remaining.map((m) => ({
    name: `${m.name} — ${m.size}  ${m.bestFor}`,
    value: m.id,
  }));
  const ans = await promptWithEsc<{ id: string }>([
    {
      type: "list",
      name: "id",
      message: "Pick a coding model to add:",
      choices,
      default: remaining[0].id,
    },
  ]);
  if (!ans) return null;
  return findModel(ans.id) || null;
}
