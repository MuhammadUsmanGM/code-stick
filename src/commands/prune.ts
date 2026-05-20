// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-pt3x-9y8z
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";
import { promptWithEsc } from "../utils/prompt.js";
import { pickDrive } from "../core/usb.js";
import { usbPaths } from "../utils/paths.js";
import { hostTarget } from "../utils/platform.js";
import { loadManifest } from "../state/manifest.js";
import { ollamaBinaryRel } from "../catalog/ollama.js";

interface PruneOptions {
  target?: string;
  yes?: boolean;
}

export async function pruneCommand(opts: PruneOptions): Promise<void> {
  log.banner("Prune");

  const drivePath = await pickDrive(opts.target);
  const manifest = loadManifest(drivePath);
  if (!manifest) {
    log.error("No manifest found — installation is missing or corrupted.");
    log.info(`Run: code-stick install --target "${drivePath}"`);
    return;
  }

  const target = hostTarget();
  const p = usbPaths(drivePath);
  const bin = path.join(p.engine(target), ollamaBinaryRel(target));
  if (!fs.existsSync(bin)) {
    log.error(`Host ollama binary missing for target ${target}.`);
    log.info(`Run: code-stick upgrade-engine --target "${drivePath}"`);
    return;
  }

  if (!opts.yes) {
    const confirmed = await promptWithEsc([{ type: "confirm", name: "confirm", message: `Run [1mollama prune[22m on ${p.data}? This may remove orphaned model blobs.`, default: false }]);
    if (!confirmed?.confirm) {
      log.info("Cancelled.");
      return;
    }
  }

  log.info("Pruning orphaned Ollama blobs...");
  const exitCode = await runOllamaPrune(bin, p.data);
  if (exitCode !== 0) {
    log.error(`ollama prune failed with exit code ${exitCode}.`);
    process.exitCode = 1;
    return;
  }

  log.success("Prune complete. Orphaned blobs were removed where possible.");
}

async function runOllamaPrune(bin: string, dataPath: string): Promise<number> {
  const env = { ...process.env, OLLAMA_MODELS: dataPath };
  let exitCode = await spawnPrune(bin, ["prune", "--yes"], env);
  if (exitCode === 0) return 0;
  log.dim("Retrying without --yes, in case this Ollama version does not support that flag.");
  exitCode = await spawnPrune(bin, ["prune"], env);
  return exitCode;
}

function spawnPrune(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
