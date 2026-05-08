// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import chalk from "chalk";
import { SingleBar, Presets } from "cli-progress";
import { logToInstall } from "./install-log.js";

declare const PKG_VERSION: string | undefined;
const version = typeof PKG_VERSION !== "undefined" ? PKG_VERSION : "dev";

// #DA7756 — Claude coral.
const CORAL = chalk.hex("#DA7756");

const ASCII_ART_CODE = [
  "  ██████╗ ██████╗ ██████╗ ███████╗",
  " ██╔════╝██╔═══██╗██╔══██╗██╔════╝",
  " ██║     ██║   ██║██║  ██║█████╗  ",
  " ██║     ██║   ██║██║  ██║██╔══╝  ",
  " ╚██████╗╚██████╔╝██████╔╝███████╗",
  "  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝",
];

const ASCII_ART_STICK = [
  "███████╗████████╗██╗ ██████╗██╗  ██╗",
  "██╔════╝╚══██╔══╝██║██╔════╝██║ ██╔╝",
  "███████╗   ██║   ██║██║     █████╔╝ ",
  "╚════██║   ██║   ██║██║     ██╔═██╗ ",
  "███████║   ██║   ██║╚██████╗██║  ██╗",
  "╚══════╝   ╚═╝   ╚═╝ ╚═════╝╚═╝  ╚═╝",
];

const GITHUB_URL = "github.com/MuhammadUsmanGM";

/**
 * TTY-aware progress reporter. Under a real terminal it drives a cli-progress
 * SingleBar with full speed/ETA/MB readout. Under a non-TTY (CI logs, piped
 * stdout, redirected file) cli-progress writes its cursor-redraw escapes as
 * literal garbage, so we fall back to periodic plain-text "X% (NN/NNN MB,
 * RR.R MB/s)" lines that still show forward progress without polluting logs.
 *
 * Caller contract is the same in both modes: start(total, initial), update
 * (current, payload), stop().
 */
export interface ProgressReporter {
  start(totalMB: number, initialMB: number, payload: ProgressPayload): void;
  update(currentMB: number, payload: Partial<ProgressPayload>): void;
  stop(): void;
}

export interface ProgressPayload {
  label: string;
  speed: string;
  current: number;
  total: number;
  eta_display: string;
}

export function createProgress(): ProgressReporter {
  const isTTY = !!process.stdout.isTTY;
  if (isTTY) {
    const bar = new SingleBar(
      {
        format: `  {label} |{bar}| {percentage}% | {current}/{total} MB | {speed} MB/s | ETA: {eta_display}`,
        hideCursor: true,
      },
      Presets.shades_grey,
    );
    return {
      start: (totalMB, initialMB, payload) => bar.start(totalMB, initialMB, payload),
      update: (currentMB, payload) => bar.update(currentMB, payload),
      stop: () => bar.stop(),
    };
  }
  // Non-TTY fallback: throttle to one line every ~3s + a final 100% line.
  let total = 1;
  let label = "";
  let lastEmit = 0;
  let lastPct = -1;
  const emit = (currentMB: number, payload: Partial<ProgressPayload>) => {
    const pct = Math.min(100, Math.floor((currentMB / total) * 100));
    const speed = payload.speed ?? "?";
    console.log(`  [${label.trim()}] ${pct}% (${currentMB}/${total} MB, ${speed} MB/s)`);
    lastPct = pct;
    lastEmit = Date.now();
  };
  return {
    start: (totalMB, initialMB, payload) => {
      total = Math.max(1, totalMB);
      label = payload.label || "progress";
      emit(initialMB, payload);
    },
    update: (currentMB, payload) => {
      const now = Date.now();
      const pct = Math.floor((currentMB / total) * 100);
      // Emit on first 5%-tick crossing or every 3s, whichever comes first.
      if (pct - lastPct >= 5 || now - lastEmit > 3000) emit(currentMB, payload);
    },
    stop: () => {
      if (lastPct < 100) {
        console.log(`  [${label.trim()}] 100% (${total}/${total} MB)`);
      }
    },
  };
}

export const log = {
  info: (msg: string) => { console.log(chalk.cyan(`  ${msg}`)); logToInstall("info", msg); },
  success: (msg: string) => { console.log(chalk.green(`  ✓ ${msg}`)); logToInstall("info", msg); },
  warn: (msg: string) => { console.log(chalk.yellow(`  ⚠ ${msg}`)); logToInstall("warn", msg); },
  error: (msg: string) => { console.error(chalk.red(`  ✗ ${msg}`)); logToInstall("error", msg); },
  step: (n: number, total: number, msg: string) => {
    console.log(chalk.white(`  [${n}/${total}] ${msg}`));
    logToInstall("info", msg, { step: n, total });
  },
  dim: (msg: string) => { console.log(chalk.dim(`    ${msg}`)); logToInstall("dim", msg); },
  blank: () => console.log(),
  banner: (msg: string) => {
    console.log();
    for (const line of ASCII_ART_CODE) console.log(`  ${CORAL(line)}`);
    console.log();
    for (const line of ASCII_ART_STICK) console.log(`  ${CORAL(line)}`);
    console.log();
    console.log(`  ${chalk.bold(msg)}  ${chalk.dim(`v${version}`)}  ${CORAL(GITHUB_URL)}`);
    console.log();
  },
};
