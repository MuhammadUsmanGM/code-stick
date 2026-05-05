// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
// opencode (sst/opencode) standalone binaries. The releases publish per-target
// archives — we bundle all five so a USB installed from any host can launch on
// any target machine. The downloader gates each file on its sha256.

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
    sha256: "8cb328f72da3a11410bc13e765d1630e028d71f821d93bf8c72387dc2ae5c8ee",
  },
  "darwin-arm64": {
    url: `${BASE}/opencode-darwin-arm64.zip`,
    filename: "opencode-darwin-arm64.zip",
    type: "zip",
    sha256: "33c3ffab030deac8cfe7146da417c5ff1dc524518a3febe9c940f2c5fe27dedb",
  },
  "darwin-x64": {
    url: `${BASE}/opencode-darwin-x64.zip`,
    filename: "opencode-darwin-x64.zip",
    type: "zip",
    sha256: "c8c75e7e7e0222e105c13baa80c7c2a6e3fe74c31ef408dbefbedcf9d40b18db",
  },
  "linux-x64": {
    url: `${BASE}/opencode-linux-x64.zip`,
    filename: "opencode-linux-x64.zip",
    type: "zip",
    sha256: "1968fcc667b7dabd0c9b215af020cd13e12a056b8ec258074948377161d09ac2",
  },
  "linux-arm64": {
    url: `${BASE}/opencode-linux-arm64.zip`,
    filename: "opencode-linux-arm64.zip",
    type: "zip",
    sha256: "9d0229704cf889afa89ba9a58053e811bafb5c4d32edc76f396a03754c12e08b",
  },
};

/** Relative path of the opencode binary INSIDE the extracted archive. */
export function opencodeBinaryRel(target: Target): string {
  return target === "windows-x64" ? "opencode.exe" : "opencode";
}
