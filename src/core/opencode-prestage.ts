// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { log } from "../utils/logger.js";

/**
 * Pre-stage opencode's runtime npm dependency on the USB so the standalone
 * binary can resolve it offline on first launch.
 *
 * Why this exists: opencode v0.4.x declares custom providers via a `npm`
 * field in opencode.json. On first invocation it calls
 * `bun add --cwd $XDG_CACHE_HOME/opencode <pkg>@latest` to install the
 * package — that's a network call. The "portable, air-gapped" pitch falls
 * apart on a fresh offline host.
 *
 * Mitigation: install the package now (we ARE online during `code-stick
 * install`), and seed `$XDG_CACHE_HOME/opencode/package.json` with the exact
 * literal version `"latest"` so opencode's short-circuit at
 * `parsed.dependencies[pkg] === version` fires before any `bun add` runs.
 */

// The single dependency every code-stick install needs. opencode resolves
// `provider.<id>.npm` against this; baseURL is OpenAI-compatible so any
// model exposed by Ollama's /v1 endpoint is reachable.
const OPENCODE_NPM_PROVIDERS = ["@ai-sdk/openai-compatible"];

export interface PrestageResult {
  ok: boolean;
  /** Why we couldn't pre-stage (only set when ok=false). */
  reason?: string;
}

export function prestageOpencodeProviders(opencodeCacheDir: string): PrestageResult {
  fs.mkdirSync(opencodeCacheDir, { recursive: true });

  // The literal string "latest" matches opencode's BunProc.install() default
  // version arg (bun/index.ts:60). Storing the package list this way makes
  // the parsed.dependencies[pkg] === version short-circuit at bun/index.ts:68
  // fire on every subsequent launch — no `bun add`, no network.
  const pkgJson: Record<string, unknown> = {
    name: "code-stick-opencode-cache",
    private: true,
    dependencies: Object.fromEntries(OPENCODE_NPM_PROVIDERS.map((p) => [p, "latest"])),
  };
  const pkgJsonPath = path.join(opencodeCacheDir, "package.json");
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2), "utf-8");

  // Detect npm. The host running `code-stick install` has Node 20+, so npm is
  // present on PATH unless someone went out of their way to break it. On
  // Windows the executable is `npm.cmd`; spawnSync needs that exact name.
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

  log.dim(`Pre-staging opencode providers in ${opencodeCacheDir}...`);
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(
      npmCmd,
      [
        "install",
        "--prefix", opencodeCacheDir,
        "--omit=dev",
        "--no-audit", "--no-fund",
        "--no-package-lock",
        // CRITICAL for portability: --ignore-scripts disables postinstall hooks
        // that would otherwise run prebuild-install and download host-arch
        // native binaries. The USB has to boot on Windows / macOS / Linux
        // without surprises, so we refuse to ship arch-tied bindings.
        "--ignore-scripts",
        "--loglevel=error",
      ],
      {
        encoding: "utf-8",
        windowsHide: true,
        // npm spam is suppressed by --loglevel=error; show errors via stderr.
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5 * 60 * 1000,
      },
    );
  } catch (err) {
    return { ok: false, reason: `npm spawn failed: ${(err as Error).message}` };
  }

  if (result.error) {
    return { ok: false, reason: `npm error: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim().split("\n").slice(-5).join("\n");
    return { ok: false, reason: `npm install exited ${result.status}\n${stderr}` };
  }

  // Sanity: confirm node_modules exists for every declared provider. opencode
  // resolves `<cache>/opencode/node_modules/<pkg>/package.json` — anything
  // less and the runtime will still try to bun-add.
  const missing: string[] = [];
  for (const pkg of OPENCODE_NPM_PROVIDERS) {
    const target = path.join(opencodeCacheDir, "node_modules", pkg, "package.json");
    if (!fs.existsSync(target)) missing.push(pkg);
  }
  if (missing.length) {
    return {
      ok: false,
      reason: `npm install reported success but the following packages are missing: ${missing.join(", ")}`,
    };
  }

  // Portability assertion: scan node_modules for native binary artefacts that
  // would tie the staged tree to the install host's arch/OS. If any show up,
  // bail loudly so the maintainer notices instead of users hitting a broken
  // stick on a different platform.
  const nativeArtefacts = scanNativeArtefacts(path.join(opencodeCacheDir, "node_modules"));
  if (nativeArtefacts.length) {
    return {
      ok: false,
      reason:
        `Staged tree contains host-arch-only artefacts (breaks USB portability):\n` +
        nativeArtefacts.slice(0, 10).map((p) => `  - ${p}`).join("\n") +
        (nativeArtefacts.length > 10 ? `\n  …and ${nativeArtefacts.length - 10} more` : ""),
    };
  }

  log.dim(`Pre-staged: ${OPENCODE_NPM_PROVIDERS.join(", ")}`);
  return { ok: true };
}

/** Walk node_modules looking for files whose presence would make the tree
 *  arch-specific (compiled native bindings, prebuilt platform binaries).
 *  Pure-JS deps return []. */
function scanNativeArtefacts(nodeModulesDir: string): string[] {
  const hits: string[] = [];
  const NATIVE_EXTS = new Set([".node", ".dll", ".dylib", ".so"]);
  const NATIVE_DIRS = new Set(["build", "prebuilds", "Release", "Debug"]);
  const MAX_DEPTH = 6;
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || hits.length > 50) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (NATIVE_DIRS.has(e.name)) hits.push(full);
        else walk(full, depth + 1);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (NATIVE_EXTS.has(ext)) hits.push(full);
      }
    }
  };
  if (fs.existsSync(nodeModulesDir)) walk(nodeModulesDir, 0);
  return hits;
}
