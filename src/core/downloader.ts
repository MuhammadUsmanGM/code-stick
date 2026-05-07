// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import got from "got";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { SingleBar, Presets } from "cli-progress";
import { hashFile } from "hasha";
import { log } from "../utils/logger.js";
import { allowUnverifiedDownloads } from "../utils/env.js";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

interface DownloadOptions {
  url: string;
  mirrors?: string[];
  dest: string;
  expectedHash?: string;
  label?: string;
}

export async function download(opts: DownloadOptions): Promise<void> {
  const { url, mirrors, dest, expectedHash, label } = opts;
  const partialPath = `${dest}.partial`;
  const displayName = label || dest;
  const candidates = Array.from(new Set([url, ...(mirrors || [])])).filter(Boolean);

  const hashLooksReal = !!expectedHash && !expectedHash.startsWith("PENDING");
  if (!hashLooksReal && !allowUnverifiedDownloads()) {
    throw new Error(
      `Missing/placeholder SHA256 for ${displayName}. ` +
      `Set CODE_STICK_ALLOW_UNVERIFIED=1 to bypass during catalog bootstrapping.`
    );
  }

  if (fs.existsSync(dest)) {
    if (hashLooksReal) {
      const hash = await hashFile(dest, { algorithm: "sha256" });
      if (hash === expectedHash) { log.dim(`${displayName} already downloaded, skipping`); return; }
      log.warn("Existing file hash mismatch — re-downloading");
      fs.unlinkSync(dest);
      safeUnlink(partialPath, "stale partial");
    } else {
      log.dim(`${displayName} already on disk; skipping (unverified mode)`);
      return;
    }
  }

  let lastErr: unknown;
  let succeeded = false;
  outer: for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (i > 0) {
      log.warn(`Trying mirror ${i + 1}/${candidates.length} for ${displayName}...`);
      safeUnlink(partialPath, "partial from previous mirror");
    }
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await attemptDownload(candidate, partialPath, label);
        succeeded = true; break outer;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (isENOSPC(err)) {
          throw new Error(`Out of disk space while downloading ${displayName}. Free space and resume.`);
        }
        if (isHardMirrorFailure(err)) {
          log.warn(`Mirror unreachable (${msg}) — switching mirror.`); continue outer;
        }
        if (attempt < MAX_RETRIES) {
          log.warn(`Download interrupted: ${msg}`);
          log.info(`  Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
  }

  if (!succeeded) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`Download failed for ${displayName}: ${msg}. Re-run to resume.`);
  }

  if (hashLooksReal) {
    log.dim("Verifying file integrity...");
    const hash = await hashFile(partialPath, { algorithm: "sha256" });
    if (hash !== expectedHash) {
      fs.unlinkSync(partialPath);
      throw new Error("Downloaded file hash mismatch — file deleted. Try again.");
    }
  }
  fs.renameSync(partialPath, dest);
}

async function attemptDownload(url: string, partialPath: string, label?: string): Promise<void> {
  let startByte = 0;
  if (fs.existsSync(partialPath)) {
    startByte = fs.statSync(partialPath).size;
    if (startByte > 0) log.dim(`Resuming from ${(startByte / 1e6).toFixed(1)} MB`);
  }
  const headers: Record<string, string> = {};
  if (startByte > 0) headers["Range"] = `bytes=${startByte}-`;

  const bar = new SingleBar(
    {
      format: `  {label} |{bar}| {percentage}% | {current}/{total} MB | {speed} MB/s | ETA: {eta_display}`,
      hideCursor: true,
    },
    Presets.shades_grey
  );

  const stream = got.stream(url, {
    headers, followRedirect: true, retry: { limit: 0 },
    timeout: { response: 15000, socket: 60000 },
  });

  let totalBytes = 0;
  let downloadedBytes = startByte;
  let barStarted = false;
  let lastTime = Date.now();
  let lastBytes = startByte;
  let writeMode: "a" | "w" = startByte > 0 ? "a" : "w";
  let rangeMismatch: Error | null = null;

  // CRITICAL: do NOT attach a `data` listener here. Got streams enter flowing
  // mode the moment a `data` listener is registered — any chunk consumed
  // before pipeline() wires the writable is dropped on the floor (manifests
  // as a short file → hash mismatch → infinite retry on fast LANs). Use
  // `downloadProgress` instead, which got computes without consuming chunks.
  stream.on("response", (response) => {
    const contentLength = parseInt(response.headers["content-length"] || "0", 10);
    if (response.statusCode === 206) {
      const contentRange = response.headers["content-range"];
      if (typeof contentRange === "string") {
        const m = /^bytes (\d+)-(\d+)\/(\d+|\*)/i.exec(contentRange);
        if (!m || parseInt(m[1], 10) !== startByte) {
          rangeMismatch = new Error(`Server returned mismatched Content-Range "${contentRange}"`);
          stream.destroy(rangeMismatch);
          return;
        }
        const total = m[3] === "*" ? null : parseInt(m[3], 10);
        totalBytes = total ?? (startByte + contentLength);
      } else { totalBytes = startByte + contentLength; }
    } else {
      // Server ignored the Range header → restart from byte 0. Truncate the
      // partial file by switching to write mode; pipeline() will overwrite.
      totalBytes = contentLength;
      if (startByte > 0) { startByte = 0; downloadedBytes = 0; lastBytes = 0; writeMode = "w"; }
    }
    const totalMB = Math.round(totalBytes / 1e6);
    bar.start(totalMB, Math.round(downloadedBytes / 1e6), {
      label: (label || "Downloading").padEnd(30),
      speed: "0.00", current: Math.round(downloadedBytes / 1e6), total: totalMB,
      eta_display: "calculating...",
    });
    barStarted = true;
  });

  // got emits downloadProgress with { transferred, total, percent } without
  // putting the readable into flowing mode, so we keep accurate progress
  // without competing with pipeline()'s consumption of the stream.
  stream.on("downloadProgress", (progress: { transferred: number; total?: number }) => {
    downloadedBytes = startByte + progress.transferred;
    const now = Date.now();
    const elapsed = (now - lastTime) / 1000;
    if (elapsed >= 0.5) {
      const speedVal = (downloadedBytes - lastBytes) / elapsed / 1e6;
      lastTime = now; lastBytes = downloadedBytes;
      let eta_display = "calculating...";
      if (speedVal > 0 && totalBytes > 0) {
        const r = Math.round((totalBytes - downloadedBytes) / (speedVal * 1e6));
        eta_display = r < 60 ? `${r}s` : r < 3600 ? `${Math.floor(r/60)}m ${r%60}s` : `${Math.floor(r/3600)}h ${Math.floor((r%3600)/60)}m`;
      }
      if (barStarted) bar.update(Math.round(downloadedBytes / 1e6), {
        speed: speedVal.toFixed(2), current: Math.round(downloadedBytes / 1e6), eta_display,
      });
    }
  });

  try {
    // Wait for headers so writeMode is correct before we open the file.
    await new Promise<void>((resolve, reject) => {
      stream.once("response", () => resolve());
      stream.once("error", reject);
    });
    if (rangeMismatch) throw rangeMismatch;
    const fileStream = createWriteStream(partialPath, { flags: writeMode });
    await pipeline(stream, fileStream);
  } catch (err) { if (barStarted) bar.stop(); throw err; }
  if (barStarted) bar.stop();
}

export function isHardMirrorFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { response?: { statusCode?: number }; code?: string };
  const status = e.response?.statusCode;
  if (status === 404 || status === 410 || status === 451) return true;
  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return true;
  if (e.code === "ENOTFOUND" || e.code === "ECONNREFUSED" || e.code === "EAI_AGAIN") return true;
  return false;
}

function isENOSPC(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOSPC") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ENOSPC|no space left/i.test(msg);
}

function safeUnlink(p: string, what: string): void {
  try { fs.unlinkSync(p); }
  catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    log.dim(`Could not remove ${what} (${p}): ${(err as Error).message}`);
  }
}
