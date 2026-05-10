// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect, afterEach } from "vitest";
import { unescapeMount, looksLikeSystemPath, freeGBFromStats } from "../src/core/usb.js";

describe("unescapeMount", () => {
  it("decodes octal escapes used by /proc/mounts", () => {
    expect(unescapeMount("/mnt/some\\040dir")).toBe("/mnt/some dir");
    expect(unescapeMount("/mnt/tab\\011here")).toBe("/mnt/tab\there");
    expect(unescapeMount("/mnt/back\\134slash")).toBe("/mnt/back\\slash");
  });

  it("leaves un-escaped paths untouched", () => {
    expect(unescapeMount("/media/usb")).toBe("/media/usb");
    expect(unescapeMount("/")).toBe("/");
  });
});

describe("looksLikeSystemPath", () => {
  const origPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform });
  });

  // On Windows hosts node:path resolves "/" to "C:\" regardless of the
  // process.platform mock, so the POSIX branch under test never sees a
  // POSIX-shaped argument. Skip the POSIX cases on win32 — the Linux/Mac
  // CI runners cover them.
  const itPosix = process.platform === "win32" ? it.skip : it;

  itPosix("rejects POSIX root", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(looksLikeSystemPath("/")).toMatch(/filesystem root/);
  });

  itPosix("rejects POSIX system dirs", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(looksLikeSystemPath("/usr/local/bin")).toMatch(/system directory/);
    expect(looksLikeSystemPath("/etc")).toMatch(/system directory/);
    expect(looksLikeSystemPath("/var/log/x")).toMatch(/system directory/);
  });

  itPosix("allows ordinary paths", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(looksLikeSystemPath("/home/user/usb")).toBeNull();
    expect(looksLikeSystemPath("/media/usb")).toBeNull();
  });
});

describe("freeGBFromStats", () => {
  it("computes free GB from statfs-shaped input", () => {
    // 4 GiB free, 4 KiB block size
    const stats = { bsize: 4096, bfree: 1_048_576 } as unknown as Parameters<typeof freeGBFromStats>[0];
    const out = freeGBFromStats(stats);
    expect(out).toBeCloseTo(4.294967296, 3);
  });

  it("returns null on non-positive block size", () => {
    const stats = { bsize: 0, bfree: 100 } as unknown as Parameters<typeof freeGBFromStats>[0];
    expect(freeGBFromStats(stats)).toBeNull();
  });
});
