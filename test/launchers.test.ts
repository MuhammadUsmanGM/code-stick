// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderLaunchers } from "../src/core/launcher-gen.js";

/**
 * Snapshot-test all three launcher templates rendered with a known model tag.
 * If a future template change is unintentional, the snapshot will fail and
 * surface the diff. To intentionally update: `npm test -- -u`.
 */
describe("renderLaunchers", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "code-stick-launcher-"));
  });

  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("emits all three launchers", () => {
    renderLaunchers(root, { modelTag: "qwen2.5-coder:7b" });
    expect(fs.existsSync(path.join(root, "start-windows.bat"))).toBe(true);
    expect(fs.existsSync(path.join(root, "start-mac.command"))).toBe(true);
    expect(fs.existsSync(path.join(root, "start-linux.sh"))).toBe(true);
  });

  it("matches the windows launcher snapshot", () => {
    renderLaunchers(root, { modelTag: "qwen2.5-coder:7b" });
    const out = fs.readFileSync(path.join(root, "start-windows.bat"), "utf-8");
    expect(out).toMatchSnapshot();
  });

  it("matches the mac launcher snapshot", () => {
    renderLaunchers(root, { modelTag: "qwen2.5-coder:7b" });
    const out = fs.readFileSync(path.join(root, "start-mac.command"), "utf-8");
    expect(out).toMatchSnapshot();
  });

  it("matches the linux launcher snapshot", () => {
    renderLaunchers(root, { modelTag: "qwen2.5-coder:7b" });
    const out = fs.readFileSync(path.join(root, "start-linux.sh"), "utf-8");
    expect(out).toMatchSnapshot();
  });

  it("interpolates the model tag verbatim into all three launchers", () => {
    renderLaunchers(root, { modelTag: "phi3:mini" });
    for (const name of ["start-windows.bat", "start-mac.command", "start-linux.sh"]) {
      const body = fs.readFileSync(path.join(root, name), "utf-8");
      expect(body).toContain("phi3:mini");
    }
  });

  it("emits only the windows launcher when only windows-x64 is staged", () => {
    renderLaunchers(root, { modelTag: "phi3:mini", targets: ["windows-x64"] });
    expect(fs.existsSync(path.join(root, "start-windows.bat"))).toBe(true);
    expect(fs.existsSync(path.join(root, "start-mac.command"))).toBe(false);
    expect(fs.existsSync(path.join(root, "start-linux.sh"))).toBe(false);
  });

  it("emits mac + linux launchers for a darwin+linux subset", () => {
    renderLaunchers(root, {
      modelTag: "phi3:mini",
      targets: ["darwin-arm64", "linux-x64"],
    });
    expect(fs.existsSync(path.join(root, "start-windows.bat"))).toBe(false);
    expect(fs.existsSync(path.join(root, "start-mac.command"))).toBe(true);
    expect(fs.existsSync(path.join(root, "start-linux.sh"))).toBe(true);
  });
});
