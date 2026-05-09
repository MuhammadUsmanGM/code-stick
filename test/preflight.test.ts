// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect, afterEach } from "vitest";
import { winPathPreflight } from "../src/core/preflight.js";

describe("winPathPreflight", () => {
  const origPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform });
  });

  it("is a no-op on non-win32", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(() => winPathPreflight("/whatever/very/long/path/that/does/not/matter")).not.toThrow();
  });

  it("does not throw when mount path is short on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    // 8 chars — well below the 100-char cutoff (260 - 160 budget = 100).
    expect(() => winPathPreflight("E:\\")).not.toThrow();
  });

  it("throws with remediation when mount path is dangerously deep on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
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
