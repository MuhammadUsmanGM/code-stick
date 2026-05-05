// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";
import { pickDrive, assertDriveReady } from "../core/usb.js";
import { usbPaths } from "../utils/paths.js";
import { hostTarget } from "../utils/platform.js";
import { ollamaBinaryRel } from "../catalog/ollama.js";
import { opencodeBinaryRel } from "../catalog/opencode.js";
import { loadManifest, defaultModel } from "../state/manifest.js";
import { inspectOllamaData } from "../core/health.js";
import {
  startOllama, waitForOllama, runOpencodeForeground,
  stopAll, setupShutdownHooks, checkPortFree,
} from "../core/process-manager.js";

interface StartOptions { target?: string; }

export async function startCommand(opts: StartOptions): Promise<void> {
  setupShutdownHooks();
  log.banner("Start");

  const drivePath = await pickDrive(opts.target);
  assertDriveReady(drivePath);

  const manifest = loadManifest(drivePath);
  if (!manifest) {
    log.error(`No code-stick installation found at ${drivePath}.`);
    log.info("Run: code-stick install");
    process.exit(1);
  }

  const target = hostTarget();
  const p = usbPaths(drivePath);
  const ollamaBin = path.join(p.engine(target), ollamaBinaryRel(target));
  const opencodeBin = path.join(p.opencode(target), opencodeBinaryRel(target));

  if (!fs.existsSync(ollamaBin)) {
    log.error(`Ollama binary missing for this host (${target}): ${ollamaBin}`);
    log.info(`Re-run: code-stick install --target "${drivePath}"`);
    process.exit(1);
  }
  if (!fs.existsSync(opencodeBin)) {
    log.error(`opencode binary missing for this host (${target}): ${opencodeBin}`);
    log.info(`Re-run: code-stick install --target "${drivePath}"`);
    process.exit(1);
  }

  const health = inspectOllamaData(p.data);
  if (!health.hasModelData) {
    log.error("Model store on USB is empty or incomplete.");
    log.info(`Re-run: code-stick install --target "${drivePath}"`);
    process.exit(1);
  }

  await checkPortFree();

  const def = defaultModel(manifest);
  const otherCount = manifest.models.length - 1;
  log.info(`Model: ${def.tag}${otherCount > 0 ? ` (+${otherCount} other on stick)` : ""}`);
  log.dim("Starting Ollama from USB...");
  startOllama(drivePath);
  const ready = await waitForOllama(45_000);
  if (!ready) {
    log.error("Ollama did not become ready in time.");
    await stopAll();
    process.exit(1);
  }
  log.success("Ollama is ready");
  log.blank();
  log.info("Launching opencode (Ctrl+C to quit)...");
  log.blank();

  let exitCode = 0;
  try {
    exitCode = await runOpencodeForeground(drivePath);
  } finally {
    await stopAll();
  }
  process.exit(exitCode);
}
