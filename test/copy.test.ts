// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect } from "vitest";
import { estimateFastHostTempGB } from "../src/core/copy.js";

describe("estimateFastHostTempGB", () => {
  it("adds binary headroom for full portable fast install", () => {
    expect(estimateFastHostTempGB(4.7, true)).toBeGreaterThanOrEqual(14);
    expect(estimateFastHostTempGB(4.7, false)).toBeLessThan(estimateFastHostTempGB(4.7, true));
  });

  it("scales with model size", () => {
    expect(estimateFastHostTempGB(20, true)).toBeGreaterThan(estimateFastHostTempGB(4.7, true));
  });
});
