#!/usr/bin/env node
// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
// Printed once after `npm install code-stick`. Skipped when running inside
// the package's own dev install (CI would re-print this every build) and when
// stdout isn't a TTY (CI logs).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.env.CODE_STICK_SKIP_POSTINSTALL === "1") process.exit(0);
if (process.env.CI) process.exit(0);
if (!process.stdout.isTTY) process.exit(0);

// When this script runs from the package's own repo (npm install in the
// project itself), INIT_CWD === the repo root. Skip in that case so devs
// don't get the banner on every dependency install.
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
if (process.env.INIT_CWD && path.resolve(process.env.INIT_CWD) === pkgRoot) {
  process.exit(0);
}

let version = "dev";
try {
  const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
  version = pkg.version || version;
} catch { /* fall through */ }

const CORAL = "\x1b[38;2;218;119;86m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const ASCII_CODE = [
  "  ██████╗ ██████╗ ██████╗ ███████╗",
  " ██╔════╝██╔═══██╗██╔══██╗██╔════╝",
  " ██║     ██║   ██║██║  ██║█████╗  ",
  " ██║     ██║   ██║██║  ██║██╔══╝  ",
  " ╚██████╗╚██████╔╝██████╔╝███████╗",
  "  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝",
];
const ASCII_STICK = [
  "███████╗████████╗██╗ ██████╗██╗  ██╗",
  "██╔════╝╚══██╔══╝██║██╔════╝██║ ██╔╝",
  "███████╗   ██║   ██║██║     █████╔╝ ",
  "╚════██║   ██║   ██║██║     ██╔═██╗ ",
  "███████║   ██║   ██║╚██████╗██║  ██╗",
  "╚══════╝   ╚═╝   ╚═╝ ╚═════╝╚═╝  ╚═╝",
];

console.log();
for (const line of ASCII_CODE) console.log(`  ${CORAL}${line}${RESET}`);
console.log();
for (const line of ASCII_STICK) console.log(`  ${CORAL}${line}${RESET}`);
console.log();
console.log(`  ${BOLD}Installed${RESET}  ${DIM}v${version}${RESET}  ${CORAL}github.com/MuhammadUsmanGM${RESET}`);
console.log();
console.log(`  ${BOLD}Next steps${RESET}`);
console.log(`    ${CYAN}1.${RESET} Plug in a USB drive (8+ GB free, exFAT or NTFS).`);
console.log(`    ${CYAN}2.${RESET} Run ${BOLD}code-stick install${RESET} ${DIM}# auto-detect${RESET}`);
console.log(`       ${DIM}or${RESET} ${BOLD}code-stick install --target <path>${RESET} ${DIM}# explicit path${RESET}`);
console.log(`    ${CYAN}3.${RESET} Pick a coding model when prompted.`);
console.log();
console.log(`  ${DIM}Useful commands:${RESET}`);
console.log(`    code-stick status         ${DIM}what's installed${RESET}`);
console.log(`    code-stick add-model      ${DIM}pull another model${RESET}`);
console.log(`    code-stick start          ${DIM}launch from a USB${RESET}`);
console.log(`    code-stick uninstall      ${DIM}wipe a stick${RESET}`);
console.log();
console.log(`  ${DIM}Docs: https://github.com/MuhammadUsmanGM/code-stick${RESET}`);
console.log();
