// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import chalk from "chalk";

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

export const log = {
  info: (msg: string) => console.log(chalk.cyan(`  ${msg}`)),
  success: (msg: string) => console.log(chalk.green(`  ✓ ${msg}`)),
  warn: (msg: string) => console.log(chalk.yellow(`  ⚠ ${msg}`)),
  error: (msg: string) => console.error(chalk.red(`  ✗ ${msg}`)),
  step: (n: number, total: number, msg: string) =>
    console.log(chalk.white(`  [${n}/${total}] ${msg}`)),
  dim: (msg: string) => console.log(chalk.dim(`    ${msg}`)),
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
