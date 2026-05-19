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
import { prestageOpencodeProviders } from "../core/opencode-prestage.js";
import { setupShutdownHooks, registerCleanup } from "../core/process-manager.js";
import { stageAndSwapBinaries } from "../core/engine-staging.js";
import { OPENCODE_VERSION, validateOpencodeVersion } from "../catalog/opencode.js";
import { postInstallCleanup } from "../core/cleanup.js";
import { promptWithEsc } from "../utils/prompt.js";
import { reportSymlinkCapability } from "../core/preflight.js";
import { openInstallLog, closeInstallLog } from "../utils/install-log.js";
import { getNumCtxForTag } from "../catalog/models.js";
import { rebakeAllModels } from "../core/model-pull.js";
import { stopAll } from "../core/process-manager.js";

interface UpgradeEngineOptions {
  target?: string;
  yes?: boolean;
  cleanup?: boolean;
  /**
   * Opencode version to swap in. Omitted means the bundled default
   * (`OPENCODE_VERSION`). Any other value must pass `validateOpencodeVersion`
   * and additionally requires `CODE_STICK_ALLOW_UNVERIFIED=1` because the SHA
   * for that version is not pinned in this code-stick release.
   */
  opencodeVersion?: string;
}

const OLLAMA_VERSIONS = { host: "v0.21.2", linux: "v0.13.0" } as const;

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

  // Resolve target opencode version. Reject malformed input as a domain
  // error (matches install's contract). Default = bundled OPENCODE_VERSION;
  // anything else is unverified-by-default and prints a loud banner below.
  let opencodeVersion: string;
  try {
    opencodeVersion = opts.opencodeVersion ? validateOpencodeVersion(opts.opencodeVersion) : OPENCODE_VERSION;
  } catch (err) {
    process.env.CODE_STICK_NO_REPORT = "1";
    throw err;
  }
  const currentOpencode = manifest.opencodeVersion;
  const usingNonDefaultOpencode = opencodeVersion !== OPENCODE_VERSION;
  if (usingNonDefaultOpencode) {
    log.blank();
    log.warn(`⚠  Upgrading to opencode ${opencodeVersion} (not the bundled default ${OPENCODE_VERSION}).`);
    log.dim("Archives for this version are not SHA-pinned in this code-stick release.");
    log.dim("The downloader will refuse unless CODE_STICK_ALLOW_UNVERIFIED=1 is set.");
    log.blank();
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
    const opencodeNote = opencodeVersion !== currentOpencode
      ? ` (opencode ${currentOpencode} → ${opencodeVersion})`
      : "";
    const ans = await promptWithEsc<{ proceed: boolean }>([
      {
        type: "confirm", name: "proceed",
        message: `Re-download Ollama + opencode for ${refreshTargets.length} target(s) and atomically swap${opencodeNote}?`,
        default: !usingNonDefaultOpencode,
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

  // v0.4 → v1.x migration: the cached @ai-sdk/openai-compatible node_modules
  // tree pre-staged for v0.4.x may carry incompatible internals once v1.x
  // first-launches against it. Wipe the cache so prestage below re-builds a
  // clean tree against the v1.x provider expectations. Only triggers on the
  // major-version boundary — same-major upgrades keep their cache.
  const crossingV1Boundary =
    currentOpencode.startsWith("v0.") && !opencodeVersion.startsWith("v0.");
  if (crossingV1Boundary) {
    const cacheDir = usbPaths(drivePath).opencodeCache;
    log.dim(`v0.4 → v1.x boundary detected — wiping stale opencode provider cache at ${cacheDir}`);
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); }
    catch (err) { log.warn(`Could not wipe ${cacheDir}: ${(err as Error).message}`); }
  }

  log.blank();
  log.step(1, 4, `Downloading + staging Ollama + opencode ${opencodeVersion} for ${refreshTargets.length} target(s)...`);
  await stageAndSwapBinaries(drivePath, tempDir, refreshTargets, opencodeVersion);

  log.step(2, 4, "Refreshing launchers + opencode config + providers...");
  writeOpencodeConfig(drivePath, manifest);
  // Re-prestage providers after every engine swap. Without this, an upgrade
  // from v0.4 → v1.x would leave a stick whose binary is v1.x but whose
  // provider cache is either missing (after the wipe above) or holds the
  // v0.4-era node_modules — both cause opencode to attempt a network bun-add
  // on first launch, defeating the airgap pitch. Cheap on same-version
  // upgrades: prestage is idempotent and finishes in ~seconds when the
  // package is already resolved.
  const p = usbPaths(drivePath);
  const prestage = prestageOpencodeProviders(p.opencodeCache);
  if (!prestage.ok) {
    log.warn(`Could not pre-stage opencode provider package: ${prestage.reason}`);
    log.warn("opencode may attempt a network install on first launch.");
    log.warn("Run upgrade-engine again on an online host, or run opencode once on an online machine to populate the cache.");
  }
  if (def) {
    renderLaunchers(drivePath, { modelTag: def.tag, targets: refreshTargets });
  } else {
    log.warn("No default model on this stick — skipping launcher render. Run `code-stick add-model` first.");
  }

  // v0.2.0 → v0.2.1 fix: re-bake every existing model with its catalog
  // num_ctx so the model receives opencode's full system prompt + tool
  // definitions instead of the 2048-token default that truncates them.
  // Idempotent on already-baked v0.2.1+ sticks — `ollama create` rewrites
  // the manifest in place; if the parameter is already correct, the write
  // is a no-op from the user's perspective (small blob layer reused).
  // MUGM-ctx-7a92.
  log.step(3, 4, "Rebaking model context windows...");
  if (manifest.models.length === 0) {
    log.dim("No models on this stick — skipping rebake.");
  } else {
    const targets = manifest.models.map((m) => ({
      tag: m.tag,
      numCtx: getNumCtxForTag(m.tag),
    }));
    try {
      const results = await rebakeAllModels(drivePath, targets);
      const failed = results.filter((r) => !r.ok);
      const ok = results.length - failed.length;
      log.dim(`Rebake complete: ${ok}/${results.length} model(s) updated.`);
      for (const f of failed) {
        log.warn(`Could not rebake ${f.tag}: ${f.error ?? "unknown error"}`);
      }
      if (failed.length > 0) {
        log.warn("Affected model(s) will still launch but may hallucinate from truncated prompts.");
        log.warn("Try re-running `code-stick upgrade-engine` once the underlying issue is resolved.");
      }
    } finally {
      // The temp server registered with the global process manager;
      // ensure it's torn down even on partial failure so the next step
      // doesn't fight a stale serve on port 11434.
      await stopAll().catch(() => undefined);
    }
  }

  log.step(4, 4, "Updating manifest...");
  manifest.ollamaVersions = { host: OLLAMA_VERSIONS.host, linux: OLLAMA_VERSIONS.linux };
  manifest.opencodeVersion = opencodeVersion;
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
