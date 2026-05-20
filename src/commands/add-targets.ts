// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "../utils/logger.js";
import { pickDrive, assertDriveReady } from "../core/usb.js";
import {
  ALL_TARGETS,
  isFullPortability,
  parseTargetsFlag,
  type Target,
} from "../catalog/targets.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { loadManifest, saveManifest, defaultModel } from "../state/manifest.js";
import { writeOpencodeConfig } from "../core/opencode-config.js";
import { setupShutdownHooks, registerCleanup } from "../core/process-manager.js";
import { stageAndSwapBinaries } from "../core/engine-staging.js";
import { postInstallCleanup } from "../core/cleanup.js";
import { promptWithEsc } from "../utils/prompt.js";
import { reportSymlinkCapability } from "../core/preflight.js";
import { openInstallLog, closeInstallLog } from "../utils/install-log.js";

interface AddTargetsOptions {
  target?: string;
  yes?: boolean;
  cleanup?: boolean;
}

/**
 * Add one or more OS targets to a stick that was installed with --targets.
 *
 * Why this command exists: `--targets host` is a power-user escape hatch
 * (smaller stick, faster install) at the cost of portability. Users
 * eventually need that portability back — they get a new laptop, plug
 * the stick into a colleague's machine, etc. `add-targets` lets them
 * patch in the missing targets without redownloading the model store
 * or wiping config.
 *
 * Resolution semantics match `install --targets`: tokens are `all`,
 * `host`, OS families, or explicit Target IDs (comma-separated). The
 * passed-in list is UNIONED with whatever is already in the manifest —
 * never removes anything. To shrink a stick, the user must reinstall.
 */
export async function addTargetsCommand(
  raw: string | undefined,
  opts: AddTargetsOptions,
): Promise<void> {
  setupShutdownHooks();
  log.banner("Add targets");

  let requested: Target[];
  try {
    requested = parseTargetsFlag(raw);
  } catch (err) {
    process.env.CODE_STICK_NO_REPORT = "1";
    throw err;
  }
  if (requested.length === 0) {
    log.error("No targets specified. Pass a comma-separated list, e.g. `code-stick add-targets darwin-arm64,linux-x64`.");
    process.exitCode = 1;
    return;
  }

  const drivePath = await pickDrive(opts.target);
  assertDriveReady(drivePath);
  openInstallLog(drivePath, "add-targets");
  try {
    const manifest = loadManifest(drivePath);
    if (!manifest) {
      log.error("No installation found at this drive.");
      log.info(`Run: code-stick install --target "${drivePath}"`);
      process.exitCode = 1;
      return;
    }

    const existing = new Set<Target>(manifest.targets);
    const missing = requested.filter((t) => !existing.has(t));
    if (missing.length === 0) {
      log.success("Nothing to do — all requested targets are already on this stick.");
      log.dim(`Stick targets: ${[...existing].join(", ")}`);
      return;
    }

    // Stable order: keep manifest order, then append new targets in ALL_TARGETS order.
    const finalTargets: Target[] = ALL_TARGETS.filter(
      (t) => existing.has(t) || missing.includes(t),
    );
    const willBeFullyPortable = isFullPortability(finalTargets);

    log.info(`Currently staged: ${[...existing].sort().join(", ") || "(none)"}`);
    log.info(`Will add:        ${missing.join(", ")}`);
    log.info(`After this run:  ${finalTargets.join(", ")}`);
    if (willBeFullyPortable) {
      log.dim("This run will restore full portability — the stick will boot on every supported OS.");
    } else {
      log.dim("This run still leaves some OSes unsupported. Re-run with `all` to make it fully portable.");
    }

    if (!opts.yes) {
      const ans = await promptWithEsc<{ proceed: boolean }>([
        {
          type: "confirm", name: "proceed",
          message: `Download + stage ${missing.length} new target(s)?`,
          default: true,
        },
      ]);
      if (!ans || !ans.proceed) { log.info("Cancelled."); return; }
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-add-targets-"));
    registerCleanup(() => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    // Same host-staging pipeline as Fast install / upgrade-engine: extract on
    // host SSD, bulk-copy to the USB. Avoids hammering the stick with millions
    // of small writes when filling in missing OS trees. SIGINT-safe via the
    // registered cleanup callback.
    const hostStageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-add-targets-stage-"));
    registerCleanup(() => {
      try { fs.rmSync(hostStageRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    reportSymlinkCapability(drivePath);

    log.blank();
    log.step(1, 3, `Downloading + staging Ollama + opencode for ${missing.length} target(s)...`);
    // Stage ONLY the missing targets. engine-staging detects this as a partial
    // run and merges the new target subdirs into the live engine/opencode trees
    // without disturbing the targets the user already has.
    await stageAndSwapBinaries(drivePath, tempDir, missing, undefined, {
      extractOnHost: true,
      hostStageRoot,
      copyConcurrency: 4,
    });
    try { fs.rmSync(hostStageRoot, { recursive: true, force: true }); }
    catch (err) { log.dim(`Could not remove host stage dir: ${(err as Error).message}`); }

    log.step(2, 3, "Refreshing launchers + opencode config...");
    writeOpencodeConfig(drivePath, manifest);
    const def = defaultModel(manifest);
    if (def) {
      renderLaunchers(drivePath, { modelTag: def.tag, targets: finalTargets });
    } else {
      log.warn("No default model on this stick — skipping launcher render. Run `code-stick add-model` first.");
    }

    log.step(3, 3, "Updating manifest...");
    manifest.targets = finalTargets;
    manifest.updatedAt = new Date().toISOString();
    saveManifest(drivePath, manifest);

    const skipCleanup = opts.cleanup === false;
    if (skipCleanup) {
      log.dim(`Skipping cleanup (--no-cleanup) — archive temp left at ${tempDir}`);
    } else {
      postInstallCleanup(drivePath, tempDir);
    }

    log.blank();
    log.success(`Added ${missing.length} target(s) to ${drivePath}`);
    log.dim(`Stick now boots on: ${finalTargets.join(", ")}`);
  } finally {
    closeInstallLog();
  }
}
