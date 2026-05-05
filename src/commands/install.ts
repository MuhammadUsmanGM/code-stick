// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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
import { hostTarget } from "../utils/platform.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { saveManifest, type Manifest } from "../state/manifest.js";
import { preflightFilesystem } from "../core/preflight.js";
import { postInstallCleanup } from "../core/cleanup.js";
import { checkPortFree, waitForOllama, stopAll, setupShutdownHooks } from "../core/process-manager.js";

interface InstallOptions {
  target?: string;
  model?: string;
  yes?: boolean;
}

const OLLAMA_VERSION = "v0.21.2";
const OPENCODE_VERSION = "v0.4.18";

/** Total size estimate (binaries only) for free-space check, in GB. */
const BINARY_FOOTPRINT_GB = 1.5;

export async function installCommand(opts: InstallOptions): Promise<void> {
  setupShutdownHooks();
  log.banner("Installer");

  const drivePath = await pickInstallDrive(opts.target);
  if (!drivePath) { log.info("Cancelled."); return; }
  assertDriveReady(drivePath);

  const model = await pickModel(opts.model, opts.yes);
  if (!model) { log.info("Cancelled."); return; }

  preflightFilesystem(drivePath, model);

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

  log.step(3, totalSteps, `Pulling model ${model.tag} into USB store...`);
  await pullModel(drivePath, model);

  log.step(4, totalSteps, "Writing opencode config + launchers...");
  writeOpencodeConfig(drivePath, model);
  renderLaunchers(drivePath, { modelTag: model.tag });

  log.step(5, totalSteps, "Writing manifest + cleanup...");
  const manifest: Manifest = {
    version: "1",
    installedAt: new Date().toISOString(),
    model: { id: model.id, tag: model.tag },
    targets: [...ALL_TARGETS],
    ollamaVersion: OLLAMA_VERSION,
    opencodeVersion: OPENCODE_VERSION,
  };
  saveManifest(drivePath, manifest);
  postInstallCleanup(drivePath, tempDir);

  log.blank();
  log.success(`Installed code-stick on ${drivePath}`);
  log.info("Launch from the USB:");
  log.dim(`  Windows:  start-windows.bat`);
  log.dim(`  macOS:    start-mac.command`);
  log.dim(`  Linux:    ./start-linux.sh`);
  log.dim("Or run: code-stick start");
}

async function pickModel(modelId: string | undefined, _yes?: boolean): Promise<CodingModel | null> {
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
      message: "Pick a coding model (one per stick):",
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

/**
 * Spawn a temp Ollama server pointed at the USB store and run `ollama pull`
 * against it. We use the host-target binary because the pull only needs to
 * produce blobs in <root>/data — those blobs are OS-agnostic.
 */
async function pullModel(drivePath: string, model: CodingModel): Promise<void> {
  await checkPortFree();

  const target = hostTarget();
  const p = usbPaths(drivePath);
  const ollamaBin = path.join(p.engine(target), ollamaBinaryRel(target));

  if (!fs.existsSync(ollamaBin)) {
    throw new Error(`Ollama binary missing for host target ${target}: ${ollamaBin}`);
  }

  const env = {
    ...process.env,
    OLLAMA_MODELS: p.data,
    OLLAMA_HOST: "127.0.0.1:11434",
  };

  log.dim("Starting temporary Ollama server...");
  const server = spawn(ollamaBin, ["serve"], {
    env, stdio: "ignore", windowsHide: true, detached: false,
  });

  let serverExited = false;
  server.on("exit", () => { serverExited = true; });

  try {
    const ready = await waitForOllama(45_000);
    if (!ready) throw new Error("Temporary Ollama server failed to come up.");
    if (serverExited) throw new Error("Ollama server exited before pull could start.");

    log.info(`Running ollama pull ${model.tag} (this can take a while)...`);
    await runOllamaPull(ollamaBin, env, model.tag);
    log.success(`Model ${model.tag} stored on USB`);
  } finally {
    log.dim("Stopping temporary Ollama server...");
    try { server.kill(); } catch { /* ignore */ }
    await stopAll().catch(() => undefined);
  }
}

function runOllamaPull(bin: string, env: NodeJS.ProcessEnv, tag: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["pull", tag], {
      env, stdio: "inherit", windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ollama pull exited with code ${code}`));
    });
  });
}

/**
 * opencode reads $XDG_CONFIG_HOME/opencode/opencode.json on POSIX and
 * %APPDATA%\opencode\opencode.json on Windows. The launchers redirect both
 * env vars at <USB>/config, so we provision the file at config/opencode/.
 */
function writeOpencodeConfig(drivePath: string, model: CodingModel): void {
  const p = usbPaths(drivePath);
  const dir = path.join(p.config, "opencode");
  fs.mkdirSync(dir, { recursive: true });

  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      ollama: {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama (code-stick)",
        options: { baseURL: "http://127.0.0.1:11434/v1" },
        models: { [model.tag]: { name: model.name } },
      },
    },
    model: `ollama/${model.tag}`,
  };

  fs.writeFileSync(
    path.join(dir, "opencode.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}
