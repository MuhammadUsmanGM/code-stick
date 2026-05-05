// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve the templates directory in dev (src/) and production (dist/). */
export function templatesDir(): string {
  const candidates = [
    path.join(__dirname, "..", "templates"),
    path.join(__dirname, "templates"),
    path.join(__dirname, "..", "..", "templates"),
  ];
  for (const dir of candidates) if (fs.existsSync(dir)) return dir;
  throw new Error("Templates directory not found");
}

/** Hash verification can be temporarily disabled while the catalog is being
 *  populated. Off by default — release builds always require sha256. */
export function allowUnverifiedDownloads(): boolean {
  return process.env.CODE_STICK_ALLOW_UNVERIFIED === "1";
}
