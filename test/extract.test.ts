// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureBinaryAt } from "../src/core/extract.js";

/**
 * shallowSearch is internal but exercised through ensureBinaryAt: when the
 * expected file is missing, ensureBinaryAt walks the tree and relocates the
 * best candidate. We use that to validate the scoring rules (exec bit beats
 * non-exec; .app/ bundles are penalized; small files are dropped).
 */
describe("ensureBinaryAt scoring", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-extract-"));
  });

  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("relocates a candidate when expected path is empty", () => {
    const nestedDir = path.join(root, "ollama-bundle", "bin");
    fs.mkdirSync(nestedDir, { recursive: true });
    const candidate = path.join(nestedDir, "ollama");
    // 32 KB so it survives the <16KB drop threshold.
    fs.writeFileSync(candidate, Buffer.alloc(32 * 1024, 1));
    if (process.platform !== "win32") fs.chmodSync(candidate, 0o755);

    ensureBinaryAt(root, "ollama", "ollama");
    expect(fs.existsSync(path.join(root, "ollama"))).toBe(true);
  });

  it("prefers a real binary over a tiny stub of the same name", () => {
    // Stub: 1 KB, named "ollama" but useless.
    const stubDir = path.join(root, "stubs");
    fs.mkdirSync(stubDir, { recursive: true });
    fs.writeFileSync(path.join(stubDir, "ollama"), Buffer.alloc(1024));

    // Real: 200 KB, exec bit, in a bin/ dir.
    const binDir = path.join(root, "extracted", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const realPath = path.join(binDir, "ollama");
    fs.writeFileSync(realPath, Buffer.alloc(200 * 1024, 7));
    if (process.platform !== "win32") fs.chmodSync(realPath, 0o755);

    ensureBinaryAt(root, "ollama", "ollama");
    const placed = fs.statSync(path.join(root, "ollama"));
    expect(placed.size).toBe(200 * 1024);
  });

  it("penalizes .app/ bundles so the headless CLI wins on macOS-like layouts", () => {
    // GUI bundle inside .app — the trap we want to avoid.
    const appPath = path.join(root, "Ollama.app", "Contents", "MacOS", "Ollama");
    fs.mkdirSync(path.dirname(appPath), { recursive: true });
    fs.writeFileSync(appPath, Buffer.alloc(40 * 1024, 9));
    if (process.platform !== "win32") fs.chmodSync(appPath, 0o755);

    // Headless CLI elsewhere.
    const cliDir = path.join(root, "Ollama.app", "Contents", "Resources");
    fs.mkdirSync(cliDir, { recursive: true });
    const cliPath = path.join(cliDir, "ollama");
    fs.writeFileSync(cliPath, Buffer.alloc(40 * 1024, 1));
    if (process.platform !== "win32") fs.chmodSync(cliPath, 0o755);

    // Also place the headless CLI at a non-.app path — that should win the
    // scoring tie because both candidates inside .app are penalized -5.
    const altDir = path.join(root, "headless");
    fs.mkdirSync(altDir, { recursive: true });
    const altPath = path.join(altDir, "ollama");
    fs.writeFileSync(altPath, Buffer.alloc(40 * 1024, 2));
    if (process.platform !== "win32") fs.chmodSync(altPath, 0o755);

    ensureBinaryAt(root, "ollama", "ollama");
    const placed = fs.statSync(path.join(root, "ollama"));
    // 0xff payload would be 1; we used 2 for the headless one outside .app.
    const buf = fs.readFileSync(path.join(root, "ollama"));
    expect(buf[0]).toBe(2);
    expect(placed.size).toBe(40 * 1024);
  });

  it("throws when no candidate exists", () => {
    expect(() => ensureBinaryAt(root, "ollama", "ollama")).toThrow(/expected binary is missing/);
  });

  it("is a no-op when the expected file already exists", () => {
    fs.writeFileSync(path.join(root, "ollama"), Buffer.alloc(32 * 1024, 0));
    expect(() => ensureBinaryAt(root, "ollama", "ollama")).not.toThrow();
  });
});
