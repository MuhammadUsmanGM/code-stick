// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, expect, it } from "vitest";
import {
  ALL_TARGETS,
  familiesPresent,
  isFullPortability,
  osFamilyOf,
  parseTargetsFlag,
  resolveHostTarget,
  targetsForFamily,
} from "../src/catalog/targets.js";

describe("parseTargetsFlag", () => {
  it("defaults to ALL_TARGETS when input is undefined", () => {
    expect(parseTargetsFlag(undefined)).toEqual(ALL_TARGETS);
  });

  it("defaults to ALL_TARGETS on empty string", () => {
    expect(parseTargetsFlag("")).toEqual(ALL_TARGETS);
  });

  it("returns ALL_TARGETS for 'all'", () => {
    expect(parseTargetsFlag("all")).toEqual(ALL_TARGETS);
  });

  it("returns ALL_TARGETS for 'ALL' (case-insensitive)", () => {
    expect(parseTargetsFlag("ALL")).toEqual(ALL_TARGETS);
  });

  it("expands family tokens to all members of that family", () => {
    expect(parseTargetsFlag("mac")).toEqual(["darwin-arm64", "darwin-x64"]);
    expect(parseTargetsFlag("linux")).toEqual(["linux-x64", "linux-arm64"]);
    expect(parseTargetsFlag("windows")).toEqual(["windows-x64", "windows-arm64"]);
  });

  it("accepts explicit Target IDs (CSV)", () => {
    expect(parseTargetsFlag("windows-x64,linux-arm64")).toEqual([
      "windows-x64",
      "linux-arm64",
    ]);
  });

  it("dedupes mixed family + explicit", () => {
    // 'mac' expands to both darwin entries; adding darwin-arm64 again is a no-op.
    expect(parseTargetsFlag("mac,darwin-arm64")).toEqual([
      "darwin-arm64",
      "darwin-x64",
    ]);
  });

  it("preserves ALL_TARGETS order in output regardless of input order", () => {
    expect(parseTargetsFlag("linux-arm64,windows-x64,darwin-x64")).toEqual([
      "windows-x64",
      "darwin-x64",
      "linux-arm64",
    ]);
  });

  it("tolerates whitespace around tokens", () => {
    expect(parseTargetsFlag(" windows , linux-x64 ")).toEqual([
      "windows-x64",
      "windows-arm64",
      "linux-x64",
    ]);
  });

  it("throws an actionable error on unknown tokens", () => {
    expect(() => parseTargetsFlag("freebsd")).toThrowError(/Unknown --targets/);
    expect(() => parseTargetsFlag("windows-x64,bogus")).toThrowError(/bogus/);
  });
});

describe("resolveHostTarget", () => {
  it("returns a value that is one of ALL_TARGETS for the test runner host", () => {
    // We can't pin a specific value without knowing the CI/host, but any
    // supported host must land in the catalog.
    const t = resolveHostTarget();
    expect(ALL_TARGETS).toContain(t);
  });

  it("is consumed by parseTargetsFlag('host')", () => {
    expect(parseTargetsFlag("host")).toEqual([resolveHostTarget()]);
  });
});

describe("windows-arm64 target wiring", () => {
  it("treats windows-arm64 as part of the 'windows' family", () => {
    expect(osFamilyOf("windows-arm64")).toBe("windows");
  });

  it("expands 'windows' family to both x64 and arm64", () => {
    expect(targetsForFamily("windows")).toEqual(["windows-x64", "windows-arm64"]);
  });

  it("parses windows-arm64 as a standalone explicit target", () => {
    expect(parseTargetsFlag("windows-arm64")).toEqual(["windows-arm64"]);
  });

  it("includes windows-arm64 in ALL_TARGETS", () => {
    expect(ALL_TARGETS).toContain("windows-arm64");
    expect(ALL_TARGETS.length).toBe(6);
  });
});

describe("isFullPortability", () => {
  it("is true for ALL_TARGETS", () => {
    expect(isFullPortability(ALL_TARGETS)).toBe(true);
  });

  it("is true for ALL_TARGETS in any order", () => {
    expect(isFullPortability([...ALL_TARGETS].reverse())).toBe(true);
  });

  it("is false for a strict subset", () => {
    expect(isFullPortability(["windows-x64"])).toBe(false);
    expect(isFullPortability(["darwin-arm64", "darwin-x64"])).toBe(false);
  });

  it("is false when length matches but contents differ", () => {
    // Constructed pathological case: 6 entries with one dup, missing one target.
    const bad = ["windows-x64", "windows-x64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as never;
    expect(isFullPortability(bad)).toBe(false);
  });
});

describe("familiesPresent", () => {
  it("returns just windows for windows-only subset", () => {
    expect(familiesPresent(["windows-x64"])).toEqual(["windows"]);
  });

  it("returns mac+linux when both darwin and linux targets are present", () => {
    expect(familiesPresent(["darwin-arm64", "linux-x64"])).toEqual(["mac", "linux"]);
  });

  it("returns all three families for ALL_TARGETS", () => {
    expect(familiesPresent(ALL_TARGETS)).toEqual(["windows", "mac", "linux"]);
  });
});

describe("osFamilyOf + targetsForFamily round-trip", () => {
  it("every Target's family contains that Target", () => {
    for (const t of ALL_TARGETS) {
      const fam = osFamilyOf(t);
      expect(targetsForFamily(fam)).toContain(t);
    }
  });
});
