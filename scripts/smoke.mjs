#!/usr/bin/env node
// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
//
// End-to-end smoke test for code-stick on Linux. Run inside the Dockerfile at
// scripts/smoke.Dockerfile, or directly on a Linux host with network access.
//
// Steps (every step prints a `[smoke]` line so CI logs read top-to-bottom):
//   1. Build the CLI (tsup).
//   2. `code-stick install --target $USB --model phi3-mini --no-cleanup --yes`
//      → smallest catalog model so a CI run finishes in <10 min.
//   3. Verify launcher + binaries + manifest exist on the fake USB.
//   4. Run `code-stick doctor --no-probe --target $USB` → must exit 0.
//   5. Boot ollama from <USB>/engine/linux-<arch>/ollama, probe /api/version
//      until 200, smoke-list /api/tags.
//   6. Run `<USB>/opencode/linux-<arch>/opencode --version` (exit 0).
//   7. Kill ollama, exit clean.
//
// Smoke is intentionally Linux-only. macOS/Windows need licensed runners.
// See README troubleshooting for per-OS manual smoke steps.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const USB = process.env.SMOKE_USB || path.join(os.tmpdir(), "code-stick-smoke-usb");
const MODEL = process.env.SMOKE_MODEL || "phi3-mini";
const ARCH_DIR = process.arch === "arm64" ? "linux-arm64" : "linux-x64";

function log(msg) { console.log(`[smoke] ${msg}`); }
function fail(msg) { console.error(`[smoke] FAIL: ${msg}`); process.exit(1); }

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
  if (r.status !== 0) fail(`"${cmd} ${args.join(" ")}" exited ${r.status}`);
  return r;
}

async function probeOllama(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get("http://127.0.0.1:11434/api/version", { timeout: 1500 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  log(`USB target: ${USB}`);
  log(`Model: ${MODEL}`);
  log(`Arch dir: ${ARCH_DIR}`);

  fs.rmSync(USB, { recursive: true, force: true });
  fs.mkdirSync(USB, { recursive: true });

  log("Step 1: build CLI");
  run("npm", ["run", "build"]);

  log("Step 2: install");
  run("node", ["dist/cli.js", "install", "--target", USB, "--model", MODEL, "--yes"]);

  log("Step 3: layout check");
  for (const rel of [
    "code-stick.json",
    "start-linux.sh",
    `engine/${ARCH_DIR}/ollama`,
    `opencode/${ARCH_DIR}/opencode`,
    "data",
    "config/opencode/opencode.json",
  ]) {
    const p = path.join(USB, rel);
    if (!fs.existsSync(p)) fail(`missing expected path: ${rel}`);
  }

  log("Step 4: doctor (no live probe)");
  run("node", ["dist/cli.js", "doctor", "--no-probe", "--target", USB]);

  log("Step 5: boot ollama and probe HTTP");
  const ollamaBin = path.join(USB, "engine", ARCH_DIR, "ollama");
  fs.chmodSync(ollamaBin, 0o755);
  const env = {
    ...process.env,
    OLLAMA_MODELS: path.join(USB, "data"),
    OLLAMA_HOST: "127.0.0.1:11434",
  };
  const child = spawn(ollamaBin, ["serve"], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => process.stderr.write(`[ollama] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[ollama] ${d}`));

  try {
    const ready = await probeOllama();
    if (!ready) fail("ollama did not respond on /api/version within 30s");
    log("ollama is up");

    log("Step 6: opencode --version");
    const opencodeBin = path.join(USB, "opencode", ARCH_DIR, "opencode");
    fs.chmodSync(opencodeBin, 0o755);
    run(opencodeBin, ["--version"], { stdio: "inherit" });
  } finally {
    log("Killing ollama");
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 500));
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
  }

  log("OK");
}

main().catch((err) => fail(err?.stack || String(err)));
