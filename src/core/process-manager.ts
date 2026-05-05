// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import treeKill from "tree-kill";
import { log } from "../utils/logger.js";
import { hostTarget } from "../utils/platform.js";
import { usbPaths } from "../utils/paths.js";
import { ollamaBinaryRel } from "../catalog/ollama.js";
import { opencodeBinaryRel } from "../catalog/opencode.js";

const processes: Map<string, ChildProcess> = new Map();
const TERM_GRACE_MS = 8_000;
const HARD_CAP_MS = 15_000;

function registerProcess(name: string, proc: ChildProcess): void {
  const existing = processes.get(name);
  if (existing && existing.exitCode === null && !existing.killed) {
    try { proc.kill("SIGKILL"); } catch { /* ignore */ }
    throw new Error(`Process "${name}" is already running (pid ${existing.pid}).`);
  }
  processes.set(name, proc);
  proc.once("exit", () => { if (processes.get(name) === proc) processes.delete(name); });
}

function killProcess(name: string): Promise<void> {
  return new Promise((resolve) => {
    const proc = processes.get(name);
    if (!proc || !proc.pid) { resolve(); return; }
    processes.delete(name);
    const pid = proc.pid;

    let resolved = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = () => {
      if (resolved) return;
      resolved = true;
      for (const t of timers) clearTimeout(t);
      resolve();
    };
    proc.once("exit", finish);

    treeKill(pid, "SIGTERM", (err) => {
      if (err) log.dim(`tree-kill SIGTERM ${name} (pid ${pid}) failed: ${err.message}`);
    });
    timers.push(setTimeout(() => {
      if (resolved) return;
      treeKill(pid, "SIGKILL", () => { /* wait for exit */ });
    }, TERM_GRACE_MS));
    timers.push(setTimeout(() => {
      if (resolved) return;
      log.warn(`Process ${name} (pid ${pid}) did not exit in ${HARD_CAP_MS}ms — abandoning.`);
      finish();
    }, HARD_CAP_MS));
  });
}

export async function checkPortFree(): Promise<void> {
  const inUse = await isPortInUse(11434);
  if (!inUse) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch("http://127.0.0.1:11434/api/version", { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      throw new Error(
        "Port 11434 is already in use — another Ollama instance is running. " +
        "Stop it (system tray / `ollama` process) and retry."
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("another Ollama instance")) throw err;
  }
  throw new Error("Port 11434 is already in use by another process.");
}

function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return; settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(v);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

export function startOllama(drivePath: string): ChildProcess {
  const target = hostTarget();
  const p = usbPaths(drivePath);
  const exe = path.join(p.engine(target), ollamaBinaryRel(target));

  const proc = spawn(exe, ["serve"], {
    env: {
      ...process.env,
      // Force the model store to live on the USB so model blobs never touch
      // the host. Same flag we set during install for `ollama pull`.
      OLLAMA_MODELS: p.data,
      OLLAMA_HOST: "127.0.0.1:11434",
    },
    stdio: "ignore", detached: false, windowsHide: true,
  });
  registerProcess("ollama", proc);
  log.dim(`Ollama started (PID: ${proc.pid})`);
  return proc;
}

export async function waitForOllama(maxWaitMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch("http://127.0.0.1:11434");
      if (res.ok) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Launch opencode in the foreground, attached to this terminal. Resolves
 *  when opencode exits — caller should then stop Ollama and exit. */
export function runOpencodeForeground(drivePath: string): Promise<number> {
  const target = hostTarget();
  const p = usbPaths(drivePath);
  const exe = path.join(p.opencode(target), opencodeBinaryRel(target));

  return new Promise((resolve, reject) => {
    const child = spawn(exe, [], {
      env: {
        ...process.env,
        // Point opencode at the bundled config so the AI provider is preset.
        // opencode reads $XDG_CONFIG_HOME/opencode/opencode.json on POSIX, and
        // %APPDATA%\opencode\opencode.json on Windows. We provision both at
        // install time under <USB>/config/, then the launcher / `code-stick
        // start` redirects these env vars.
        XDG_CONFIG_HOME: p.config,
        APPDATA: p.config,
        OLLAMA_HOST: "127.0.0.1:11434",
      },
      stdio: "inherit",
      cwd: process.cwd(),
      windowsHide: false,
    });
    registerProcess("opencode", child);
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

export async function stopAll(): Promise<void> {
  log.info("Shutting down...");
  const names = new Set<string>(["opencode", "ollama", ...processes.keys()]);
  await Promise.all([...names].map((name) => killProcess(name)));
  log.success("All processes stopped");
}

let shuttingDown = false;
export function setupShutdownHooks(): void {
  const cleanup = async () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    await stopAll();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
