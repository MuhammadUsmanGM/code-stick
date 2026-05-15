// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-c8a1-9e3d
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "../utils/logger.js";
import { pickDrive, assertDriveReady } from "../core/usb.js";
import { usbPaths } from "../utils/paths.js";
import { ALL_TARGETS, type Target } from "../catalog/targets.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { loadManifest, saveManifest, defaultModel } from "../state/manifest.js";
import { writeOpencodeConfig } from "../core/opencode-config.js";
import { setupShutdownHooks, registerCleanup } from "../core/process-manager.js";
import { stageAndSwapBinaries } from "../core/engine-staging.js";
import { postInstallCleanup } from "../core/cleanup.js";
import { promptWithEsc } from "../utils/prompt.js";
import { reportSymlinkCapability } from "../core/preflight.js";
import { openInstallLog, closeInstallLog } from "../utils/install-log.js";

interface UpgradeEngineOptions {
  target?: string;
  yes?: boolean;
  cleanup?: boolean;
}

const OLLAMA_VERSIONS = { host: "v0.21.2", linux: "v0.13.0" } as const;
const OPENCODE_VERSION = "v0.4.18";

/**
 * Refresh just the engine + opencode binary trees on a stick without touching
 * the model store. A normal `code-stick install` over an existing stick wipes
 * `data/` (5+ GB of model blobs) which is wrong when the user just wants the
 * latest Ollama or opencode build.
 *
 * Behavior:
 *   - Re-downloads + extracts Ollama / opencode for ALL targets into hidden
 *     staging dirs, then atomically swaps them into place. Same pipeline as
 *     fresh install, so the same crash-safety guarantees apply.
 *   - Refreshes launchers + opencode.json so any newly required env vars or
 *     paths are picked up.
 *   - Leaves `<USB>/data` and the manifest's `models` array untouched.
 *   - Bumps `ollamaVersions` / `opencodeVersion` / `updatedAt` to reflect the
 *     new state.
 */
export async function upgradeEngineCommand(opts: UpgradeEngineOptions): Promise<void> {
  setupShutdownHooks();
  log.banner("Upgrade engine");

  const drivePath = await pickDrive(opts.target);
  assertDriveReady(drivePath);
  openInstallLog(drivePath, "upgrade-engine");
  try {

  const manifest = loadManifest(drivePath);
  if (!manifest) {
    log.error("No installation found at this drive.");
    log.info(`Run: code-stick install --target "${drivePath}"`);
    process.exit(1);
  }

  const def = defaultModel(manifest);
  const modelCount = manifest.models.length;
  // Refresh only what's already staged on this stick. A reduced-portability
  // stick (e.g. installed with --targets host) must not silently grow extra
  // targets at upgrade time — that's `code-stick add-targets`'s job.
  const refreshTargets: Target[] = manifest.targets.length > 0
    ? [...manifest.targets]
    : [...ALL_TARGETS];
  log.info(`Stick currently has ${modelCount} model(s); default: ${def?.tag ?? "(none)"}`);
  log.dim(`Refreshing engine for ${refreshTargets.length} target(s): ${refreshTargets.join(", ")}`);
  log.dim("Models in <USB>/data are NOT touched — only Ollama + opencode binaries are refreshed.");

  if (!opts.yes) {
    const ans = await promptWithEsc<{ proceed: boolean }>([
      {
        type: "confirm", name: "proceed",
        message: `Re-download Ollama + opencode for ${refreshTargets.length} target(s) and atomically swap?`,
        default: true,
      },
    ]);
    if (!ans || !ans.proceed) { log.info("Cancelled."); return; }
  }

  // Archive temp dir lives on the host — engine refresh shouldn't tax the
  // already-slow USB. If the host runs out of space we'll throw early via
  // mkdtempSync; the user can re-run with more room.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-upgrade-"));
  registerCleanup(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  reportSymlinkCapability(drivePath);

  log.blank();
  log.step(1, 3, `Downloading + staging Ollama + opencode for ${refreshTargets.length} target(s)...`);
  await stageAndSwapBinaries(drivePath, tempDir, refreshTargets);

  log.step(2, 3, "Refreshing launchers + opencode config...");
  writeOpencodeConfig(drivePath, manifest);
  if (def) {
    renderLaunchers(drivePath, { modelTag: def.tag, targets: refreshTargets });
  } else {
    log.warn("No default model on this stick — skipping launcher render. Run `code-stick add-model` first.");
  }

  log.step(3, 3, "Updating manifest...");
  manifest.ollamaVersions = { host: OLLAMA_VERSIONS.host, linux: OLLAMA_VERSIONS.linux };
  manifest.opencodeVersion = OPENCODE_VERSION;
  manifest.updatedAt = new Date().toISOString();
  saveManifest(drivePath, manifest);

  const skipCleanup = opts.cleanup === false;
  if (skipCleanup) {
    log.dim(`Skipping cleanup (--no-cleanup) — archive temp left at ${tempDir}`);
  } else {
    postInstallCleanup(drivePath, tempDir);
  }

  // Touch usbPaths so a future helper change here gets a compile error rather
  // than a silent miss. Cheap noop, keeps the import live across refactors.
  void usbPaths(drivePath);

  log.blank();
  log.success(`Upgraded engine on ${drivePath}`);
  log.info(`Ollama: ${manifest.ollamaVersions.host} (linux ${manifest.ollamaVersions.linux})`);
  log.info(`opencode: ${manifest.opencodeVersion}`);
  log.dim(`${modelCount} model(s) preserved in <USB>/data`);
  } finally {
    closeInstallLog();
  }
}
