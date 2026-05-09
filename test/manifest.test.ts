// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseLegacyOllamaVersion,
  loadManifest,
  saveManifest,
  defaultModel,
  type Manifest,
} from "../src/state/manifest.js";

describe("parseLegacyOllamaVersion", () => {
  it("returns empty pair for non-strings / empty", () => {
    expect(parseLegacyOllamaVersion(null)).toEqual({ host: "", linux: "" });
    expect(parseLegacyOllamaVersion(undefined)).toEqual({ host: "", linux: "" });
    expect(parseLegacyOllamaVersion("")).toEqual({ host: "", linux: "" });
    expect(parseLegacyOllamaVersion(123)).toEqual({ host: "", linux: "" });
  });

  it("splits the structured 'v0.21.2 (linux=v0.13.0)' form", () => {
    expect(parseLegacyOllamaVersion("v0.21.2 (linux=v0.13.0)")).toEqual({
      host: "v0.21.2", linux: "v0.13.0",
    });
  });

  it("falls back to mirroring a bare semver into both fields", () => {
    expect(parseLegacyOllamaVersion("v0.18.4")).toEqual({ host: "v0.18.4", linux: "v0.18.4" });
  });

  it("trims whitespace", () => {
    expect(parseLegacyOllamaVersion("   v0.21.2   ")).toEqual({ host: "v0.21.2", linux: "v0.21.2" });
  });
});

describe("manifest round-trip", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-manifest-"));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("saves and reloads a v2 manifest verbatim", () => {
    const m: Manifest = {
      version: "2",
      installedAt: "2026-01-01T00:00:00.000Z",
      models: [{ id: "qwen25-coder-7b", tag: "qwen2.5-coder:7b", addedAt: "2026-01-01T00:00:00.000Z" }],
      defaultModelId: "qwen25-coder-7b",
      targets: ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64", "windows-x64"],
      ollamaVersions: { host: "v0.21.2", linux: "v0.13.0" },
      opencodeVersion: "v0.4.18",
    };
    saveManifest(tmpDir, m);
    const reloaded = loadManifest(tmpDir);
    expect(reloaded).toEqual(m);
  });

  it("migrates a legacy v1 manifest with structured ollamaVersion string", () => {
    fs.writeFileSync(path.join(tmpDir, "code-stick.json"), JSON.stringify({
      version: "1",
      installedAt: "2025-12-01T00:00:00.000Z",
      model: { id: "phi3-mini", tag: "phi3:mini" },
      targets: ["linux-x64"],
      ollamaVersion: "v0.21.2 (linux=v0.13.0)",
      opencodeVersion: "v0.4.18",
    }));
    const out = loadManifest(tmpDir);
    expect(out?.version).toBe("2");
    expect(out?.models).toEqual([
      { id: "phi3-mini", tag: "phi3:mini", addedAt: "2025-12-01T00:00:00.000Z" },
    ]);
    expect(out?.defaultModelId).toBe("phi3-mini");
    expect(out?.ollamaVersions).toEqual({ host: "v0.21.2", linux: "v0.13.0" });
  });

  it("returns null for a missing manifest file", () => {
    expect(loadManifest(tmpDir)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "code-stick.json"), "{ broken");
    expect(loadManifest(tmpDir)).toBeNull();
  });

  it("returns null for an unknown schema version", () => {
    fs.writeFileSync(path.join(tmpDir, "code-stick.json"), JSON.stringify({ version: "99" }));
    expect(loadManifest(tmpDir)).toBeNull();
  });
});

describe("defaultModel", () => {
  it("returns the model whose id matches defaultModelId", () => {
    const m: Manifest = {
      version: "2",
      installedAt: "2026-01-01T00:00:00.000Z",
      models: [
        { id: "phi3-mini", tag: "phi3:mini", addedAt: "x" },
        { id: "qwen25-coder-7b", tag: "qwen2.5-coder:7b", addedAt: "x" },
      ],
      defaultModelId: "qwen25-coder-7b",
      targets: ["linux-x64"],
      ollamaVersions: { host: "v0.21.2", linux: "v0.13.0" },
      opencodeVersion: "v0.4.18",
    };
    expect(defaultModel(m)?.id).toBe("qwen25-coder-7b");
  });

  it("falls back to first model when defaultModelId is stale", () => {
    const m: Manifest = {
      version: "2",
      installedAt: "2026-01-01T00:00:00.000Z",
      models: [{ id: "phi3-mini", tag: "phi3:mini", addedAt: "x" }],
      defaultModelId: "removed-model",
      targets: ["linux-x64"],
      ollamaVersions: { host: "v0.21.2", linux: "v0.13.0" },
      opencodeVersion: "v0.4.18",
    };
    expect(defaultModel(m)?.id).toBe("phi3-mini");
  });

  it("returns null when no models are installed", () => {
    const m: Manifest = {
      version: "2",
      installedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      defaultModelId: "anything",
      targets: ["linux-x64"],
      ollamaVersions: { host: "v0.21.2", linux: "v0.13.0" },
      opencodeVersion: "v0.4.18",
    };
    expect(defaultModel(m)).toBeNull();
  });
});
