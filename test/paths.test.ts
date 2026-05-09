// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";
import { safeJoin, toLongPath, usbPaths } from "../src/utils/paths.js";

describe("safeJoin", () => {
  it("joins a simple child path", () => {
    const out = safeJoin("/tmp/parent", "child/file.txt");
    expect(out).toBe(path.resolve("/tmp/parent", "child/file.txt"));
  });

  it("rejects ../ traversal", () => {
    expect(() => safeJoin("/tmp/parent", "../escaped")).toThrow(/Refusing to write outside/);
  });

  it("rejects absolute child paths", () => {
    expect(() => safeJoin("/tmp/parent", "/etc/passwd")).toThrow(/Refusing to write outside/);
  });

  it("allows nested children", () => {
    const out = safeJoin("/tmp/parent", "a/b/c/d.txt");
    expect(out.endsWith(path.join("a", "b", "c", "d.txt"))).toBe(true);
  });
});

describe("toLongPath", () => {
  const origPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform });
    vi.restoreAllMocks();
  });

  it("is a no-op on non-win32", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(toLongPath("/tmp/x")).toBe("/tmp/x");
  });

  it("prefixes absolute Win paths with \\\\?\\", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(toLongPath("C:\\Users\\foo")).toBe("\\\\?\\C:\\Users\\foo");
  });

  it("normalizes forward slashes on Win", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(toLongPath("C:/Users/foo")).toBe("\\\\?\\C:\\Users\\foo");
  });

  it("leaves already-prefixed paths untouched", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(toLongPath("\\\\?\\C:\\x")).toBe("\\\\?\\C:\\x");
    expect(toLongPath("\\\\.\\PhysicalDrive0")).toBe("\\\\.\\PhysicalDrive0");
  });

  it("leaves relative paths untouched on Win", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(toLongPath("foo\\bar")).toBe("foo\\bar");
  });

  it("converts UNC paths into \\\\?\\UNC\\ form", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(toLongPath("\\\\server\\share\\file")).toBe("\\\\?\\UNC\\server\\share\\file");
  });

  it("returns empty string unchanged", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    expect(toLongPath("")).toBe("");
  });
});

describe("usbPaths", () => {
  it("derives canonical layout paths from a root", () => {
    const p = usbPaths("/mnt/usb");
    expect(p.manifest).toBe(path.join("/mnt/usb", "code-stick.json"));
    expect(p.data).toBe(path.join("/mnt/usb", "data"));
    expect(p.cache).toBe(path.join("/mnt/usb", "cache"));
    expect(p.state).toBe(path.join("/mnt/usb", "state"));
    expect(p.engine("linux-x64")).toBe(path.join("/mnt/usb", "engine", "linux-x64"));
    expect(p.opencode("darwin-arm64")).toBe(path.join("/mnt/usb", "opencode", "darwin-arm64"));
    expect(p.launcher("windows")).toBe(path.join("/mnt/usb", "start-windows.bat"));
    expect(p.launcher("mac")).toBe(path.join("/mnt/usb", "start-mac.command"));
    expect(p.launcher("linux")).toBe(path.join("/mnt/usb", "start-linux.sh"));
    expect(p.opencodeCache).toBe(path.join("/mnt/usb", "cache", "opencode"));
  });
});
