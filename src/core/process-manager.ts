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

/**
 * Register a child process under `name`. Idempotent: if a previous entry
 * exists but has already exited, it's silently replaced. If a previous entry
 * is still alive, we kill it (and its tree) before taking over the slot —
 * this matters when a previous `withTempOllama` aborted before its `finally`
 * could call `killProcess`, leaving a stale entry that would otherwise block
 * the next ollama spawn forever.
 */
export function registerProcess(name: string, proc: ChildProcess): void {
  const existing = processes.get(name);
  if (existing) {
    const stillAlive = existing.exitCode === null && existing.signalCode === null && !existing.killed;
    if (stillAlive && existing.pid && existing.pid !== proc.pid) {
      log.warn(`Process "${name}" already had a registered pid ${existing.pid}; killing stale process before re-registering.`);
      treeKill(existing.pid, "SIGKILL", () => { /* best-effort */ });
    }
    processes.delete(name);
  }
  processes.set(name, proc);
  proc.once("exit", () => { if (processes.get(name) === proc) processes.delete(name); });
}

export function killProcess(name: string): Promise<void> {
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

  // Port is bound — try to identify the listener. If `/api/version` answers
  // 2xx, it's an Ollama instance and the user needs a tailored remediation.
  // Anything else (non-2xx, network error) means *some other* process owns
  // the port. AbortError (probe timeout) is inconclusive — we still know the
  // port is bound, but we can't claim it's "another process" with confidence,
  // so we surface a softer message.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    let res: Response;
    try {
      res = await fetch("http://127.0.0.1:11434/api/version", { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      throw new Error(
        "Port 11434 is already in use — another Ollama instance is running. " +
        "Stop it (system tray / `ollama` process) and retry."
      );
    }
    // Bound but not Ollama (non-2xx response) — definitely another process.
    throw new Error("Port 11434 is already in use by another process.");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Port 11434 is already in use")) throw err;
    const isAbort = err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message));
    if (isAbort) {
      throw new Error(
        "Port 11434 is already in use, but the listener did not respond in time. " +
        "Check for a stalled Ollama instance or another service bound to 11434."
      );
    }
    // Any other fetch failure (ECONNRESET, parse error, etc.) — port is bound
    // but the process isn't speaking HTTP cleanly. Treat as another process.
    throw new Error("Port 11434 is already in use by another process.");
  }
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
  // Probe `/api/version` — Ollama returns 404 on `/`, which would make a
  // naive `res.ok` check spin forever and time out.
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const res = await fetch("http://127.0.0.1:11434/api/version", { signal: controller.signal });
        if (res.ok) return true;
      } finally {
        clearTimeout(timer);
      }
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
        // Pin opencode's config + caches onto the USB so first launch is
        // fully offline-capable: config (provider declaration), cache
        // (pre-staged @ai-sdk/openai-compatible node_modules), data + state
        // (runtime). The launchers wire the same vars; this branch covers
        // `code-stick start` from the host machine itself.
        XDG_CONFIG_HOME: p.config,
        XDG_CACHE_HOME: p.cache,
        XDG_DATA_HOME: path.join(p.data, "xdg"),
        XDG_STATE_HOME: p.state,
        APPDATA: p.config,
        LOCALAPPDATA: p.cache,
        OPENCODE_CONFIG: path.join(p.config, "opencode", "opencode.json"),
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_WATCHER: "1",
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

type CleanupFn = () => void | Promise<void>;
const cleanupCallbacks = new Set<CleanupFn>();

/** Register a synchronous-or-async cleanup callback fired by stopAll() and the
 *  SIGINT/SIGTERM hook. Returns an unregister function so callers can scope
 *  the callback to a single operation (e.g. the fast-mode stage dir). */
export function registerCleanup(fn: CleanupFn): () => void {
  cleanupCallbacks.add(fn);
  return () => { cleanupCallbacks.delete(fn); };
}

export async function stopAll(): Promise<void> {
  log.info("Shutting down...");
  const names = new Set<string>(["opencode", "ollama", ...processes.keys()]);
  await Promise.all([...names].map((name) => killProcess(name)));
  // Run cleanup callbacks AFTER processes are dead so e.g. stage-dir rm can't
  // race the temp Ollama still holding file handles.
  for (const fn of [...cleanupCallbacks]) {
    try { await fn(); } catch (err) { log.dim(`cleanup callback failed: ${(err as Error).message}`); }
    cleanupCallbacks.delete(fn);
  }
  log.success("All processes stopped");
}

let shuttingDown = false;
let hooksInstalled = false;
export function setupShutdownHooks(): void {
  // Idempotent: each command (install, start, add-model, …) calls this on
  // entry. Without the guard, repeat calls within a single process would
  // attach duplicate SIGINT/SIGTERM listeners and fan out cleanup multiple
  // times. Mirrors the keypressInitialized pattern in utils/prompt.ts.
  if (hooksInstalled) return;
  hooksInstalled = true;
  const cleanup = async () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    await stopAll();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
