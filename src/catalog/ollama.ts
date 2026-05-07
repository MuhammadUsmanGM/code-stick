// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
// Ollama release binaries for every target the USB needs to support. We bundle
// all of them so a single stick boots on any host. Downloader gates each file
// on its sha256 — populate via scripts/compute-hashes.mjs before publish.

import type { Target } from "./targets.js";

export interface OllamaArtifact {
  url: string;
  mirrors?: string[];
  filename: string;
  /** Archive type. zip = Windows + macOS releases, tgz = Linux releases. */
  type: "zip" | "tgz";
  sha256?: string;
}

// Win/macOS: pinned to v0.21.2 (latest at audit time).
// Linux: pinned to v0.13.0 — the last release that ships .tgz tarballs. v0.14+
// dropped to .tar.zst only and our extractor doesn't speak zstd. Different
// versions per target is safe: Ollama's HTTP API is stable across minor
// releases, and each target only ever runs its own pinned binary.
const OLLAMA_VERSION_HOST = "v0.21.2";
const OLLAMA_VERSION_LINUX = "v0.13.0";
const BASE_HOST = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION_HOST}`;
const BASE_LINUX = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION_LINUX}`;

export const OLLAMA: Record<Target, OllamaArtifact> = {
  "windows-x64": {
    url: `${BASE_HOST}/ollama-windows-amd64.zip`,
    filename: "ollama-windows-amd64.zip",
    type: "zip",
    sha256: "624caabca19a27168dd2b165ac538a0c6f2c6bcc94098439944fa351ff7b11e2",
  },
  "darwin-arm64": {
    // CLI binary tarball (Ollama-darwin.zip is the GUI app).
    url: `${BASE_HOST}/ollama-darwin.tgz`,
    filename: "ollama-darwin.tgz",
    type: "tgz",
    sha256: "f14bb761dc3ef251a68081b4888920c187abe3ed53483db813ee8fb9c0a1af3e",
  },
  "darwin-x64": {
    url: `${BASE_HOST}/ollama-darwin.tgz`,
    filename: "ollama-darwin.tgz",
    type: "tgz",
    sha256: "f14bb761dc3ef251a68081b4888920c187abe3ed53483db813ee8fb9c0a1af3e",
  },
  "linux-x64": {
    url: `${BASE_LINUX}/ollama-linux-amd64.tgz`,
    filename: "ollama-linux-amd64.tgz",
    type: "tgz",
    sha256: "c5e5b4840008d9c9bf955ec32c32b03afc57c986ac1c382d44c89c9f7dd2cc30",
  },
  "linux-arm64": {
    url: `${BASE_LINUX}/ollama-linux-arm64.tgz`,
    filename: "ollama-linux-arm64.tgz",
    type: "tgz",
    sha256: "b1747f3f9aefead61a918b49372028faa68dd0b9f141b7f25b05afb327a3551d",
  },
};

/** Path of the ollama executable INSIDE the extracted archive (relative). */
export function ollamaBinaryRel(target: Target): string {
  if (target === "windows-x64") return "ollama.exe";
  if (target === "linux-x64" || target === "linux-arm64") return "bin/ollama";
  return "ollama";
}
