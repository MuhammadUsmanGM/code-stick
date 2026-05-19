// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";
import { hostTarget } from "../utils/platform.js";
import { usbPaths } from "../utils/paths.js";
import { ollamaBinaryRel } from "../catalog/ollama.js";
import { getNumCtxForTag } from "../catalog/models.js";
import {
  checkPortFree, waitForOllama, registerProcess, killProcess, registerCleanup,
} from "./process-manager.js";

export interface PullModelOptions {
  /**
   * Point TMPDIR/TEMP/TMP at host temp during `ollama pull` so download
   * buffers and unpack scratch hit the SSD, while OLLAMA_MODELS still targets
   * the USB. Helps Direct-to-USB installs on slow sticks.
   */
  hostPullScratch?: boolean;
}

/**
 * Spawn a temp Ollama server pointed at the USB store and run an arbitrary
 * Ollama subcommand against it. Used by `install`, `add-model`, and
 * `remove-model` so all three share one server-lifecycle implementation.
 */
function hostPullScratchEnv(): { env: NodeJS.ProcessEnv; dispose: () => void } {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-ollama-scratch-"));
  const dispose = () => {
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  registerCleanup(dispose);
  log.dim(`Ollama pull scratch on host: ${scratch}`);
  return {
    env: { TMPDIR: scratch, TEMP: scratch, TMP: scratch },
    dispose,
  };
}

async function withTempOllama<T>(
  drivePath: string,
  fn: (ollamaBin: string, env: NodeJS.ProcessEnv) => Promise<T>,
  dataDirOverride?: string,
  pullOptions?: PullModelOptions,
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

  const scratch = pullOptions?.hostPullScratch ? hostPullScratchEnv() : null;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(scratch?.env ?? {}),
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
    scratch?.dispose();
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
  numCtxOverride?: number,
  pullOptions?: PullModelOptions,
): Promise<void> {
  const dataDir = dataDirOverride ?? usbPaths(drivePath).data;
  try {
    await withTempOllama(drivePath, async (bin, env) => {
      log.info(`Running ollama pull ${tag} (this can take a while)...`);
      await runOllama(bin, env, ["pull", tag]);
      log.success(`Model ${tag} stored`);

      // Bake the per-model num_ctx into the tag in place. Ollama's server
      // default is 2048 tokens, which is smaller than opencode's system
      // prompt + tool definitions alone (~3–4k tokens); without this the
      // model receives a truncated prompt and hallucinates tool calls.
      // `ollama create <same-tag> -f Modelfile` overwrites the manifest in
      // place — the weight blob is shared, no re-download, no namespace
      // change, opencode keeps referencing `ollama/<tag>` exactly as before.
      // MUGM-ctx-7a92.
      const numCtx = numCtxOverride ?? getNumCtxForTag(tag);
      await bakeNumCtx(bin, env, tag, numCtx);
    }, dataDirOverride, pullOptions);
  } catch (err) {
    // The temp server is killed (tree-kill SIGTERM with grace) before this
    // catch fires; if `ollama pull` was mid-write, partial blob files may
    // remain in <data>/blobs/. Sweep them so the next pull starts clean.
    cleanPartialBlobs(dataDir);
    throw err;
  }
}

/**
 * Run `ollama create <tag> -f <modelfile>` against the temp server, where the
 * Modelfile sets `PARAMETER num_ctx <n>` on top of the existing tag. Exported
 * so upgrade-engine can re-bake the whole manifest in one pass for v0.2.0
 * sticks. Caller is responsible for spinning up withTempOllama and passing
 * the shared (bin, env) pair so OLLAMA_MODELS continues to point at the USB.
 */
export async function bakeNumCtx(
  bin: string,
  env: NodeJS.ProcessEnv,
  tag: string,
  numCtx: number,
): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-modelfile-"));
  try {
    const modelfilePath = path.join(tmpDir, "Modelfile");
    fs.writeFileSync(modelfilePath, `FROM ${tag}\nPARAMETER num_ctx ${numCtx}\n`);
    log.dim(`Baking num_ctx=${numCtx} into ${tag}...`);
    await runOllama(bin, env, ["create", tag, "-f", modelfilePath]);
    log.success(`Baked num_ctx=${numCtx} into ${tag}`);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Public wrapper for callers that want to re-bake an existing model on a
 * stick without doing a full pull. Spins up its own withTempOllama session.
 * Used by `upgrade-engine` to migrate v0.2.0 → v0.2.1 sticks.
 */
export async function rebakeModelTag(
  drivePath: string,
  tag: string,
  numCtx: number,
): Promise<void> {
  await withTempOllama(drivePath, async (bin, env) => {
    await bakeNumCtx(bin, env, tag, numCtx);
  });
}

/**
 * Re-bake every model on a stick in a single withTempOllama session.
 * One server start instead of N — avoids re-spinning the temp server per
 * model (each start is a 45s health-check window in the worst case).
 *
 * Returns a per-model result so the caller can report partial failures
 * without aborting the whole upgrade.
 */
export interface RebakeResult {
  tag: string;
  numCtx: number;
  ok: boolean;
  error?: string;
}

export async function rebakeAllModels(
  drivePath: string,
  models: ReadonlyArray<{ tag: string; numCtx: number }>,
): Promise<RebakeResult[]> {
  if (models.length === 0) return [];
  const results: RebakeResult[] = [];
  await withTempOllama(drivePath, async (bin, env) => {
    for (const m of models) {
      try {
        await bakeNumCtx(bin, env, m.tag, m.numCtx);
        results.push({ tag: m.tag, numCtx: m.numCtx, ok: true });
      } catch (err) {
        results.push({
          tag: m.tag,
          numCtx: m.numCtx,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });
  return results;
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
/** Exported for unit tests. True iff `name` matches the partial-blob naming
 *  convention Ollama uses across versions. */
export function isPartialBlobName(name: string): boolean {
  return /[-.]partial(?:[-.]\d+)?$/.test(name);
}

function cleanPartialBlobs(dataDir: string): void {
  const blobsDir = path.join(dataDir, "blobs");
  if (!fs.existsSync(blobsDir)) return;
  let removed = 0;
  try {
    for (const name of fs.readdirSync(blobsDir)) {
      if (!isPartialBlobName(name)) continue;
      try {
        fs.rmSync(path.join(blobsDir, name), { force: true });
        removed++;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  if (removed > 0) log.dim(`Cleaned ${removed} partial blob(s) from ${blobsDir}`);
}
