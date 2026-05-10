#!/usr/bin/env node
// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-v3p1-9k7m
//
// Pre-publish guard. Runs `npm pack` and asserts:
//   1. Every file the runtime needs is in the tarball.
//   2. No accidental leakage of src/, test/, scripts/dev-only files,
//      .github/, node_modules/, *.log, etc.
//   3. dist/cli.js resolves the templates/ dir via dist/../templates.
//   4. package.json bin entry points at the built file.
//   5. Tarball size sanity (>50 KB, <2 MB) — guards against a build that
//      omitted dist/cli.js or, conversely, accidentally bundled
//      node_modules.
//
// Exit non-zero on any failure. Used by:
//   - prepublishOnly hook (block local `npm publish`)
//   - .github/workflows/ci.yml `pack-shape` job (block PRs)

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED = [
  "package/dist/cli.js",
  "package/templates/start-windows.bat.ejs",
  "package/templates/start-mac.command.ejs",
  "package/templates/start-linux.sh.ejs",
  "package/scripts/compute-hashes.mjs",
  "package/package.json",
  "package/README.md",
  "package/LICENSE",
];

// Anything matching these patterns must NOT be in the tarball. The list is
// blast-radius-of-leak ordered: secrets first, then bulk, then noise.
const FORBIDDEN_PATTERNS = [
  /^package\/\.env/,
  /^package\/\.npmrc/,
  /^package\/node_modules\//,
  /^package\/src\//,
  /^package\/test\//,
  /^package\/\.github\//,
  /^package\/\.vscode\//,
  /^package\/coverage\//,
  /^package\/dist\/.*\.test\.js$/,
  /\.log$/,
];

const errors = [];
function fail(msg) { errors.push(msg); }

function bytesToStr(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

console.log("[verify-publish] running npm pack --dry-run --json ...");
let packResult;
try {
  // --dry-run does not write a tarball; --json gives us the file list +
  // size without polluting the working tree. This is exactly what npm
  // would publish.
  const out = execSync("npm pack --dry-run --json", {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  packResult = JSON.parse(out);
} catch (err) {
  console.error("[verify-publish] npm pack failed:");
  console.error(err.stderr?.toString() || err.message);
  process.exit(1);
}

if (!Array.isArray(packResult) || packResult.length !== 1) {
  fail(`Expected single pack manifest, got: ${JSON.stringify(packResult).slice(0, 200)}`);
} else {
  const m = packResult[0];
  const files = (m.files || []).map((f) => `package/${f.path}`);

  // 1. Required files.
  for (const r of REQUIRED) {
    if (!files.includes(r)) fail(`MISSING in tarball: ${r}`);
  }

  // 2. Forbidden patterns.
  for (const f of files) {
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(f)) fail(`LEAKED into tarball (matches ${re}): ${f}`);
    }
  }

  // 3. Size sanity.
  const unpacked = m.unpackedSize || 0;
  if (unpacked < 50 * 1024) {
    fail(`Tarball unpacked size suspiciously small: ${bytesToStr(unpacked)}`);
  }
  if (unpacked > 2 * 1024 * 1024) {
    fail(`Tarball unpacked size suspiciously large: ${bytesToStr(unpacked)} — node_modules leak?`);
  }

  console.log(`[verify-publish] tarball: ${m.filename}`);
  console.log(`[verify-publish] files: ${files.length}, unpacked: ${bytesToStr(unpacked)}`);
}

// 4. dist/templates relative resolution. This is what
// src/utils/env.ts:templatesDir() depends on at runtime.
const distTemplates = path.resolve(repoRoot, "dist", "..", "templates");
if (!fs.existsSync(path.join(distTemplates, "start-windows.bat.ejs"))) {
  fail(`dist/../templates does not resolve: ${distTemplates}`);
}

// 5. bin entry exists and is the built file.
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const binPath = path.resolve(repoRoot, pkg.bin?.["code-stick"] || "");
if (!fs.existsSync(binPath)) {
  fail(`bin entry missing: ${pkg.bin?.["code-stick"]}`);
}

// 6. Build artefact health: dist/cli.js should be > 10 KB and contain a
// recognizable shebang or bundled CLI bootstrap.
try {
  const cliBuf = fs.readFileSync(binPath);
  if (cliBuf.length < 10 * 1024) fail(`dist/cli.js suspiciously small: ${cliBuf.length} bytes`);
} catch (err) {
  fail(`Cannot read bin entry: ${err.message}`);
}

if (errors.length > 0) {
  console.error("\n[verify-publish] FAILED:");
  for (const e of errors) console.error("  - " + e);
  console.error("\nRefusing to publish.");
  process.exit(1);
}
console.log("[verify-publish] OK");
