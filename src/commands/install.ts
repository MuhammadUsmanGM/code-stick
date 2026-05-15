// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "../utils/logger.js";
import { promptWithEsc } from "../utils/prompt.js";
import {
  pickInstallDrive, assertDriveReady, checkDiskSpace,
  getFreeSpaceGB, sameDevice,
} from "../core/usb.js";
import { usbPaths } from "../utils/paths.js";
import {
  ALL_TARGETS,
  isFullPortability,
  parseTargetsFlag,
  type Target,
} from "../catalog/targets.js";
import { MODELS, findModel, type CodingModel } from "../catalog/models.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { saveManifest, loadManifest, type Manifest } from "../state/manifest.js";
import {
  preflightFilesystem,
  reportSymlinkCapability,
  warnIfLosesExecBit,
  winPathPreflight,
} from "../core/preflight.js";
import { postInstallCleanup } from "../core/cleanup.js";
import { setupShutdownHooks, stopAll, registerCleanup } from "../core/process-manager.js";
import { pullModelTag } from "../core/model-pull.js";
import { writeOpencodeConfig } from "../core/opencode-config.js";
import { copyDirWithProgress } from "../core/copy.js";
import { prestageOpencodeProviders } from "../core/opencode-prestage.js";
import { stageAndSwapBinaries } from "../core/engine-staging.js";
import { openInstallLog, closeInstallLog } from "../utils/install-log.js";

interface InstallOptions {
  target?: string;
  model?: string;
  yes?: boolean;
  // Commander's --no-cleanup flag flips this to false; default (omitted) is true.
  cleanup?: boolean;
  /**
   * Raw value of --targets. Undefined when the flag was omitted (meaning
   * "all targets, fully portable"). Parsed by parseTargetsFlag(); see that
   * function for accepted tokens.
   */
  targets?: string;
}

type InstallMode = "fast" | "slow";

// Mixed reality: Win/macOS ship v0.21.2, Linux ships v0.13.0 (last release with
// .tgz — v0.14+ is .tar.zst only). Manifest stores both as a structured map so
// upgrade tooling can reason about per-target drift. opencode is uniform.
const OLLAMA_VERSIONS = { host: "v0.21.2", linux: "v0.13.0" } as const;
const OPENCODE_VERSION = "v0.4.18";

const BINARY_FOOTPRINT_GB = 1.5;

export async function installCommand(opts: InstallOptions): Promise<void> {
  setupShutdownHooks();
  log.banner("Installer");
  log.dim("(Press Esc at any step to go back)");

  // Parse --targets up front so a typo surfaces before we touch any USB.
  // Default (flag omitted or "all") gives the full ALL_TARGETS set — that's
  // the product's core promise and must remain the default forever.
  let selectedTargets: Target[];
  try {
    selectedTargets = parseTargetsFlag(opts.targets);
  } catch (err) {
    // Mark this as a domain error so cli.ts skips the bug-report path.
    process.env.CODE_STICK_NO_REPORT = "1";
    throw err;
  }
  const fullPortability = isFullPortability(selectedTargets);
  if (!fullPortability) {
    log.blank();
    log.warn("⚠  Reduced-portability install");
    log.dim(`This stick will only boot on: ${selectedTargets.join(", ")}`);
    log.dim("Other OSes will be missing binaries. To make it fully portable later, run:");
    log.dim("  code-stick add-targets all");
    log.dim("Or re-install without --targets to stage every OS in one pass.");
    log.blank();
    if (!opts.yes) {
      const ans = await promptWithEsc<{ proceed: boolean }>([
        {
          type: "confirm", name: "proceed",
          message: "Continue with this reduced subset?",
          default: false,
        },
      ]);
      if (!ans || !ans.proceed) {
        log.info("Cancelled.");
        return;
      }
    }
  }

  // Step machine — Esc at any step rewinds to the previous one.
  type Step = "drive" | "model" | "speed" | "space" | "done";
  let step: Step = "drive";

  let drivePath = "";
  let model: CodingModel | undefined;
  let installMode: InstallMode = "slow";
  let isReinstall = false;
  let logOpen = false;

  try {
  while (step !== "done") {
    if (step === "drive") {
      const picked = await pickInstallDrive(opts.target);
      if (picked === null) { log.info("Cancelled."); return; }
      drivePath = picked;

      // Open install log as soon as drivePath is known. From here on, every
      // log.info/warn/error tees into <USB>/state/install.log automatically.
      if (!logOpen) { openInstallLog(drivePath, "install"); logOpen = true; }

      const existing = loadManifest(drivePath);
      if (existing) {
        const ans = await promptWithEsc<{ proceed: boolean }>([
          {
            type: "confirm", name: "proceed",
            message: `Found existing installation (default: ${existing.defaultModelId}). Re-install?`,
            default: false,
          },
        ]);
        // With --target, Esc has no earlier step to rewind to (pickInstallDrive
        // would just auto-accept the same path again — infinite loop). Treat
        // Esc as cancel in that case.
        if (!ans) {
          if (opts.target) { log.info("Cancelled."); return; }
          continue; // re-open drive picker
        }
        if (!ans.proceed) { log.info("Cancelled."); return; }
        isReinstall = true;
      }
      step = "model";
      continue;
    }

    if (step === "model") {
      if (opts.model) {
        const m = findModel(opts.model);
        if (!m) {
          const ids = MODELS.map((x) => x.id).join(", ");
          throw new Error(`Unknown --model "${opts.model}". Available: ${ids}`);
        }
        log.info(`Selected model: ${m.name}`);
        model = m;
        step = "speed";
        continue;
      }
      const choices = MODELS.map((m) => ({
        name: `${m.name} — ${m.size}  ${m.bestFor}`,
        value: m.id,
      }));
      const ans = await promptWithEsc<{ id: string }>([
        {
          type: "list", name: "id",
          message: "Pick a coding model (you can add more later with `code-stick add-model`):",
          choices,
          default: MODELS[0].id,
        },
      ]);
      if (!ans) { step = "drive"; continue; }
      model = findModel(ans.id);
      if (!model) { step = "drive"; continue; }
      step = "speed";
      continue;
    }

    if (step === "speed") {
      // Fast peak temp ~ 2× model size + 1 GB headroom (Ollama copies blobs).
      const requiredHostGB = Math.ceil(model!.sizeGB * 2 + 1);
      const hostFreeGB = getFreeSpaceGB(os.tmpdir());

      // Same physical device → Fast doubles disk usage with no copy-perf gain.
      const usbIsHostDrive = sameDevice(drivePath, os.tmpdir()) === true;
      if (usbIsHostDrive) {
        log.dim("Target and host share the same drive — using Direct-to-USB (Fast would double disk usage with no benefit).");
        installMode = "slow";
        step = "space";
        continue;
      }

      const hostMsg = hostFreeGB !== null ? ` (you have ${hostFreeGB.toFixed(1)} GB free)` : "";
      const ans = await promptWithEsc<{ mode: InstallMode }>([
        {
          type: "list", name: "mode",
          message: "Choose install method:",
          choices: [
            {
              name: `Fast — stage on your computer, then copy to USB ` +
                `(needs ~${requiredHostGB} GB temp space${hostMsg}, auto-cleaned)`,
              value: "fast",
            },
            {
              name: "Direct — install straight to USB " +
                "(no host storage, slower on cheap USB sticks)",
              value: "slow",
            },
          ],
          default: "fast",
        },
      ]);
      if (!ans) { step = "model"; continue; }

      if (ans.mode === "fast" && hostFreeGB !== null && hostFreeGB < requiredHostGB) {
        log.blank();
        log.warn(
          `Fast mode needs ~${requiredHostGB} GB of temp space, ` +
          `but only ${hostFreeGB.toFixed(1)} GB is free on your computer.`,
        );
        log.dim("Free up space and try again, or pick Direct-to-USB.");
        log.blank();
        continue; // re-prompt speed
      }

      if (ans.mode === "slow") {
        log.warn("Direct-to-USB is slower on cheap USB sticks.");
        const confirm = await promptWithEsc<{ proceed: boolean }>([
          { type: "confirm", name: "proceed", message: "Continue with Direct-to-USB?", default: true },
        ]);
        if (!confirm) { log.dim("Going back to install method picker..."); continue; }
        if (!confirm.proceed) { log.dim("Pick a different install method:"); continue; }
      }

      installMode = ans.mode;
      step = "space";
      continue;
    }

    if (step === "space") {
      const requiredGB = Math.ceil(model!.sizeGB + BINARY_FOOTPRINT_GB + 1);
      const ok = await checkDiskSpace(drivePath, requiredGB);
      if (!ok) {
        const ans = await promptWithEsc<{ force: boolean }>([
          { type: "confirm", name: "force", message: "Not enough space on USB. Continue anyway?", default: false },
        ]);
        if (!ans) { step = "speed"; continue; }
        if (!ans.force) { log.info("Cancelled."); return; }
      }
      step = "done";
      continue;
    }
  }

  // All confirmed — re-verify the USB is still mounted/writable.
  assertDriveReady(drivePath);
  const fsInfo = preflightFilesystem(drivePath, model!);
  // Win32 only: refuse to start if the USB mount path is so deep that the
  // pre-staged node_modules tree would overflow MAX_PATH (260). Surfaces a
  // remediation rather than letting the install fail mid-prestage.
  winPathPreflight(drivePath);
  // Tell the user up front whether tar extraction will use native symlinks
  // or fall back to copying bytes — important context on Windows non-admin
  // and FAT32/exFAT sticks where the extractor switches modes automatically.
  reportSymlinkCapability(drivePath);

  const p = usbPaths(drivePath);
  // Fast mode's whole point is "don't tax the slow USB". Putting the
  // 1.5 GB+ archive set on the USB defeats half the purpose. Stage on the
  // host's tmpdir in Fast mode; we already cleanup-callback'd the parent
  // stage dir below for SIGINT safety. In Direct mode keep the tmp on the
  // USB so a cancelled run can resume on the next plug-in without re-DLing.
  const tempDir = installMode === "fast"
    ? fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-archives-"))
    : path.join(drivePath, ".code-stick-tmp");

  // Fast-mode archive dir is host-side and ephemeral — register a cleanup so
  // it doesn't survive a crash or Ctrl-C. Direct-mode tempDir lives on the
  // USB and is deleted by postInstallCleanup once everything succeeds.
  if (installMode === "fast") {
    const fastTempDir = tempDir;
    registerCleanup(() => {
      try { fs.rmSync(fastTempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });
  }

  // Re-install: model store and opencode provider cache MUST be wiped before
  // model pull so blobs from the previous default model don't linger forever
  // (the new manifest only references one model, so `code-stick remove-model`
  // can't reach them). Config is regenerated from scratch below.
  //
  // CRITICAL: binary trees (engine/, opencode/) are NOT wiped here. They are
  // staged into hidden sibling dirs and atomically swapped only after every
  // target extracts + verifies successfully. Otherwise a download failure on
  // target #4 of 5 leaves the stick with no working launcher on any platform.
  if (isReinstall) {
    log.dim("Removing old model store, caches, and config before fresh install...");
    const wipeDirs = [
      p.data,
      p.cache,
      p.state,
      path.join(drivePath, "config", "opencode"),
    ];
    for (const dir of wipeDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); }
      catch (err) {
        log.warn(`Could not remove ${dir}: ${(err as Error).message}`);
      }
    }
  }

  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(p.data, { recursive: true });
  fs.mkdirSync(p.config, { recursive: true });
  fs.mkdirSync(p.cache, { recursive: true });
  fs.mkdirSync(p.state, { recursive: true });

  const totalSteps = 5;
  log.blank();
  log.step(1, totalSteps, `Staging binaries for ${selectedTargets.length} target(s)...`);
  log.step(2, totalSteps, "Atomic swap into <USB>/engine and <USB>/opencode...");
  await stageAndSwapBinaries(drivePath, tempDir, selectedTargets);

  log.step(3, totalSteps, `Pulling model ${model!.tag} (${installMode === "fast" ? "stage on host" : "direct to USB"})...`);
  try {
    if (installMode === "fast") {
      await pullModelFast(drivePath, model!, p.data);
    } else {
      await pullModelTag(drivePath, model!.tag);
    }
  } finally {
    await stopAll().catch(() => undefined);
  }

  const now = new Date().toISOString();
  const manifest: Manifest = {
    version: "2",
    installedAt: now,
    models: [{ id: model!.id, tag: model!.tag, addedAt: now }],
    defaultModelId: model!.id,
    targets: [...selectedTargets],
    ollamaVersions: { host: OLLAMA_VERSIONS.host, linux: OLLAMA_VERSIONS.linux },
    opencodeVersion: OPENCODE_VERSION,
  };

  log.step(4, totalSteps, "Writing opencode config + pre-staging providers + launchers...");
  writeOpencodeConfig(drivePath, manifest);
  // Pre-stage @ai-sdk/openai-compatible into <USB>/cache/opencode so the
  // standalone opencode binary doesn't reach out to npm on first launch.
  // Best-effort: if the host is missing npm, surface a warning but keep
  // going — the user can still install the package on first online launch.
  const prestage = prestageOpencodeProviders(p.opencodeCache);
  if (!prestage.ok) {
    log.warn(`Could not pre-stage opencode provider package: ${prestage.reason}`);
    log.dim("Offline launches will fail until the package is fetched from npm. " +
            "Run `code-stick install` again on a host with npm available, " +
            "or run opencode once on an online machine to populate the cache.");
  }
  renderLaunchers(drivePath, { modelTag: model!.tag, targets: selectedTargets });

  const skipCleanup = opts.cleanup === false;
  log.step(5, totalSteps, skipCleanup ? "Writing manifest (cleanup skipped)..." : "Writing manifest + cleanup...");
  saveManifest(drivePath, manifest);
  if (skipCleanup) {
    log.dim("Skipping cleanup (--no-cleanup) — installer archives + .code-stick-tmp left in place");
  } else {
    postInstallCleanup(drivePath, tempDir);
  }

  log.blank();
  log.success(`Installed code-stick on ${drivePath}`);
  warnIfLosesExecBit(fsInfo);
  log.info("Launch from the USB:");
  if (selectedTargets.some((t) => t === "windows-x64")) {
    log.dim(`  Windows:  start-windows.bat`);
  }
  if (selectedTargets.some((t) => t === "darwin-arm64" || t === "darwin-x64")) {
    log.dim(`  macOS:    start-mac.command`);
  }
  if (selectedTargets.some((t) => t === "linux-x64" || t === "linux-arm64")) {
    log.dim(`  Linux:    ./start-linux.sh`);
  }
  log.dim("Or run: code-stick start");
  log.dim("Add another model later: code-stick add-model");
  if (!fullPortability) {
    log.dim("Add more OS targets later: code-stick add-targets <list>");
  }
  if (process.platform === "darwin") {
    log.blank();
    log.info("macOS first-launch tip:");
    log.dim("  Gatekeeper may quarantine unsigned binaries copied via external media.");
    log.dim("  If double-clicking start-mac.command bounces, right-click → Open → Open.");
    log.dim("  This ritual is one-time per launcher, per machine.");
  }
  } finally {
    if (logOpen) closeInstallLog();
  }
}

/** Stage Ollama blobs on host SSD then copy to USB. Avoids USB read+write contention. */
async function pullModelFast(drivePath: string, model: CodingModel, finalData: string): Promise<void> {
  const requiredStageGB = Math.ceil(model.sizeGB * 2 + 1);
  const freeNow = getFreeSpaceGB(os.tmpdir());
  if (freeNow !== null && freeNow < requiredStageGB) {
    throw new Error(
      `Not enough temp space for fast install: need ~${requiredStageGB} GB, ` +
      `only ${freeNow.toFixed(1)} GB free at ${os.tmpdir()}. ` +
      `Free up space and re-run, or use Direct-to-USB.`,
    );
  }

  // Create stage dir + register cleanup BEFORE any await so a SIGINT between
  // mkdtempSync and the first network call still removes the dir via stopAll.
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-stage-"));
  const cleanupStage = () => {
    try { fs.rmSync(stageRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  // Single SIGINT path — the global setupShutdownHooks calls stopAll() which
  // fires this callback after processes are killed. No competing process.exit.
  const unregister = registerCleanup(cleanupStage);

  try {
    const stagedData = path.join(stageRoot, "data");
    fs.mkdirSync(stagedData, { recursive: true });
    log.dim(`Staging blobs at ${stagedData}...`);
    await pullModelTag(drivePath, model.tag, stagedData);
    await copyDirWithProgress(stagedData, finalData, "Copying model to USB");
  } catch (err) {
    if (isENOSPC(err)) {
      throw new Error(
        "Ran out of disk space during fast install. Re-run with Direct-to-USB instead.",
      );
    }
    throw err;
  } finally {
    unregister();
    cleanupStage();
  }
}

function isENOSPC(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "ENOSPC") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ENOSPC|no space left/i.test(msg);
}

