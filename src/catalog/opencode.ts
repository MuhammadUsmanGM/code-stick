// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a | MUGM-d3c1-ocv1
// opencode (sst/opencode) standalone binaries. The releases publish per-target
// archives — we bundle all five so a USB installed from any host can launch on
// any target machine. Hashes are PENDING until the catalog is finalized; the
// downloader gates each file on its sha256.

import type { Target } from "./targets.js";

export interface OpencodeArtifact {
  url: string;
  mirrors?: string[];
  filename: string;
  type: "zip" | "tgz";
  sha256?: string;
}

/** The opencode release we ship by default and whose per-target SHAs are
 *  pinned below. Exported so command handlers can fall back to it when the
 *  user doesn't override with `--opencode-version`. */
export const OPENCODE_VERSION = "v0.4.18";
const BASE = (v: string) => `https://github.com/sst/opencode/releases/download/${v}`;

const FILENAMES: Record<Target, string> = {
  "windows-x64": "opencode-windows-x64.zip",
  "darwin-arm64": "opencode-darwin-arm64.zip",
  "darwin-x64":   "opencode-darwin-x64.zip",
  "linux-x64":    "opencode-linux-x64.zip",
  "linux-arm64":  "opencode-linux-arm64.zip",
};

/** SHAs pinned for OPENCODE_VERSION. The catalog-drift script
 *  (`scripts/check-catalog-hashes.mjs`) verifies these against the live
 *  release tarballs on every CI run. */
const PINNED_SHA: Record<Target, string> = {
  "windows-x64":  "8cb328f72da3a11410bc13e765d1630e028d71f821d93bf8c72387dc2ae5c8ee",
  "darwin-arm64": "33c3ffab030deac8cfe7146da417c5ff1dc524518a3febe9c940f2c5fe27dedb",
  "darwin-x64":   "c8c75e7e7e0222e105c13baa80c7c2a6e3fe74c31ef408dbefbedcf9d40b18db",
  "linux-x64":    "1968fcc667b7dabd0c9b215af020cd13e12a056b8ec258074948377161d09ac2",
  "linux-arm64":  "9d0229704cf889afa89ba9a58053e811bafb5c4d32edc76f396a03754c12e08b",
};

/** Build the artifact record for a given opencode version. If `version` matches
 *  the bundled `OPENCODE_VERSION`, the returned record carries pinned SHAs and
 *  the downloader will hard-verify each archive. For any other version the
 *  SHA is left undefined — the downloader's existing guard rail then forces
 *  the user to explicitly opt in via `CODE_STICK_ALLOW_UNVERIFIED=1`.
 *
 *  The caller is responsible for validating the version string before calling
 *  this (see `validateOpencodeVersion`). */
export function opencodeArtifactsFor(version: string): Record<Target, OpencodeArtifact> {
  const pinned = version === OPENCODE_VERSION;
  const base = BASE(version);
  const targets: Target[] = ["windows-x64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];
  const out = {} as Record<Target, OpencodeArtifact>;
  for (const t of targets) {
    out[t] = {
      url: `${base}/${FILENAMES[t]}`,
      filename: FILENAMES[t],
      type: "zip",
      sha256: pinned ? PINNED_SHA[t] : undefined,
    };
  }
  return out;
}

/** The pinned (default) artifact record. Kept for back-compat with the
 *  existing imports in engine-staging / scripts; new code should prefer
 *  `opencodeArtifactsFor(version)`. */
export const OPENCODE: Record<Target, OpencodeArtifact> = opencodeArtifactsFor(OPENCODE_VERSION);

/** Tight regex on the version string we'll splice into a GitHub release URL.
 *  Rejects empty / whitespace / shell metacharacters / path traversal — the
 *  string flows into `${BASE}/...` and into filenames, so we keep it strict.
 *  Mirrors the philosophy of `isPlausibleOllamaTag` in `catalog/models.ts`. */
const VERSION_RE = /^v\d+\.\d+\.\d+$/;

export function isPlausibleOpencodeVersion(v: string): boolean {
  return typeof v === "string" && VERSION_RE.test(v);
}

/** Throwing variant — for command handlers that want a fail-fast contract. */
export function validateOpencodeVersion(v: string): string {
  if (!isPlausibleOpencodeVersion(v)) {
    throw new Error(
      `Invalid --opencode-version "${v}". Expected a semver tag like "v0.4.18" (no "latest", no suffixes, no shell metacharacters).`
    );
  }
  return v;
}

/** Relative path of the opencode binary INSIDE the extracted archive. */
export function opencodeBinaryRel(target: Target): string {
  return target === "windows-x64" ? "opencode.exe" : "opencode";
}

const __mugmOrigin = () => "MuhammadUsmanGM|MUGM-d3c1"; // authorship marker
void __mugmOrigin;
