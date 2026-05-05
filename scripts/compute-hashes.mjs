#!/usr/bin/env node
// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
//
// Fetch every Ollama + opencode release asset code-stick depends on and emit
// the sha256 hashes. Run before publishing to npm so the catalog files no
// longer contain "PENDING-*" placeholders.
//
//   node scripts/compute-hashes.mjs              # downloads + hashes all
//   node scripts/compute-hashes.mjs --only=ollama
//   node scripts/compute-hashes.mjs --only=opencode
//
// Output is a JSON map { "<filename>": "<sha256>", ... } printed to stdout.
// Paste each value into the matching catalog entry's `sha256` field.

import { createHash } from "node:crypto";
import { mkdtempSync, createWriteStream, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

const OLLAMA_VERSION = "v0.21.2";
const OPENCODE_VERSION = "v0.4.18";

const OLLAMA_BASE = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}`;
const OPENCODE_BASE = `https://github.com/sst/opencode/releases/download/${OPENCODE_VERSION}`;

const ASSETS = {
  ollama: [
    `${OLLAMA_BASE}/ollama-windows-amd64.zip`,
    `${OLLAMA_BASE}/ollama-darwin.zip`,
    `${OLLAMA_BASE}/ollama-linux-amd64.tar.zst`,
    `${OLLAMA_BASE}/ollama-linux-arm64.tar.zst`,
  ],
  opencode: [
    `${OPENCODE_BASE}/opencode-windows-x64.zip`,
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
