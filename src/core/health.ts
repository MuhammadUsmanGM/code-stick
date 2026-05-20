// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";

export interface InstallHealth {
  hasModelData: boolean;
  hasManifest: boolean;
  hasBlobs: boolean;
}

export interface OllamaDataSize {
  totalBytes: number;
  manifestsBytes: number;
  blobsBytes: number;
}

export function inspectOllamaData(dataDir: string): InstallHealth {
  const manifests = path.join(dataDir, "manifests");
  const blobs = path.join(dataDir, "blobs");
  const hasManifest = hasAnyFile(manifests);
  const hasBlobs = hasAnyFile(blobs);
  return { hasModelData: hasManifest && hasBlobs, hasManifest, hasBlobs };
}

export async function inspectOllamaDataSizes(dataDir: string): Promise<OllamaDataSize> {
  const manifests = path.join(dataDir, "manifests");
  const blobs = path.join(dataDir, "blobs");
  const [manifestsBytes, blobsBytes] = await Promise.all([
    directorySizeBytes(manifests),
    directorySizeBytes(blobs),
  ]);
  return { manifestsBytes, blobsBytes, totalBytes: manifestsBytes + blobsBytes };
}

export async function directorySizeBytes(root: string): Promise<number> {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      total += await directorySizeBytes(full);
    } else if (entry.isFile()) {
      try {
        total += (await fs.promises.stat(full)).size;
      } catch {
        // ignore unreadable file
      }
    }
  }
  return total;
}

function hasAnyFile(root: string): boolean {
  if (!fs.existsSync(root)) return false;
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) return true;
    }
  }
  return false;
}

/**
 * Resolve the ollama manifest path for a given tag (e.g. "qwen2.5-coder:7b").
 * Ollama stores library models under
 *   <data>/manifests/registry.ollama.ai/library/<model>/<tag>
 * and namespaced models under
 *   <data>/manifests/registry.ollama.ai/<namespace>/<model>/<tag>.
 */
export function ollamaTagManifestPath(dataDir: string, tag: string): string {
  const [name, version = "latest"] = tag.split(":");
  const slashes = name.split("/");
  const namespace = slashes.length > 1 ? slashes[0] : "library";
  const model = slashes.length > 1 ? slashes.slice(1).join("/") : name;
  return path.join(
    dataDir, "manifests", "registry.ollama.ai", namespace, model, version,
  );
}

/**
 * True when ollama has the manifest for `tag` on disk. Doesn't validate the
 * referenced blobs — `inspectOllamaData` already covers global blob presence,
 * and a manifest-without-blobs is exotic enough that we'd rather fail at pull
 * time with ollama's own error than reimplement its blob walker here.
 */
export function hasOllamaTagManifest(dataDir: string, tag: string): boolean {
  try {
    const p = ollamaTagManifestPath(dataDir, tag);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
