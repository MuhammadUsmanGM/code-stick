// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  archiveDedupeKey,
  buildArchiveWorkUnits,
  bindArchiveDestDirs,
  removeArchiveFile,
  ARCHIVE_DOWNLOAD_CONCURRENCY,
} from "../src/core/archive-staging.js";
import { opencodeArtifactsFor, OPENCODE_VERSION } from "../src/catalog/opencode.js";

vi.mock("../src/core/downloader.js", () => ({
  download: vi.fn(async (opts: { dest: string }) => {
    fs.writeFileSync(opts.dest, Buffer.from("fake-archive"));
  }),
}));

vi.mock("../src/core/extract.js", () => ({
  extractZipFile: vi.fn(async (_zip: string, dest: string) => {
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "ollama.exe"), Buffer.alloc(64 * 1024, 1));
    fs.writeFileSync(path.join(dest, "opencode.exe"), Buffer.alloc(64 * 1024, 1));
  }),
  extractTarFile: vi.fn(async (_tgz: string, dest: string) => {
    fs.mkdirSync(path.join(dest, "bin"), { recursive: true });
    fs.writeFileSync(path.join(dest, "bin", "ollama"), Buffer.alloc(64 * 1024, 1));
    fs.writeFileSync(path.join(dest, "opencode"), Buffer.alloc(64 * 1024, 1));
  }),
  ensureBinaryAt: vi.fn((root: string, rel: string) => {
    const target = path.join(root, rel);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.alloc(64 * 1024, 1));
    }
  }),
  chmodExecRecursive: vi.fn(),
}));

describe("archiveDedupeKey", () => {
  it("normalizes case for dedupe", () => {
    expect(archiveDedupeKey("Ollama-Darwin.tgz")).toBe(archiveDedupeKey("ollama-darwin.tgz"));
  });
});

describe("buildArchiveWorkUnits", () => {
  it("merges darwin-arm64 and darwin-x64 into one ollama-darwin unit", () => {
    const arts = opencodeArtifactsFor(OPENCODE_VERSION);
    const units = buildArchiveWorkUnits(
      ["darwin-arm64", "darwin-x64"],
      [],
      arts,
    );
    const darwin = units.filter((u) => u.archive.filename === "ollama-darwin.tgz");
    expect(darwin).toHaveLength(1);
    expect(darwin[0]!.extractions).toHaveLength(2);
    expect(darwin[0]!.extractions.map((e) => e.target).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
    ]);
  });

  it("keeps distinct windows archives separate", () => {
    const arts = opencodeArtifactsFor(OPENCODE_VERSION);
    const units = buildArchiveWorkUnits(
      ["windows-x64", "windows-arm64"],
      [],
      arts,
    );
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.archive.filename).sort()).toEqual([
      "ollama-windows-amd64.zip",
      "ollama-windows-arm64.zip",
    ]);
  });
});

describe("runArchiveStagingPipeline", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-archive-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("deletes each archive after extract", async () => {
    const { download } = await import("../src/core/downloader.js");
    const { runArchiveStagingPipeline } = await import("../src/core/archive-staging.js");
    const arts = opencodeArtifactsFor(OPENCODE_VERSION);
    const units = buildArchiveWorkUnits(["windows-arm64"], ["windows-arm64"], arts);
    const engine = path.join(tempDir, "engine.new");
    const opencode = path.join(tempDir, "opencode.new");
    bindArchiveDestDirs(units, engine, opencode, ["windows-arm64"], ["windows-arm64"]);

    await runArchiveStagingPipeline(tempDir, units, 1);

    expect(download).toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, "ollama-windows-arm64.zip"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "opencode-windows-arm64.zip"))).toBe(false);
    expect(fs.existsSync(path.join(engine, "windows-arm64", "ollama.exe"))).toBe(true);
  });

  it("downloads shared darwin archive only once", async () => {
    const { download } = await import("../src/core/downloader.js");
    const { runArchiveStagingPipeline } = await import("../src/core/archive-staging.js");
    const arts = opencodeArtifactsFor(OPENCODE_VERSION);
    const units = buildArchiveWorkUnits(["darwin-arm64", "darwin-x64"], [], arts);
    const engine = path.join(tempDir, "engine.new");
    bindArchiveDestDirs(units, engine, path.join(tempDir, "op.new"), ["darwin-arm64", "darwin-x64"], []);

    await runArchiveStagingPipeline(tempDir, units, ARCHIVE_DOWNLOAD_CONCURRENCY);

    const darwinDownloads = (download as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => String(c[0]?.dest).includes("ollama-darwin.tgz"),
    );
    expect(darwinDownloads).toHaveLength(1);
    expect(fs.existsSync(path.join(tempDir, "ollama-darwin.tgz"))).toBe(false);
  });
});

describe("removeArchiveFile", () => {
  it("removes an existing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-rm-archive-"));
    try {
      const f = path.join(dir, "x.zip");
      fs.writeFileSync(f, "x");
      removeArchiveFile(f);
      expect(fs.existsSync(f)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
