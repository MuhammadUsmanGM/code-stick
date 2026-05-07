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
import { ALL_TARGETS, type Target } from "../catalog/targets.js";
import { OLLAMA, ollamaBinaryRel } from "../catalog/ollama.js";
import { OPENCODE, opencodeBinaryRel } from "../catalog/opencode.js";
import { MODELS, findModel, type CodingModel } from "../catalog/models.js";
import { download } from "../core/downloader.js";
import { extractZipFile, extractTarFile, ensureBinaryAt } from "../core/extract.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { saveManifest, loadManifest, type Manifest } from "../state/manifest.js";
import { preflightFilesystem, warnIfLosesExecBit } from "../core/preflight.js";
import { postInstallCleanup } from "../core/cleanup.js";
import { setupShutdownHooks, stopAll, registerCleanup } from "../core/process-manager.js";
import { stripQuarantineIfMac } from "../core/macos.js";
import { pullModelTag } from "../core/model-pull.js";
import { writeOpencodeConfig } from "../core/opencode-config.js";
import { copyDirWithProgress } from "../core/copy.js";

interface InstallOptions {
  target?: string;
  model?: string;
  yes?: boolean;
  // Commander's --no-cleanup flag flips this to false; default (omitted) is true.
  cleanup?: boolean;
}

type InstallMode = "fast" | "slow";

// Mixed reality: Win/macOS ship v0.21.2, Linux ships v0.13.0 (last release with
// .tgz — v0.14+ is .tar.zst only). Manifest stores both so upgrade tooling can
// reason about per-target versions. opencode is uniform across targets.
const OLLAMA_VERSION = "v0.21.2 (linux=v0.13.0)";
const OPENCODE_VERSION = "v0.4.18";

const BINARY_FOOTPRINT_GB = 1.5;

export async function installCommand(opts: InstallOptions): Promise<void> {
  setupShutdownHooks();
  log.banner("Installer");
  log.dim("(Press Esc at any step to go back)");

  // Step machine — Esc at any step rewinds to the previous one.
  type Step = "drive" | "model" | "speed" | "space" | "done";
  let step: Step = "drive";

  let drivePath = "";
  let model: CodingModel | undefined;
  let installMode: InstallMode = "slow";

  while (step !== "done") {
    if (step === "drive") {
      const picked = await pickInstallDrive(opts.target);
      if (picked === null) { log.info("Cancelled."); return; }
      drivePath = picked;

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

  const p = usbPaths(drivePath);
  const tempDir = path.join(drivePath, ".code-stick-tmp");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(p.data, { recursive: true });
  fs.mkdirSync(p.config, { recursive: true });

  const totalSteps = 5;
  log.blank();
  log.step(1, totalSteps, `Downloading Ollama for ${ALL_TARGETS.length} target(s)...`);
  for (const t of ALL_TARGETS) await fetchAndExtractOllama(t, p.engine(t), tempDir);

  log.step(2, totalSteps, `Downloading opencode for ${ALL_TARGETS.length} target(s)...`);
  for (const t of ALL_TARGETS) await fetchAndExtractOpencode(t, p.opencode(t), tempDir);

  stripQuarantineIfMac(path.join(drivePath, "engine"), path.join(drivePath, "opencode"));

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
    targets: [...ALL_TARGETS],
    ollamaVersion: OLLAMA_VERSION,
    opencodeVersion: OPENCODE_VERSION,
  };

  log.step(4, totalSteps, "Writing opencode config + launchers...");
  writeOpencodeConfig(drivePath, manifest);
  renderLaunchers(drivePath, { modelTag: model!.tag });

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
  log.dim(`  Windows:  start-windows.bat`);
  log.dim(`  macOS:    start-mac.command`);
  log.dim(`  Linux:    ./start-linux.sh`);
  log.dim("Or run: code-stick start");
  log.dim("Add another model later: code-stick add-model");
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

async function fetchAndExtractOllama(target: Target, destDir: string, tempDir: string): Promise<void> {
  const art = OLLAMA[target];
  fs.mkdirSync(destDir, { recursive: true });
  const archivePath = path.join(tempDir, art.filename);
  await download({
    url: art.url, mirrors: art.mirrors, dest: archivePath,
    expectedHash: art.sha256, label: `ollama ${target}`,
  });
  if (art.type === "zip") await extractZipFile(archivePath, destDir);
  else await extractTarFile(archivePath, destDir);
  const rel = ollamaBinaryRel(target);
  ensureBinaryAt(destDir, rel, `ollama ${target}`);
  ensureExecutable(path.join(destDir, rel));
}

async function fetchAndExtractOpencode(target: Target, destDir: string, tempDir: string): Promise<void> {
  const art = OPENCODE[target];
  fs.mkdirSync(destDir, { recursive: true });
  const archivePath = path.join(tempDir, art.filename);
  await download({
    url: art.url, mirrors: art.mirrors, dest: archivePath,
    expectedHash: art.sha256, label: `opencode ${target}`,
  });
  if (art.type === "zip") await extractZipFile(archivePath, destDir);
  else await extractTarFile(archivePath, destDir);
  const rel = opencodeBinaryRel(target);
  ensureBinaryAt(destDir, rel, `opencode ${target}`);
  ensureExecutable(path.join(destDir, rel));
}

function ensureExecutable(binPath: string): void {
  if (!fs.existsSync(binPath)) return;
  if (process.platform === "win32") return;
  try { fs.chmodSync(binPath, 0o755); }
  catch { /* FAT/exFAT — chmod is a no-op there. Launchers handle perm errors. */ }
}
