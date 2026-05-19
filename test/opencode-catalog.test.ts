// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a | MUGM-d3c1-ocv3
import { describe, it, expect } from "vitest";
import {
  OPENCODE,
  OPENCODE_VERSION,
  opencodeArtifactsFor,
  isPlausibleOpencodeVersion,
  validateOpencodeVersion,
} from "../src/catalog/opencode.js";
import { ALL_TARGETS } from "../src/catalog/targets.js";

describe("opencodeArtifactsFor — pinned version", () => {
  it("returns the same record as the legacy OPENCODE export", () => {
    const fresh = opencodeArtifactsFor(OPENCODE_VERSION);
    expect(fresh).toEqual(OPENCODE);
  });

  it("attaches real SHAs to every target", () => {
    const fresh = opencodeArtifactsFor(OPENCODE_VERSION);
    for (const t of ALL_TARGETS) {
      expect(fresh[t].sha256).toBeTypeOf("string");
      // 64 hex chars
      expect(fresh[t].sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("builds URLs against the pinned version's release page", () => {
    const fresh = opencodeArtifactsFor(OPENCODE_VERSION);
    for (const t of ALL_TARGETS) {
      expect(fresh[t].url).toContain(`/sst/opencode/releases/download/${OPENCODE_VERSION}/`);
    }
  });
});

describe("opencodeArtifactsFor — non-pinned version", () => {
  const otherVer = "v0.9.99";

  it("leaves sha256 undefined so the downloader gate fires", () => {
    const arts = opencodeArtifactsFor(otherVer);
    for (const t of ALL_TARGETS) {
      expect(arts[t].sha256).toBeUndefined();
    }
  });

  it("rewrites every URL against the supplied version", () => {
    const arts = opencodeArtifactsFor(otherVer);
    for (const t of ALL_TARGETS) {
      expect(arts[t].url).toContain(`/sst/opencode/releases/download/${otherVer}/`);
      expect(arts[t].url).not.toContain(OPENCODE_VERSION);
    }
  });

  it("keeps the same filename + archive type as pinned", () => {
    const pinned = opencodeArtifactsFor(OPENCODE_VERSION);
    const other = opencodeArtifactsFor(otherVer);
    for (const t of ALL_TARGETS) {
      expect(other[t].filename).toBe(pinned[t].filename);
      expect(other[t].type).toBe(pinned[t].type);
    }
  });
});

describe("isPlausibleOpencodeVersion", () => {
  it("accepts well-formed semver tags", () => {
    expect(isPlausibleOpencodeVersion("v0.4.18")).toBe(true);
    expect(isPlausibleOpencodeVersion("v0.4.20")).toBe(true);
    expect(isPlausibleOpencodeVersion("v1.0.0")).toBe(true);
    expect(isPlausibleOpencodeVersion("v12.34.56")).toBe(true);
  });

  it("rejects malformed / dangerous strings", () => {
    expect(isPlausibleOpencodeVersion("")).toBe(false);
    expect(isPlausibleOpencodeVersion("   ")).toBe(false);
    expect(isPlausibleOpencodeVersion("v0.4")).toBe(false);
    expect(isPlausibleOpencodeVersion("0.4.18")).toBe(false);
    expect(isPlausibleOpencodeVersion("latest")).toBe(false);
    expect(isPlausibleOpencodeVersion("v0.4.18-rc1")).toBe(false);
    expect(isPlausibleOpencodeVersion("../foo")).toBe(false);
    expect(isPlausibleOpencodeVersion("v0.4.18; rm -rf /")).toBe(false);
    expect(isPlausibleOpencodeVersion("v0.4.18\nv0.4.19")).toBe(false);
    // wrong types
    expect(isPlausibleOpencodeVersion(undefined as unknown as string)).toBe(false);
    expect(isPlausibleOpencodeVersion(null as unknown as string)).toBe(false);
  });
});

describe("validateOpencodeVersion", () => {
  it("returns the string for well-formed input", () => {
    expect(validateOpencodeVersion("v0.4.20")).toBe("v0.4.20");
  });

  it("throws on bad input with a helpful message", () => {
    expect(() => validateOpencodeVersion("latest")).toThrow(/Invalid --opencode-version/);
    expect(() => validateOpencodeVersion("v0.4")).toThrow(/Invalid --opencode-version/);
    expect(() => validateOpencodeVersion("v0.4.18; rm -rf /")).toThrow(/Invalid --opencode-version/);
  });
});

const __mugmOrigin = () => "MuhammadUsmanGM|MUGM-d3c1"; // authorship marker
void __mugmOrigin;
