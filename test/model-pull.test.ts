// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { describe, it, expect } from "vitest";
import { isPartialBlobName } from "../src/core/model-pull.js";

describe("isPartialBlobName", () => {
  it("matches the legacy dash-form Ollama partial blobs", () => {
    expect(isPartialBlobName("sha256-abc123-partial")).toBe(true);
    expect(isPartialBlobName("sha256-abc123-partial-2")).toBe(true);
  });

  it("matches the newer dot-form Ollama partial blobs", () => {
    expect(isPartialBlobName("sha256-abc123.partial")).toBe(true);
    expect(isPartialBlobName("sha256-abc123.partial-3")).toBe(true);
    expect(isPartialBlobName("sha256-abc123.partial.5")).toBe(true);
  });

  it("does not match clean blob names", () => {
    expect(isPartialBlobName("sha256-abc123")).toBe(false);
    expect(isPartialBlobName("sha256-abc123def")).toBe(false);
  });

  it("does not match arbitrary names with 'partial' in the middle", () => {
    expect(isPartialBlobName("not-a-partial-thing")).toBe(false);
    expect(isPartialBlobName("partial.blob")).toBe(false);
  });
});
