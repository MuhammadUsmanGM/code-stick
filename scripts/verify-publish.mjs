#!/usr/bin/env node
// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
// Pre-publish guard. Asserts the package tarball will contain everything the
// runtime expects, and that the dist→templates relative path used by
// src/utils/env.ts:templatesDir() actually resolves in the published layout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "dist/cli.js",
  "templates/start-windows.bat.ejs",
  "templates/start-mac.command.ejs",
  "templates/start-linux.sh.ejs",
  "scripts/compute-hashes.mjs",
];

let failed = false;
for (const rel of required) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    console.error(`[verify-publish] Missing: ${rel}`);
    failed = true;
  }
}

// In the published package, src/utils/env.ts:templatesDir() resolves the
// templates directory by walking up from the running script. The first
// candidate is `<dist>/../templates`. Verify that walk from dist/ lands on
// the actual templates dir.
const distTemplates = path.resolve(repoRoot, "dist", "..", "templates");
if (!fs.existsSync(path.join(distTemplates, "start-windows.bat.ejs"))) {
  console.error(`[verify-publish] dist/../templates does not resolve: ${distTemplates}`);
  failed = true;
}

// Confirm bin entry exists and is the built file.
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const binPath = path.resolve(repoRoot, pkg.bin?.["code-stick"] || "");
if (!fs.existsSync(binPath)) {
  console.error(`[verify-publish] bin entry missing: ${pkg.bin?.["code-stick"]}`);
  failed = true;
}

if (failed) {
  console.error("[verify-publish] FAILED — refusing to publish.");
  process.exit(1);
}
console.log("[verify-publish] OK");
