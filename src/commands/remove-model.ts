// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { log } from "../utils/logger.js";
import { promptWithEsc } from "../utils/prompt.js";
import { pickDrive, assertDriveReady } from "../core/usb.js";
import { findModel } from "../catalog/models.js";
import { loadManifest, saveManifest } from "../state/manifest.js";
import { removeModelTag } from "../core/model-pull.js";
import { writeOpencodeConfig } from "../core/opencode-config.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { setupShutdownHooks, stopAll } from "../core/process-manager.js";
import { openInstallLog, closeInstallLog } from "../utils/install-log.js";

interface RemoveModelOptions {
  target?: string;
  force?: boolean;
}

export async function removeModelCommand(modelId: string | undefined, opts: RemoveModelOptions): Promise<void> {
  setupShutdownHooks();
  log.banner("Remove model");

  const drivePath = await pickDrive(opts.target);
  assertDriveReady(drivePath);
  openInstallLog(drivePath, "remove-model");
  try {

  const manifest = loadManifest(drivePath);
  if (!manifest) {
    log.error("No installation found at this drive.");
    process.exit(1);
  }

  const targetId = await pickInstalledModel(modelId, manifest.models.map((m) => ({ id: m.id, tag: m.tag })));
  if (!targetId) { log.info("Cancelled."); return; }

  const entry = manifest.models.find((m) => m.id === targetId);
  if (!entry) { log.error(`Model ${targetId} is not installed.`); return; }

  if (manifest.models.length === 1 && !opts.force) {
    throw new Error(
      `${entry.tag} is the only model on this stick. Pass --force to remove (the stick will need a fresh install or add-model afterwards).`
    );
  }
  if (entry.id === manifest.defaultModelId && manifest.models.length > 1 && !opts.force) {
    throw new Error(
      `${entry.tag} is the default model. Set another default first via 'code-stick add-model --set-default', or pass --force.`
    );
  }

  try {
    await removeModelTag(drivePath, entry.tag);
  } finally {
    await stopAll().catch(() => undefined);
  }

  manifest.models = manifest.models.filter((m) => m.id !== entry.id);
  if (manifest.models.length > 0) {
    if (manifest.defaultModelId === entry.id) {
      manifest.defaultModelId = manifest.models[0].id;
      log.info(`New default model: ${manifest.models[0].tag}`);
    }
    writeOpencodeConfig(drivePath, manifest);
    renderLaunchers(drivePath, {
      modelTag: manifest.models.find((m) => m.id === manifest.defaultModelId)?.tag ?? manifest.models[0].tag,
      // Scope to staged targets so reduced-portability sticks don't silently
      // regrow launchers for unstaged OS families on every remove-model.
      targets: manifest.targets,
    });
  } else {
    // Stick is now empty. Clear defaultModelId so consumers (start, status,
    // launcher-gen) can detect the empty state explicitly instead of
    // following a dangling pointer to a removed model.
    manifest.defaultModelId = "";
    writeOpencodeConfig(drivePath, manifest);
    log.warn("Stick now has no models — run `code-stick add-model` before next launch.");
  }
  manifest.updatedAt = new Date().toISOString();
  saveManifest(drivePath, manifest);

  log.success(`Removed ${entry.tag} from ${drivePath}`);
  } finally {
    closeInstallLog();
  }
}

async function pickInstalledModel(
  modelId: string | undefined,
  installed: { id: string; tag: string }[],
): Promise<string | null> {
  if (modelId) {
    const known = findModel(modelId);
    if (!known) {
      const ids = installed.map((m) => m.id).join(", ");
      throw new Error(`Unknown model "${modelId}". Installed: ${ids || "(none)"}. Run \`code-stick status\` to see what's on the stick.`);
    }
    if (!installed.some((m) => m.id === modelId)) {
      const ids = installed.map((m) => m.id).join(", ");
      throw new Error(`Model "${modelId}" is not installed on this stick. Installed: ${ids || "(none)"}.`);
    }
    return modelId;
  }
  if (installed.length === 0) {
    log.info("No models installed.");
    return null;
  }
  const choices = installed.map((m) => {
    const meta = findModel(m.id);
    return { name: meta ? `${meta.name} (${m.tag})` : m.tag, value: m.id };
  });
  const ans = await promptWithEsc<{ id: string }>([
    { type: "list", name: "id", message: "Pick a model to remove:", choices },
  ]);
  return ans?.id ?? null;
}
