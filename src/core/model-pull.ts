// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";
import { hostTarget } from "../utils/platform.js";
import { usbPaths } from "../utils/paths.js";
import { ollamaBinaryRel } from "../catalog/ollama.js";
import { checkPortFree, waitForOllama } from "./process-manager.js";

/**
 * Spawn a temp Ollama server pointed at the USB store and run an arbitrary
 * Ollama subcommand against it. Used by `install`, `add-model`, and
 * `remove-model` so all three share one server-lifecycle implementation.
 */
async function withTempOllama<T>(
  drivePath: string,
  fn: (ollamaBin: string, env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  await checkPortFree();

  const target = hostTarget();
  const p = usbPaths(drivePath);
  const ollamaBin = path.join(p.engine(target), ollamaBinaryRel(target));

  if (!fs.existsSync(ollamaBin)) {
    throw new Error(`Ollama binary missing for host target ${target}: ${ollamaBin}`);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OLLAMA_MODELS: p.data,
    OLLAMA_HOST: "127.0.0.1:11434",
  };

  log.dim("Starting temporary Ollama server...");
  const server = spawn(ollamaBin, ["serve"], {
    env, stdio: "ignore", windowsHide: true, detached: false,
  });

  let serverExited = false;
  server.on("exit", () => { serverExited = true; });

  try {
    const ready = await waitForOllama(45_000);
    if (!ready) throw new Error("Temporary Ollama server failed to come up.");
    if (serverExited) throw new Error("Ollama server exited before request could start.");
    return await fn(ollamaBin, env);
  } finally {
    log.dim("Stopping temporary Ollama server...");
    try { server.kill(); } catch { /* ignore */ }
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

/**
 * Remove leftover `sha256-*-partial*` blobs from a previously-interrupted pull.
 * Safe to call before a fresh pull because the manifest lock prevents another
 * code-stick process from having an in-flight pull on the same stick. We never
 * touch finalized blobs (no `-partial` infix) — those belong to other models.
 */
function pruneStalePartialBlobs(drivePath: string): void {
  const blobsDir = path.join(usbPaths(drivePath).data, "blobs");
  let entries: string[];
  try { entries = fs.readdirSync(blobsDir); }
  catch { return; }
  let pruned = 0;
  for (const name of entries) {
    if (!name.startsWith("sha256-")) continue;
    if (!name.includes("-partial")) continue;
    try { fs.unlinkSync(path.join(blobsDir, name)); pruned++; }
    catch { /* best-effort */ }
  }
  if (pruned > 0) log.dim(`Cleared ${pruned} partial blob(s) from a previous pull.`);
}

export async function pullModelTag(drivePath: string, tag: string): Promise<void> {
  pruneStalePartialBlobs(drivePath);
  await withTempOllama(drivePath, async (bin, env) => {
    log.info(`Running ollama pull ${tag} (this can take a while)...`);
    await runOllama(bin, env, ["pull", tag]);
    log.success(`Model ${tag} stored on USB`);
  });
}

export async function removeModelTag(drivePath: string, tag: string): Promise<void> {
  await withTempOllama(drivePath, async (bin, env) => {
    log.info(`Running ollama rm ${tag}...`);
    await runOllama(bin, env, ["rm", tag], "ignore");
    log.success(`Removed ${tag} from USB store`);
  });
}
