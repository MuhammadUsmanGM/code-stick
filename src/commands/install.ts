// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { log } from "../utils/logger.js";
import { promptWithEsc } from "../utils/prompt.js";
import { pickInstallDrive, assertDriveReady, checkDiskSpace } from "../core/usb.js";
import { usbPaths } from "../utils/paths.js";
import { ALL_TARGETS, type Target } from "../catalog/targets.js";
import { OLLAMA, ollamaBinaryRel } from "../catalog/ollama.js";
import { OPENCODE, opencodeBinaryRel } from "../catalog/opencode.js";
import { MODELS, findModel, type CodingModel } from "../catalog/models.js";
import { download } from "../core/downloader.js";
import { extractZipFile, extractTarFile } from "../core/extract.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { saveManifest, type Manifest } from "../state/manifest.js";
import { preflightFilesystem, warnIfLosesExecBit } from "../core/preflight.js";
import { postInstallCleanup } from "../core/cleanup.js";
import { setupShutdownHooks, stopAll } from "../core/process-manager.js";
import { stripQuarantineIfMac } from "../core/macos.js";
import { pullModelTag } from "../core/model-pull.js";
import { writeOpencodeConfig } from "../core/opencode-config.js";

interface InstallOptions {
  target?: string;
  model?: string;
  yes?: boolean;
}

const OLLAMA_VERSION = "v0.21.2";
const OPENCODE_VERSION = "v0.4.18";

const BINARY_FOOTPRINT_GB = 1.5;

export async function installCommand(opts: InstallOptions): Promise<void> {
  setupShutdownHooks();
  log.banner("Installer");

  const drivePath = await pickInstallDrive(opts.target);
  if (!drivePath) { log.info("Cancelled."); return; }
  assertDriveReady(drivePath);

  const model = await pickModel(opts.model);
  if (!model) { log.info("Cancelled."); return; }

  const fsInfo = preflightFilesystem(drivePath, model);

  const requiredGB = Math.ceil(model.sizeGB + BINARY_FOOTPRINT_GB + 1);
  const ok = await checkDiskSpace(drivePath, requiredGB);
  if (!ok) {
    throw new Error(
      `Not enough free space on ${drivePath}. Need ~${requiredGB} GB for model + binaries.`
    );
  }

  const p = usbPaths(drivePath);
  const tempDir = path.join(drivePath, ".code-stick-tmp");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(p.data, { recursive: true });
  fs.mkdirSync(p.config, { recursive: true });

  const totalSteps = 5;
  log.blank();
  log.step(1, totalSteps, `Downloading Ollama for ${ALL_TARGETS.length} target(s)...`);
  for (const t of ALL_TARGETS) await fetchAndExtractOllama(t, p.engine(t), tempDir);

  log.step(2, totalSteps, `Downloading opencode for ${ALL_TARGETS.length} target(s)...`);
  for (const t of ALL_TARGETS) await fetchAndExtractOpencode(t, p.opencode(t), tempDir);

  stripQuarantineIfMac(path.join(drivePath, "engine"), path.join(drivePath, "opencode"));

  log.step(3, totalSteps, `Pulling model ${model.tag} into USB store...`);
  try {
    await pullModelTag(drivePath, model.tag);
  } finally {
    await stopAll().catch(() => undefined);
  }

  const now = new Date().toISOString();
  const manifest: Manifest = {
    version: "2",
    installedAt: now,
    models: [{ id: model.id, tag: model.tag, addedAt: now }],
    defaultModelId: model.id,
    targets: [...ALL_TARGETS],
    ollamaVersion: OLLAMA_VERSION,
    opencodeVersion: OPENCODE_VERSION,
  };

  log.step(4, totalSteps, "Writing opencode config + launchers...");
  writeOpencodeConfig(drivePath, manifest);
  renderLaunchers(drivePath, { modelTag: model.tag });

  log.step(5, totalSteps, "Writing manifest + cleanup...");
  saveManifest(drivePath, manifest);
  postInstallCleanup(drivePath, tempDir);

  log.blank();
  log.success(`Installed code-stick on ${drivePath}`);
  warnIfLosesExecBit(fsInfo);
  log.info("Launch from the USB:");
  log.dim(`  Windows:  start-windows.bat`);
  log.dim(`  macOS:    start-mac.command`);
  log.dim(`  Linux:    ./start-linux.sh`);
  log.dim("Or run: code-stick start");
  log.dim("Add another model later: code-stick add-model");
}

async function pickModel(modelId: string | undefined): Promise<CodingModel | null> {
  if (modelId) {
    const m = findModel(modelId);
    if (!m) {
      const ids = MODELS.map((x) => x.id).join(", ");
      throw new Error(`Unknown --model "${modelId}". Available: ${ids}`);
    }
    log.info(`Selected model: ${m.name}`);
    return m;
  }
  const choices = MODELS.map((m) => ({
    name: `${m.name} — ${m.size}  ${m.bestFor}`,
    value: m.id,
  }));
  const ans = await promptWithEsc<{ id: string }>([
    {
      type: "list",
      name: "id",
      message: "Pick a coding model (you can add more later with `code-stick add-model`):",
      choices,
      default: MODELS[0].id,
    },
  ]);
  if (!ans) return null;
  return findModel(ans.id) || null;
}

async function fetchAndExtractOllama(target: Target, destDir: string, tempDir: string): Promise<void> {
  const art = OLLAMA[target];
  fs.mkdirSync(destDir, { recursive: true });
  const archivePath = path.join(tempDir, art.filename);
  await download({
    url: art.url,
    mirrors: art.mirrors,
    dest: archivePath,
    expectedHash: art.sha256,
    label: `ollama ${target}`,
  });
  if (art.type === "zip") await extractZipFile(archivePath, destDir);
  else await extractTarFile(archivePath, destDir);
  ensureExecutable(path.join(destDir, ollamaBinaryRel(target)));
}

async function fetchAndExtractOpencode(target: Target, destDir: string, tempDir: string): Promise<void> {
  const art = OPENCODE[target];
  fs.mkdirSync(destDir, { recursive: true });
  const archivePath = path.join(tempDir, art.filename);
  await download({
    url: art.url,
    mirrors: art.mirrors,
    dest: archivePath,
    expectedHash: art.sha256,
    label: `opencode ${target}`,
  });
  if (art.type === "zip") await extractZipFile(archivePath, destDir);
  else await extractTarFile(archivePath, destDir);
  ensureExecutable(path.join(destDir, opencodeBinaryRel(target)));
}

function ensureExecutable(binPath: string): void {
  if (!fs.existsSync(binPath)) return;
  if (process.platform === "win32") return;
  try { fs.chmodSync(binPath, 0o755); }
  catch { /* FAT/exFAT — chmod is a no-op there. Launchers handle perm errors. */ }
}
