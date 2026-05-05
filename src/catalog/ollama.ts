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

const OLLAMA_VERSION = "v0.21.2";
const BASE = `https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}`;

export const OLLAMA: Record<Target, OllamaArtifact> = {
  "windows-x64": {
    url: `${BASE}/ollama-windows-amd64.zip`,
    filename: "ollama-windows-amd64.zip",
    type: "zip",
    sha256: "624caabca19a27168dd2b165ac538a0c6f2c6bcc94098439944fa351ff7b11e2",
  },
  "darwin-arm64": {
    // Ollama's darwin release is a universal binary inside a single zip.
    url: `${BASE}/ollama-darwin.zip`,
    filename: "ollama-darwin.zip",
    type: "zip",
    sha256: "52c8856bf6c46beef9664ebab22b327afd6224a418744afa594b70a11587ec15",
  },
  "darwin-x64": {
    url: `${BASE}/ollama-darwin.zip`,
    filename: "ollama-darwin.zip",
    type: "zip",
    sha256: "52c8856bf6c46beef9664ebab22b327afd6224a418744afa594b70a11587ec15",
  },
  "linux-x64": {
    url: `${BASE}/ollama-linux-amd64.tgz`,
    filename: "ollama-linux-amd64.tgz",
    type: "tgz",
    // PENDING: populate with sha256 of the linux-amd64 tgz before publish.
    sha256: "PENDING-linux-amd64",
  },
  "linux-arm64": {
    url: `${BASE}/ollama-linux-arm64.tgz`,
    filename: "ollama-linux-arm64.tgz",
    type: "tgz",
    // PENDING: populate with sha256 of the linux-arm64 tgz before publish.
    sha256: "PENDING-linux-arm64",
  },
};

/** Path of the ollama executable INSIDE the extracted archive (relative). */
export function ollamaBinaryRel(target: Target): string {
  if (target === "windows-x64") return "ollama.exe";
  if (target === "linux-x64" || target === "linux-arm64") return "bin/ollama";
  return "ollama";
}
