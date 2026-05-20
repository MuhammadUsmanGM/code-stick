// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-d3f2-4b7c
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { log } from "../utils/logger.js";
import { pickDrive, getFreeSpaceGB } from "../core/usb.js";
import { usbPaths } from "../utils/paths.js";
import { hostTarget } from "../utils/platform.js";
import { ALL_TARGETS } from "../catalog/targets.js";
import { ollamaBinaryRel } from "../catalog/ollama.js";
import { opencodeBinaryRel } from "../catalog/opencode.js";
import { loadManifest, defaultModel } from "../state/manifest.js";
import { hasOllamaTagManifest, inspectOllamaData } from "../core/health.js";
import { classifyFilesystem } from "../core/preflight.js";
import { isPortInUse, checkPortFree, registerProcess, killProcess, waitForOllama } from "../core/process-manager.js";

interface DoctorOptions {
  target?: string;
  /** Skip the live ollama spawn — useful in CI or on hosts without permission
   *  to bind 11434. Static checks still run. */
  noProbe?: boolean;
}

type Status = "pass" | "fail" | "warn";

interface CheckResult {
  status: Status;
  label: string;
  detail?: string;
  /** One concrete next step the user should take. Required on fail/warn. */
  remedy?: string;
}

const ICON: Record<Status, string> = {
  pass: chalk.green("✓"),
  fail: chalk.red("✗"),
  warn: chalk.yellow("⚠"),
};

/**
 * Live install audit. Where `status` reports what's recorded on disk, `doctor`
 * actively probes everything that could realistically fail at launch:
 *
 *   - filesystem type + free space
 *   - manifest schema sanity + default model resolves
 *   - all bundled target binaries present on the stick
 *   - host-target binary is executable and not the GUI .app
 *   - port 11434 is free (or, if not, who holds it)
 *   - briefly spawns ollama serve from the USB, hits /api/version
 *   - runs `opencode --version` and confirms it produces output
 *   - referenced model tags resolve to manifests + blob dirs
 *
 * Each failed/warned check carries a one-line remediation. The exit code is
 * 0 when every check passes, 2 otherwise — so `code-stick doctor &&` works in
 * scripts.
 */
export async function doctorCommand(opts: DoctorOptions): Promise<void> {
  log.banner("Doctor");

  const drivePath = await pickDrive(opts.target);
  log.info(`Drive: ${drivePath}`);
  log.blank();

  const checks: CheckResult[] = [];

  checks.push(checkFilesystem(drivePath));
  checks.push(checkFreeSpace(drivePath));

  const manifest = loadManifest(drivePath);
  checks.push(checkManifest(drivePath, manifest));

  if (manifest) {
    checks.push(checkDefaultModel(manifest));
    checks.push(checkOpencodeManifestVersion(manifest));
    checks.push(...checkBundledBinaries(drivePath, manifest));
    checks.push(checkHostBinary(drivePath, manifest));
    checks.push(...checkModelStore(drivePath, manifest));
  }

  checks.push(await checkPort());
  if (!opts.noProbe && manifest) {
    checks.push(await checkOllamaServe(drivePath, manifest));
  }
  if (manifest) {
    checks.push(await checkOpencodeVersion(drivePath));
  }

  log.blank();
  for (const c of checks) {
    const head = `  ${ICON[c.status]} ${c.label}`;
    console.log(c.detail ? `${head} — ${chalk.dim(c.detail)}` : head);
    if (c.status !== "pass" && c.remedy) {
      console.log(`      ${chalk.dim("→")} ${c.remedy}`);
    }
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  log.blank();
  if (failed === 0 && warned === 0) {
    log.success(`All ${checks.length} checks passed.`);
    return;
  }
  if (failed === 0) {
    log.warn(`${warned} warning(s), no failures. Stick is usable.`);
    return;
  }
  log.error(`${failed} failure(s), ${warned} warning(s). Fix the items above before launching.`);
  process.exitCode = 2;
}

// -- individual checks --------------------------------------------------------

function checkFilesystem(drivePath: string): CheckResult {
  const info = classifyFilesystem(drivePath);
  if (!info.raw) {
    return {
      status: "warn",
      label: "Filesystem",
      detail: "could not detect",
      remedy: "Confirm the USB is mounted. On Linux, try `lsblk -f`.",
    };
  }
  if (info.isFat32) {
    return {
      status: "warn",
      label: "Filesystem",
      detail: `${info.raw} (4 GB per-file limit; +x bit lost)`,
      remedy: "Reformat to exFAT or NTFS for full compatibility.",
    };
  }
  if (info.isExfat) {
    return {
      status: "warn",
      label: "Filesystem",
      detail: `${info.raw} (+x bit lost on Linux/macOS)`,
      remedy: "On Linux/macOS, launch via `bash start-linux.sh` or `bash start-mac.command`.",
    };
  }
  return { status: "pass", label: "Filesystem", detail: info.raw };
}

function checkFreeSpace(drivePath: string): CheckResult {
  const free = getFreeSpaceGB(drivePath);
  if (free === null) {
    return {
      status: "warn",
      label: "Free space",
      detail: "could not determine",
      remedy: "Check the drive is still mounted (`df -h` / `Get-PSDrive`).",
    };
  }
  if (free < 1) {
    return {
      status: "fail",
      label: "Free space",
      detail: `${free.toFixed(1)} GB`,
      remedy: "Delete unused files or models from the stick before launching.",
    };
  }
  return { status: "pass", label: "Free space", detail: `${free.toFixed(1)} GB` };
}

function checkManifest(drivePath: string, m: ReturnType<typeof loadManifest>): CheckResult {
  if (!m) {
    return {
      status: "fail",
      label: "Manifest",
      detail: "code-stick.json missing or corrupt",
      remedy: `Run: code-stick install --target "${drivePath}"`,
    };
  }
  return { status: "pass", label: "Manifest", detail: `${m.models.length} model(s), default=${m.defaultModelId || "(none)"}` };
}

function checkDefaultModel(m: NonNullable<ReturnType<typeof loadManifest>>): CheckResult {
  const def = defaultModel(m);
  if (!def) {
    return {
      status: "fail",
      label: "Default model",
      detail: "no models on stick",
      remedy: "Run: code-stick add-model --set-default <id>",
    };
  }
  if (def.id !== m.defaultModelId) {
    return {
      status: "warn",
      label: "Default model",
      detail: `${def.tag} (manifest pointed at "${m.defaultModelId}", which is not installed)`,
      remedy: `Run: code-stick add-model ${m.defaultModelId} --set-default  to restore.`,
    };
  }
  return { status: "pass", label: "Default model", detail: def.tag };
}

/**
 * Surface sticks that are still on the archived opencode-ai/opencode v0.4.x
 * line. That release had a stream-parsing DecimalError on Qwen and similar
 * models; v1.x (sst/opencode) fixed it. We can't tell from inside the binary
 * which version is bundled — the manifest is the source of truth.
 *
 * Warn (not fail): the stick still launches, the user just hits the bug on
 * whatever model triggers DecimalError. Steering them to upgrade-engine is
 * the right remedy. MUGM-d3c1-ocv2.
 */
function checkOpencodeManifestVersion(m: NonNullable<ReturnType<typeof loadManifest>>): CheckResult {
  const v = m.opencodeVersion || "";
  if (v.startsWith("v0.4") || v.startsWith("v0.3")) {
    return {
      status: "warn",
      label: "opencode version",
      detail: `${v} — known DecimalError on Qwen models`,
      remedy: "Run: code-stick upgrade-engine  to swap in v1.15.4 (fixes upstream parser bug).",
    };
  }
  if (!v) {
    return {
      status: "warn",
      label: "opencode version",
      detail: "not recorded in manifest",
      remedy: "Run: code-stick upgrade-engine  to refresh.",
    };
  }
  return { status: "pass", label: "opencode version", detail: v };
}

function checkBundledBinaries(
  drivePath: string,
  manifest: NonNullable<ReturnType<typeof loadManifest>>,
): CheckResult[] {
  const out: CheckResult[] = [];
  const p = usbPaths(drivePath);
  // Only check targets the manifest claims are staged. A `--targets host`
  // stick must not be flagged as failing for the five OS/arch combos it was
  // never asked to stage. Legacy manifests with no targets[] fall back to
  // ALL_TARGETS so older sticks still get a complete audit.
  const stagedTargets = manifest.targets.length > 0 ? manifest.targets : ALL_TARGETS;
  for (const t of stagedTargets) {
    const ollama = path.join(p.engine(t), ollamaBinaryRel(t));
    const opencode = path.join(p.opencode(t), opencodeBinaryRel(t));
    const missing: string[] = [];
    if (!fs.existsSync(ollama)) missing.push("ollama");
    if (!fs.existsSync(opencode)) missing.push("opencode");
    if (missing.length) {
      out.push({
        status: "fail",
        label: `Binaries [${t}]`,
        detail: `missing: ${missing.join(", ")}`,
        remedy: `Run: code-stick upgrade-engine --target "${drivePath}"`,
      });
    } else {
      out.push({ status: "pass", label: `Binaries [${t}]`, detail: "ollama + opencode present" });
    }
  }
  // Surface skipped targets as a note (not a check) so the user understands
  // why doctor's "fail" tally doesn't match a full-portability audit.
  const notStaged = ALL_TARGETS.filter((t) => !stagedTargets.includes(t));
  if (notStaged.length > 0) {
    out.push({
      status: "pass",
      label: `Binaries [unstaged]`,
      detail: `${notStaged.length} target(s) not staged by design: ${notStaged.join(", ")}`,
    });
  }
  return out;
}

function checkHostBinary(
  drivePath: string,
  manifest: NonNullable<ReturnType<typeof loadManifest>>,
): CheckResult {
  const target = hostTarget();
  const p = usbPaths(drivePath);
  const ollama = path.join(p.engine(target), ollamaBinaryRel(target));
  // Distinguish "binary missing because corruption" from "binary missing
  // because this OS was never staged" — different remedies. add-targets
  // fills in missing targets without re-downloading the model store, which
  // is what the user actually wants on a reduced-portability stick.
  const stagedTargets = manifest.targets.length > 0 ? manifest.targets : ALL_TARGETS;
  if (!stagedTargets.includes(target)) {
    return {
      status: "fail",
      label: `Host ollama [${target}]`,
      detail: `not staged on this stick (only: ${stagedTargets.join(", ")})`,
      remedy: `Run: code-stick add-targets ${target} --target "${drivePath}"`,
    };
  }
  if (!fs.existsSync(ollama)) {
    return {
      status: "fail",
      label: `Host ollama [${target}]`,
      detail: "missing",
      remedy: `Run: code-stick upgrade-engine --target "${drivePath}"`,
    };
  }
  if (process.platform === "win32") {
    return { status: "pass", label: `Host ollama [${target}]`, detail: "present" };
  }
  // POSIX exec-bit check. FAT/exFAT silently lose the bit; a launcher running
  // via `bash` works around it but the doctor should still flag it.
  try {
    const stat = fs.statSync(ollama);
    if ((stat.mode & 0o111) === 0) {
      return {
        status: "warn",
        label: `Host ollama [${target}]`,
        detail: "not executable (typical on FAT32/exFAT)",
        remedy: "Launch via `bash start-linux.sh` or `bash start-mac.command`.",
      };
    }
  } catch { /* fall through */ }
  return { status: "pass", label: `Host ollama [${target}]`, detail: "present + executable" };
}

function checkModelStore(drivePath: string, m: NonNullable<ReturnType<typeof loadManifest>>): CheckResult[] {
  const out: CheckResult[] = [];
  const p = usbPaths(drivePath);
  const health = inspectOllamaData(p.data);
  if (!health.hasManifest || !health.hasBlobs) {
    out.push({
      status: "fail",
      label: "Ollama store",
      detail: `manifests=${health.hasManifest ? "ok" : "missing"} blobs=${health.hasBlobs ? "ok" : "missing"}`,
      remedy: "Run: code-stick add-model <id>  to (re-)pull a model.",
    });
    return out;
  }
  out.push({ status: "pass", label: "Ollama store", detail: "manifests + blobs present" });

  for (const entry of m.models) {
    const ok = hasOllamaTagManifest(p.data, entry.tag);
    out.push(ok
      ? { status: "pass", label: `Model "${entry.tag}"`, detail: "manifest on disk" }
      : {
          status: "fail",
          label: `Model "${entry.tag}"`,
          detail: "manifest missing — listed in code-stick.json but not on disk",
          remedy: `Run: code-stick remove-model ${entry.id} --force  then  code-stick add-model ${entry.id}`,
        });
  }
  return out;
}

async function checkPort(): Promise<CheckResult> {
  const inUse = await isPortInUse(11434);
  if (!inUse) return { status: "pass", label: "Port 11434", detail: "free" };
  // Distinguish "another Ollama" from "something else."
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    let res: Response | null = null;
    try { res = await fetch("http://127.0.0.1:11434/api/version", { signal: controller.signal }); }
    finally { clearTimeout(t); }
    if (res && res.ok) {
      return {
        status: "fail",
        label: "Port 11434",
        detail: "another Ollama instance is running",
        remedy: "Quit the system-tray Ollama (or `pkill ollama` / `taskkill /IM ollama.exe`) and re-run.",
      };
    }
  } catch { /* fall through */ }
  return {
    status: "fail",
    label: "Port 11434",
    detail: "in use by another process",
    remedy: "Find and stop the listener: `lsof -i :11434` (POSIX) or `Get-NetTCPConnection -LocalPort 11434` (Windows).",
  };
}

async function checkOllamaServe(
  drivePath: string,
  manifest: NonNullable<ReturnType<typeof loadManifest>>,
): Promise<CheckResult> {
  // Skip the spawn if the port is bound — checkPort already failed; running
  // a temp server would also fail and the duplicate error is noise.
  if (await isPortInUse(11434)) {
    return {
      status: "warn",
      label: "Ollama /api/version",
      detail: "skipped (port 11434 already bound)",
      remedy: "Free the port (see Port 11434 above) and re-run doctor.",
    };
  }
  const target = hostTarget();
  const p = usbPaths(drivePath);
  const bin = path.join(p.engine(target), ollamaBinaryRel(target));
  if (!fs.existsSync(bin)) {
    return {
      status: "fail",
      label: "Ollama /api/version",
      detail: "host binary missing",
      remedy: `Run: code-stick upgrade-engine --target "${drivePath}"`,
    };
  }
  try { await checkPortFree(); } catch (err) {
    return {
      status: "fail", label: "Ollama /api/version",
      detail: (err as Error).message,
      remedy: "Stop whatever is bound to 11434 and re-run doctor.",
    };
  }
  const child = spawn(bin, ["serve"], {
    env: {
      ...process.env,
      OLLAMA_MODELS: p.data,
      OLLAMA_HOST: "127.0.0.1:11434",
    },
    stdio: "ignore", windowsHide: true, detached: false,
  });
  registerProcess("ollama-doctor", child);
  try {
    const ok = await waitForOllama(20_000);
    if (!ok) {
      return {
        status: "fail",
        label: "Ollama /api/version",
        detail: "did not respond within 20s",
        remedy: `Inspect the binary: '"${bin}" serve' run by hand. Permission denied → bash launcher; ENOEXEC → wrong arch.`,
      };
    }
    const res = await fetch("http://127.0.0.1:11434/api/version");
    const body = await res.json().catch(() => ({ version: "200 OK" }));
    const version = (body as { version?: string }).version ?? "200 OK";

    // Second probe: hit /api/tags to confirm OLLAMA_MODELS correctly linked
    // to the USB data/ folder. If it returns models not in our manifest, or
    // fails to see our manifest's models, OLLAMA_MODELS is likely pointing
    // at the host's default store (~/.ollama/models) instead.
    const tagsRes = await fetch("http://127.0.0.1:11434/api/tags");
    const tagsBody = await tagsRes.json().catch(() => ({ models: [] }));
    const activeTags = (tagsBody as { models: Array<{ name: string }> }).models.map((m: { name: string }) => m.name);

    const manifestTags = manifest.models.map((m) => m.tag);
    const seen = manifestTags.filter((t: string) => activeTags.includes(t) || activeTags.includes(t + ":latest"));
    
    let detail = `version ${version}`;
    if (seen.length === 0 && manifestTags.length > 0) {
      return {
        status: "fail",
        label: "Ollama /api/tags",
        detail: "USB model store NOT detected (env variable bug)",
        remedy: "The server is running but cannot see the models on the USB. Check OLLAMA_MODELS env var.",
      };
    }
    detail += ` (found ${seen.length}/${manifestTags.length} models)`;

    return {
      status: "pass",
      label: "Ollama /api/version",
      detail,
    };
  } finally {
    await killProcess("ollama-doctor");
  }
}

async function checkOpencodeVersion(drivePath: string): Promise<CheckResult> {
  const target = hostTarget();
  const p = usbPaths(drivePath);
  const bin = path.join(p.opencode(target), opencodeBinaryRel(target));
  if (!fs.existsSync(bin)) {
    return {
      status: "fail",
      label: "opencode --version",
      detail: "host binary missing",
      remedy: `Run: code-stick upgrade-engine --target "${drivePath}"`,
    };
  }
  return await new Promise<CheckResult>((resolve) => {
    let stdout = "", stderr = "";
    const child = spawn(bin, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Pin XDG_* so opencode doesn't write to host home during the probe.
      env: {
        ...process.env,
        XDG_CONFIG_HOME: p.config,
        XDG_CACHE_HOME: p.cache,
        XDG_DATA_HOME: p.data + "/xdg",
        XDG_STATE_HOME: p.state,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_WATCHER: "1",
      },
    });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 10_000);
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        status: "fail",
        label: "opencode --version",
        detail: err.message,
        remedy: process.platform === "win32"
          ? `Confirm the binary is the right arch (x64) and not blocked by SmartScreen.`
          : `chmod +x "${bin}" or remount the USB with exec.`,
      });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const tail = (stderr || stdout).trim().split("\n").slice(-1)[0] ?? "";
        resolve({
          status: "fail",
          label: "opencode --version",
          detail: `exit ${code}${tail ? `: ${tail.slice(0, 80)}` : ""}`,
          remedy: "Re-run: code-stick upgrade-engine — the opencode binary may be corrupt.",
        });
        return;
      }
      const v = stdout.trim().split("\n")[0] || "(empty)";
      resolve({ status: "pass", label: "opencode --version", detail: v });
    });
  });
}
