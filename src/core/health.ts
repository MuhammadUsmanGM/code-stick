// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";

export interface InstallHealth {
  hasModelData: boolean;
  hasManifest: boolean;
  hasBlobs: boolean;
}

export function inspectOllamaData(dataDir: string): InstallHealth {
  const manifests = path.join(dataDir, "manifests");
  const blobs = path.join(dataDir, "blobs");
  const hasManifest = hasAnyFile(manifests);
  const hasBlobs = hasAnyFile(blobs);
  return { hasModelData: hasManifest && hasBlobs, hasManifest, hasBlobs };
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
