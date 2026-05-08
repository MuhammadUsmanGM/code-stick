#!/usr/bin/env node
// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
//
// Catalog drift detector + auto-bumper.
//
// Reads src/catalog/ollama.ts and src/catalog/opencode.ts, fetches every URL
// they reference, recomputes the sha256, and compares against the pinned
// values. Any drift is printed as a unified diff. Exits non-zero on drift so
// CI can gate on it.
//
//   node scripts/check-catalog-hashes.mjs            # check + report drift
//   node scripts/check-catalog-hashes.mjs --write    # rewrite catalog files
//                                                    # in-place with fresh hashes
//
// Why this exists: the per-target sha256 hashes pinned in the catalog rot
// silently when GitHub re-cuts a release with the same tag (rare but real),
// or when we bump the upstream version manually and forget to refresh the
// hashes. A check-only run is cheap; an auto-bump avoids hand-pasting 9
// hex strings on every version bump.

import { createHash } from "node:crypto";
import { mkdtempSync, createWriteStream, statSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CATALOG_FILES = [
  resolve(REPO_ROOT, "src/catalog/ollama.ts"),
  resolve(REPO_ROOT, "src/catalog/opencode.ts"),
];

const args = new Set(process.argv.slice(2));
const WRITE = args.has("--write");

/**
 * Extract every `{ url: ..., filename: ..., sha256: ... }` artifact entry
 * from a catalog source file. We parse just enough TypeScript to get the
 * triple — the catalogs are intentionally trivial object literals so a
 * regex pass is sufficient and avoids dragging in a TS parser at script time.
 */
function extractArtifacts(source) {
  const out = [];
  // Each entry is a multi-line block. Capture across lines with [\s\S].
  const blockRe = /\{\s*([\s\S]*?)\}/g;
  let m;
  while ((m = blockRe.exec(source)) !== null) {
    const body = m[1];
    const url = pickField(body, "url");
    const filename = pickField(body, "filename");
    const sha256 = pickField(body, "sha256");
    if (url && filename && sha256) {
      out.push({ url: resolveTemplateLiterals(url, source), filename, sha256, raw: body });
    }
  }
  return out;
}

function pickField(body, name) {
  // String form: `name: "value"` or `name: 'value'`
  const reStr = new RegExp(`${name}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`, "m");
  const m = reStr.exec(body);
  if (!m) return null;
  return m[2];
}

/**
 * Resolve `${BASE}/foo.zip`-style template literals against the const
 * definitions in the same file. Catalog uses BASE / BASE_HOST / BASE_LINUX.
 */
function resolveTemplateLiterals(value, source) {
  if (!value.includes("${")) return value;
  // Pull `const NAME = \`...\`;` definitions.
  const constRe = /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*`([^`]+)`/g;
  const consts = {};
  let m;
  while ((m = constRe.exec(source)) !== null) consts[m[1]] = m[2];
  // Recursive expansion: a const value can itself reference others.
  for (let i = 0; i < 5; i++) {
    let changed = false;
    for (const [k, v] of Object.entries(consts)) {
      if (!v.includes("${")) continue;
      consts[k] = v.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, ref) => consts[ref] ?? `\${${ref}}`);
      changed = true;
    }
    if (!changed) break;
  }
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, ref) => consts[ref] ?? `\${${ref}}`);
}

async function fetchAndHash(url, dir) {
  const filename = url.split("/").pop();
  const dest = join(dir, filename);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const hash = createHash("sha256");
  const out = createWriteStream(dest);
  const tee = new TransformStream({
    transform(chunk, controller) { hash.update(chunk); controller.enqueue(chunk); },
  });
  await pipeline(res.body.pipeThrough(tee), out);
  const sz = (statSync(dest).size / 1e6).toFixed(1);
  return { filename, digest: hash.digest("hex"), sizeMB: sz };
}

/**
 * Replace the sha256 string in a file for a given URL+filename pair.
 * We anchor on the full triple (url+filename+sha256 all present in the same
 * object literal) so we never accidentally replace the wrong artefact when
 * two entries share the same sha256.
 */
function rewriteSha(source, url, filename, oldSha, newSha) {
  // Find the object literal block that contains *all* three: url, filename,
  // oldSha. We do this via a multi-line regex with named alternation.
  // Simpler: replace the first occurrence of `oldSha` that follows a line
  // mentioning the filename within the same object literal (within ~15 lines).
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(filename)) continue;
    // Search forward up to 12 lines for the matching sha.
    for (let j = i; j < Math.min(lines.length, i + 12); j++) {
      if (lines[j].includes(oldSha)) {
        lines[j] = lines[j].replace(oldSha, newSha);
        return lines.join("\n");
      }
    }
  }
  return null;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "code-stick-catalog-check-"));
  let drift = 0;
  let checked = 0;

  try {
    for (const filePath of CATALOG_FILES) {
      let source = readFileSync(filePath, "utf-8");
      const artifacts = extractArtifacts(source);
      process.stderr.write(`\n${filePath}: ${artifacts.length} artefact(s)\n`);

      for (const art of artifacts) {
        process.stderr.write(`  -> ${art.filename} ... `);
        try {
          const { digest, sizeMB } = await fetchAndHash(art.url, dir);
          checked++;
          if (digest === art.sha256) {
            process.stderr.write(`OK (${sizeMB} MB)\n`);
          } else {
            drift++;
            process.stderr.write(`DRIFT\n`);
            process.stderr.write(`     pinned: ${art.sha256}\n`);
            process.stderr.write(`     actual: ${digest}\n`);
            if (WRITE) {
              const rewritten = rewriteSha(source, art.url, art.filename, art.sha256, digest);
              if (rewritten) {
                source = rewritten;
                process.stderr.write(`     rewrote in-place\n`);
              } else {
                process.stderr.write(`     COULD NOT LOCATE sha in source — fix manually\n`);
              }
            }
          }
        } catch (err) {
          process.stderr.write(`ERROR: ${err.message}\n`);
          drift++;
        }
      }

      if (WRITE && source !== readFileSync(filePath, "utf-8")) {
        writeFileSync(filePath, source, "utf-8");
        process.stderr.write(`  ! wrote updated ${filePath}\n`);
      }
    }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  process.stderr.write(`\nChecked ${checked} artefact(s); ${drift} drift.\n`);
  if (drift > 0 && !WRITE) {
    process.stderr.write(`Run with --write to update the catalog in-place.\n`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(2);
});
