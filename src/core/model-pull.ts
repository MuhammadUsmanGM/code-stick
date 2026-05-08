// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";
import { hostTarget } from "../utils/platform.js";
import { usbPaths } from "../utils/paths.js";
import { ollamaBinaryRel } from "../catalog/ollama.js";
import {
  checkPortFree, waitForOllama, registerProcess, killProcess,
} from "./process-manager.js";

/**
 * Spawn a temp Ollama server pointed at the USB store and run an arbitrary
 * Ollama subcommand against it. Used by `install`, `add-model`, and
 * `remove-model` so all three share one server-lifecycle implementation.
 */
async function withTempOllama<T>(
  drivePath: string,
  fn: (ollamaBin: string, env: NodeJS.ProcessEnv) => Promise<T>,
  dataDirOverride?: string,
): Promise<T> {
  await checkPortFree();

  const target = hostTarget();
  const p = usbPaths(drivePath);
  const ollamaBin = path.join(p.engine(target), ollamaBinaryRel(target));

  if (!fs.existsSync(ollamaBin)) {
    throw new Error(
      `Ollama binary missing for host target ${target}: ${ollamaBin}. ` +
      `Run \`code-stick upgrade-engine --target "${drivePath}"\` to re-fetch the engine.`
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OLLAMA_MODELS: dataDirOverride ?? p.data,
    OLLAMA_HOST: "127.0.0.1:11434",
  };

  log.dim("Starting temporary Ollama server...");
  const server = spawn(ollamaBin, ["serve"], {
    env, stdio: "ignore", windowsHide: true, detached: false,
  });
  // Register with the global process manager so SIGINT/stopAll() tears it
  // down with tree-kill + grace period instead of orphaning it on port 11434.
  registerProcess("ollama-temp", server);

  let serverExited = false;
  server.on("exit", () => { serverExited = true; });

  try {
    const ready = await waitForOllama(45_000);
    if (!ready) {
      throw new Error(
        "Temporary Ollama server did not respond on http://127.0.0.1:11434/api/version within 45s. " +
        `Run \`code-stick doctor --target "${drivePath}"\` to diagnose (likely: stale ollama process, wrong arch binary, or AV blocking).`
      );
    }
    if (serverExited) {
      throw new Error(
        "Ollama process exited immediately after spawn. " +
        `Run \`code-stick doctor --target "${drivePath}"\` and check that the host target binary matches your CPU arch.`
      );
    }
    return await fn(ollamaBin, env);
  } finally {
    log.dim("Stopping temporary Ollama server...");
    await killProcess("ollama-temp");
  }
}

function runOllama(bin: string, env: NodeJS.ProcessEnv, args: string[], stdio: "inherit" | "ignore" = "inherit"): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio, windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ollama ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export async function pullModelTag(
  drivePath: string,
  tag: string,
  dataDirOverride?: string,
): Promise<void> {
  const dataDir = dataDirOverride ?? usbPaths(drivePath).data;
  try {
    await withTempOllama(drivePath, async (bin, env) => {
      log.info(`Running ollama pull ${tag} (this can take a while)...`);
      await runOllama(bin, env, ["pull", tag]);
      log.success(`Model ${tag} stored`);
    }, dataDirOverride);
  } catch (err) {
    // The temp server is killed (tree-kill SIGTERM with grace) before this
    // catch fires; if `ollama pull` was mid-write, partial blob files may
    // remain in <data>/blobs/. Sweep them so the next pull starts clean.
    cleanPartialBlobs(dataDir);
    throw err;
  }
}

export async function removeModelTag(drivePath: string, tag: string): Promise<void> {
  await withTempOllama(drivePath, async (bin, env) => {
    log.info(`Running ollama rm ${tag}...`);
    await runOllama(bin, env, ["rm", tag], "ignore");
    log.success(`Removed ${tag} from USB store`);
  });
}

/**
 * Remove any leftover partial blob files from the Ollama store. Ollama has
 * shipped two naming conventions across versions:
 *   - older: `sha256-<hex>-partial` and `sha256-<hex>-partial-<n>`
 *   - newer: `sha256-<hex>.partial` and `sha256-<hex>.partial-<n>`
 * Both forms appear during/after an aborted pull. Neither is referenced by
 * any manifest, so both are safe to delete unconditionally.
 */
function cleanPartialBlobs(dataDir: string): void {
  const blobsDir = path.join(dataDir, "blobs");
  if (!fs.existsSync(blobsDir)) return;
  let removed = 0;
  try {
    for (const name of fs.readdirSync(blobsDir)) {
      if (!/[-.]partial(?:[-.]\d+)?$/.test(name)) continue;
      try {
        fs.rmSync(path.join(blobsDir, name), { force: true });
        removed++;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  if (removed > 0) log.dim(`Cleaned ${removed} partial blob(s) from ${blobsDir}`);
}
