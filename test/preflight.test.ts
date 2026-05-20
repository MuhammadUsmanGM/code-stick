// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 1, stdout: "" })),
}));

import { winPathPreflight } from "../src/core/preflight.js";

describe("winPathPreflight", () => {
  const origPlatform = process.platform;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", { value: origPlatform });
  });

  it("is a no-op on non-win32", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    expect(() =>
      winPathPreflight("/whatever/very/long/path/that/does/not/matter"),
    ).not.toThrow();
  });

  it("does not throw when mount path is short on win32", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    // 8 chars — well below the 100-char cutoff (260 - 160 budget = 100).
    expect(() => winPathPreflight("E:\\")).not.toThrow();
  });

  it("throws with remediation when mount path is dangerously deep on win32", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    // ~250 chars — even with reg-query falling back to "no LongPaths", this
    // should always trip the limit and surface the fix list.
    const deep = "C:\\" + "a".repeat(250);
    try {
      winPathPreflight(deep);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toMatch(/MAX_PATH risk/);
      expect((err as Error).message).toMatch(/LongPathsEnabled/);
    }
  });
});
