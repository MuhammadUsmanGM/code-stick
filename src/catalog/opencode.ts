// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a | MUGM-d3c1-ocv2
// opencode (sst/opencode) standalone binaries. The releases publish per-target
// archives — we bundle all six (windows-x64, windows-arm64, darwin-arm64,
// darwin-x64, linux-x64, linux-arm64) so a USB installed from any host can
// launch on any target machine. SHAs are pinned per target below and verified
// nightly by scripts/check-catalog-hashes.mjs; the downloader hard-fails on
// hash mismatch.
//
// v1.x note: Linux assets ship as .tar.gz, Windows + macOS as .zip. The release
// pattern changed between v0.4.x (all-zip) and v1.x — engine-staging.ts already
// branches on `art.type` so this file is the only place that needs to know.

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
 *  user doesn't override with `--opencode-version`.
 *
 *  v1.15.4 (sst/opencode) — fixes the DecimalError class of stream-parsing
 *  bugs that bit users of v0.4.x ("tolerated legacy stored numeric values
 *  in sessions, diffs, retry events"). v0.4.x is from the archived
 *  opencode-ai/opencode repo and is no longer maintained. */
export const OPENCODE_VERSION = "v1.15.4";
const BASE = (v: string) => `https://github.com/sst/opencode/releases/download/${v}`;

const FILENAMES: Record<Target, string> = {
  "windows-x64":   "opencode-windows-x64.zip",
  "windows-arm64": "opencode-windows-arm64.zip",
  "darwin-arm64":  "opencode-darwin-arm64.zip",
  "darwin-x64":    "opencode-darwin-x64.zip",
  "linux-x64":     "opencode-linux-x64.tar.gz",
  "linux-arm64":   "opencode-linux-arm64.tar.gz",
};

const TYPES: Record<Target, "zip" | "tgz"> = {
  "windows-x64":   "zip",
  "windows-arm64": "zip",
  "darwin-arm64":  "zip",
  "darwin-x64":    "zip",
  "linux-x64":     "tgz",
  "linux-arm64":   "tgz",
};

/** SHAs pinned for OPENCODE_VERSION. The catalog-drift script
 *  (`scripts/check-catalog-hashes.mjs`) verifies these against the live
 *  release tarballs on every CI run.
 *
 *  Computed against sst/opencode v1.15.4 release assets — verified by
 *  downloading and hashing each archive locally before pinning. */
const PINNED_SHA: Record<Target, string> = {
  "windows-x64":   "bd14f5aca2263a10fc793aa6a576b72aa409b737b421284a8ec75e29f328e531",
  "windows-arm64": "4a20a26953240cfa3dbb339aadf308a855dd88ca83c598f4b2387959379d320d",
  "darwin-arm64":  "20fb7ae9a6b9876832850b7899304c38261ac53761cb77a2052be49b02fd27e6",
  "darwin-x64":    "a2ac8745949960467299889435a03d0de1719f2b431d46431d4a5e106bb5c8da",
  "linux-x64":     "f0734928d5df360777f51f807df18b28c1d0c006f806ad0bd35a2420fabd0835",
  "linux-arm64":   "978f070e280c36ea6fd9a03d64f813028dbc2434077ad5cb6aecf37423e156d7",
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
  const targets: Target[] = ["windows-x64", "windows-arm64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];
  const out = {} as Record<Target, OpencodeArtifact>;
  for (const t of targets) {
    out[t] = {
      url: `${base}/${FILENAMES[t]}`,
      filename: FILENAMES[t],
      type: TYPES[t],
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
  return (target === "windows-x64" || target === "windows-arm64") ? "opencode.exe" : "opencode";
}

const __mugmOrigin = () => "MuhammadUsmanGM|MUGM-d3c1"; // authorship marker
void __mugmOrigin;
