#!/usr/bin/env node
// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a | MUGM-d3c1-ocv2
//
// Fetch every Ollama + opencode release asset code-stick depends on and emit
// the sha256 hashes. Run before publishing to npm so the catalog files no
// longer contain "PENDING-*" placeholders.
//
//   node scripts/compute-hashes.mjs                                  # all
//   node scripts/compute-hashes.mjs --only=ollama
//   node scripts/compute-hashes.mjs --only=opencode
//   node scripts/compute-hashes.mjs --opencode-version=v0.4.20       # hash a new release
//
// OPENCODE_VERSION is sourced from src/catalog/opencode.ts so the script can't
// drift from the catalog. Pass --opencode-version to hash a different release
// (useful when prepping a catalog bump).
//
// Output is a JSON map { "<filename>": "<sha256>", ... } printed to stdout.
// Paste each value into the matching catalog entry's `sha256` field.

import { createHash } from "node:crypto";
import { mkdtempSync, createWriteStream, statSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

function readOpencodeVersionFromCatalog() {
  const src = readFileSync(resolve(REPO_ROOT, "src/catalog/opencode.ts"), "utf8");
  const m = src.match(/OPENCODE_VERSION\s*=\s*"(v\d+\.\d+\.\d+)"/);
  if (!m) {
    throw new Error("Could not find OPENCODE_VERSION in src/catalog/opencode.ts — refusing to compute hashes against an unknown version.");
  }
  return m[1];
}

const opencodeOverride = process.argv.find((a) => a.startsWith("--opencode-version="));
const OPENCODE_VERSION = opencodeOverride
  ? opencodeOverride.slice("--opencode-version=".length)
  : readOpencodeVersionFromCatalog();

const OLLAMA_VERSION = "v0.21.2";

const OLLAMA_BASE = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}`;
const OPENCODE_BASE = `https://github.com/sst/opencode/releases/download/${OPENCODE_VERSION}`;

const ASSETS = {
  ollama: [
    `${OLLAMA_BASE}/ollama-windows-amd64.zip`,
    `${OLLAMA_BASE}/ollama-windows-arm64.zip`,
    `${OLLAMA_BASE}/ollama-darwin.zip`,
    `${OLLAMA_BASE}/ollama-linux-amd64.tgz`,
    `${OLLAMA_BASE}/ollama-linux-arm64.tgz`,
  ],
  opencode: [
    `${OPENCODE_BASE}/opencode-windows-x64.zip`,
    `${OPENCODE_BASE}/opencode-windows-arm64.zip`,
    `${OPENCODE_BASE}/opencode-darwin-arm64.zip`,
    `${OPENCODE_BASE}/opencode-darwin-x64.zip`,
    `${OPENCODE_BASE}/opencode-linux-x64.zip`,
    `${OPENCODE_BASE}/opencode-linux-arm64.zip`,
  ],
};

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length) : null;

async function fetchAndHash(url, dir) {
  const filename = url.split("/").pop();
  const dest = join(dir, filename);

  process.stderr.write(`-> ${filename} ... `);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const hash = createHash("sha256");
  const out = createWriteStream(dest);

  const tee = new TransformStream({
    transform(chunk, controller) {
      hash.update(chunk);
      controller.enqueue(chunk);
    },
  });

  await pipeline(res.body.pipeThrough(tee), out);
  const sz = (statSync(dest).size / 1e6).toFixed(1);
  const digest = hash.digest("hex");
  process.stderr.write(`${sz} MB  ${digest}\n`);
  return [filename, digest];
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "code-stick-hash-"));
  const out = {};
  try {
    const groups = only ? [only] : Object.keys(ASSETS);
    for (const g of groups) {
      const list = ASSETS[g];
      if (!list) {
        console.error(`Unknown group: ${g} (use ollama or opencode)`);
        process.exit(2);
      }
      for (const url of list) {
        const [name, digest] = await fetchAndHash(url, dir);
        out[name] = digest;
      }
    }
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
