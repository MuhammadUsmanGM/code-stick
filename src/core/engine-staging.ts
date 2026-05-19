// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-c8a1-9e3d
import fs from "node:fs";
import path from "node:path";
import { ALL_TARGETS, type Target } from "../catalog/targets.js";
import { OPENCODE_VERSION, opencodeArtifactsFor } from "../catalog/opencode.js";
import { stripQuarantineIfMac } from "./macos.js";
import { registerCleanup } from "./process-manager.js";
import { log } from "../utils/logger.js";
import {
  bindArchiveDestDirs,
  buildArchiveWorkUnits,
  runArchiveStagingPipeline,
} from "./archive-staging.js";

/**
 * Download + extract Ollama and opencode for every target into hidden staging
 * directories on the same filesystem as the live trees, then atomically swap
 * them into `<USB>/engine` and `<USB>/opencode`. Used by both fresh install
 * and `upgrade-engine`.
 *
 * Crucially does NOT touch `<USB>/data` (model store), `<USB>/cache`, or
 * `<USB>/config`. That keeps engine refresh decoupled from the multi-GB model
 * store — re-pulling a 5GB model just because Ollama bumped a patch version is
 * not the user's idea of fun.
 */
/**
 * Stage + atomically swap engine/opencode for `targets`.
 *
 * IMPORTANT: when `targets` is a strict subset of ALL_TARGETS we MERGE the
 * staged subset into any existing live tree instead of nuking unrelated
 * targets. This lets `add-targets` add windows/linux to a stick that was
 * originally installed `--targets host` on macOS without redownloading the
 * mac binaries the user already has on the stick.
 *
 * When `targets` equals ALL_TARGETS (default install) behavior is unchanged:
 * the full live tree is replaced atomically.
 */
export async function stageAndSwapBinaries(
  drivePath: string,
  archiveTempDir: string,
  targets: readonly Target[] = ALL_TARGETS,
  opencodeVersion: string = OPENCODE_VERSION,
): Promise<void> {
  if (targets.length === 0) {
    throw new Error("Internal: stageAndSwapBinaries called with empty targets list.");
  }
  const engineStaging = path.join(drivePath, ".engine.new");
  const opencodeStaging = path.join(drivePath, ".opencode.new");

  // Scrub any leftover staging from a previous aborted run before starting.
  for (const stale of [
    engineStaging, opencodeStaging,
    path.join(drivePath, ".engine.old"),
    path.join(drivePath, ".opencode.old"),
  ]) {
    try { fs.rmSync(stale, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  fs.mkdirSync(engineStaging, { recursive: true });
  fs.mkdirSync(opencodeStaging, { recursive: true });

  // Mid-flight Ctrl-C: nuke half-extracted staging trees. The OLD engine/opencode
  // are untouched until the swap below.
  registerCleanup(() => {
    try { fs.rmSync(engineStaging, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(opencodeStaging, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const opencodeArtifacts = opencodeArtifactsFor(opencodeVersion);
  const units = buildArchiveWorkUnits(targets, targets, opencodeArtifacts);
  bindArchiveDestDirs(units, engineStaging, opencodeStaging, targets, targets);

  log.info(
    `Staging ${targets.length} target(s) ` +
    `(${units.length} unique archive${units.length === 1 ? "" : "s"}, pipelined download + extract)...`,
  );
  await runArchiveStagingPipeline(archiveTempDir, units);

  // Partial install: graft staged targets into existing live tree so
  // unrelated targets already on the stick survive the swap. Full install:
  // straight atomic replace (existing behavior).
  const isFullSet = targets.length === ALL_TARGETS.length;
  if (isFullSet) {
    swapDir(path.join(drivePath, "engine"), engineStaging, path.join(drivePath, ".engine.old"));
    swapDir(path.join(drivePath, "opencode"), opencodeStaging, path.join(drivePath, ".opencode.old"));
  } else {
    mergeStagedTargets(path.join(drivePath, "engine"), engineStaging, targets);
    mergeStagedTargets(path.join(drivePath, "opencode"), opencodeStaging, targets);
  }

  stripQuarantineIfMac(path.join(drivePath, "engine"), path.join(drivePath, "opencode"));
}

/**
 * Per-target swap: for each `t` in `targets`, atomically replace
 * `<live>/<t>` with `<staging>/<t>`. Existing target dirs not in `targets`
 * are left alone. After all per-target swaps succeed, the staging root is
 * removed.
 *
 * Crash window between target swaps is identical to swapDir's: the user is
 * left with a mix of new + old target binaries. That's still bootable on
 * every individual launcher because each launcher only reads its own target.
 */
function mergeStagedTargets(liveRoot: string, stagingRoot: string, targets: readonly Target[]): void {
  fs.mkdirSync(liveRoot, { recursive: true });
  for (const t of targets) {
    const liveDir = path.join(liveRoot, t);
    const stagingDir = path.join(stagingRoot, t);
    const backupDir = path.join(liveRoot, `.${t}.old`);
    swapDir(liveDir, stagingDir, backupDir);
  }
  try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Atomically swap `staging/` → `live/`, parking any existing `live/` at
 * `backup/` so a failure between the two renames is recoverable.
 *
 * Crash windows:
 *   - between rename(live → backup) and rename(staging → live): on next run
 *     the user has neither live nor staging-as-live; backup still holds the
 *     previous tree. Operator can `mv backup live` to recover.
 *   - between rename(staging → live) and rmSync(backup): backup lingers, live
 *     is the new tree. Harmless, swept by the next reinstall.
 */
export function swapDir(live: string, staging: string, backup: string): void {
  if (!fs.existsSync(staging)) {
    throw new Error(`Internal: staging dir missing at swap time: ${staging}`);
  }
  try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* ignore */ }
  if (fs.existsSync(live)) {
    fs.renameSync(live, backup);
  }
  try {
    fs.renameSync(staging, live);
  } catch (err) {
    if (fs.existsSync(backup)) {
      try { fs.renameSync(backup, live); } catch { /* user is stuck — surface the original error */ }
    }
    throw err;
  }
  try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* harmless leftover */ }
}
