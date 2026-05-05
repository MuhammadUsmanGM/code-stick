// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
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

const OPENCODE_VERSION = "v0.4.18";
const BASE = `https://github.com/sst/opencode/releases/download/${OPENCODE_VERSION}`;

// Filenames follow sst/opencode's release-asset naming convention. They are
// expected to exist for every published version; the install command's hard-
// failure path will tell the user to re-run with a different version pinned
// if a particular asset has been removed upstream.
export const OPENCODE: Record<Target, OpencodeArtifact> = {
  "windows-x64": {
    url: `${BASE}/opencode-windows-x64.zip`,
    filename: "opencode-windows-x64.zip",
    type: "zip",
    sha256: "PENDING-opencode-windows-x64",
  },
  "darwin-arm64": {
    url: `${BASE}/opencode-darwin-arm64.zip`,
    filename: "opencode-darwin-arm64.zip",
    type: "zip",
    sha256: "PENDING-opencode-darwin-arm64",
  },
  "darwin-x64": {
    url: `${BASE}/opencode-darwin-x64.zip`,
    filename: "opencode-darwin-x64.zip",
    type: "zip",
    sha256: "PENDING-opencode-darwin-x64",
  },
  "linux-x64": {
    url: `${BASE}/opencode-linux-x64.zip`,
    filename: "opencode-linux-x64.zip",
    type: "zip",
    sha256: "PENDING-opencode-linux-x64",
  },
  "linux-arm64": {
    url: `${BASE}/opencode-linux-arm64.zip`,
    filename: "opencode-linux-arm64.zip",
    type: "zip",
    sha256: "PENDING-opencode-linux-arm64",
  },
};

/** Relative path of the opencode binary INSIDE the extracted archive. */
export function opencodeBinaryRel(target: Target): string {
  return target === "windows-x64" ? "opencode.exe" : "opencode";
}
