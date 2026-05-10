// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b9r3-tst1
import { describe, it, expect } from "vitest";
import os from "node:os";
import { buildBugReport } from "../src/utils/bug-report.js";

describe("buildBugReport", () => {
  it("redacts the user's home directory", () => {
    const home = os.homedir();
    if (!home || home.length < 3) return; // CI runners with no $HOME — skip
    const err = new Error(`Boom at ${home}/projects/secret-thing/file.ts`);
    const r = buildBugReport({ command: "install", err });
    expect(r.body).not.toContain(home);
    expect(r.body).toContain("$HOME");
  });

  it("redacts known token shapes", () => {
    const err = new Error("token=npm_AbCdEf0123456789AbCdEf0123 leaked into log");
    const r = buildBugReport({ command: "install", err });
    expect(r.body).not.toMatch(/npm_AbCdEf0123456789AbCdEf0123/);
    expect(r.body).toContain("$REDACTED_NPM_TOKEN");
  });

  it("redacts the USB drive path when supplied", () => {
    const err = new Error("Failed to write to E:\\code-stick\\data\\blob.bin");
    const r = buildBugReport({ command: "install", err, drivePath: "E:\\code-stick" });
    expect(r.body).toContain("$USB");
    expect(r.body).not.toMatch(/E:\\code-stick\\data/);
  });

  it("includes the redacted error message and a stack section", () => {
    const err = new Error("plain failure");
    const r = buildBugReport({ command: "doctor", err });
    expect(r.body).toContain("plain failure");
    expect(r.body).toMatch(/#### Stack/);
    expect(r.body).toMatch(/#### Environment/);
  });

  it("never throws even for a non-Error input", () => {
    expect(() => buildBugReport({ command: "x", err: "weird non-error" })).not.toThrow();
    const r = buildBugReport({ command: "x", err: "weird non-error" });
    expect(r.body).toContain("weird non-error");
  });
});
