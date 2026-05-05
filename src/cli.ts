// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { Command } from "commander";
import { log } from "./utils/logger.js";
import { enableDoubleCtrlC } from "./utils/exit-guard.js";
import { installCommand } from "./commands/install.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";
import { addModelCommand } from "./commands/add-model.js";
import { removeModelCommand } from "./commands/remove-model.js";

declare const PKG_VERSION: string | undefined;
const version = typeof PKG_VERSION !== "undefined" ? PKG_VERSION : "dev";

async function main() {
  enableDoubleCtrlC();

  const program = new Command();
  program
    .name("code-stick")
    .description("Portable AI coding agent on a USB — opencode + Ollama")
    .version(version);

  program
    .command("install")
    .description("Install code-stick (opencode + Ollama + a coding model) onto a USB drive")
    .option("-t, --target <path>", "Install to this directory (skips USB picker)")
    .option("-m, --model <id>", "Pick a model non-interactively (qwen25-coder-7b, deepseek-coder-6_7b, codegemma-7b, phi3-mini)")
    .option("-y, --yes", "Skip confirmations where possible")
    .action(async (opts) => { await installCommand(opts); });

  program
    .command("start")
    .description("Start Ollama from the USB and launch opencode in this terminal")
    .option("-t, --target <path>", "Use this installation directory (skips picker)")
    .action(async (opts) => { await startCommand(opts); });

  program
    .command("status")
    .description("Show what is installed on the USB")
    .option("-t, --target <path>", "Inspect this installation directory")
    .action(async (opts) => { await statusCommand(opts); });

  program
    .command("update")
    .description("Refresh launcher scripts and manifest timestamp")
    .option("-t, --target <path>", "Update this installation directory")
    .action(async (opts) => { await updateCommand(opts); });

  program
    .command("add-model [id]")
    .description("Pull an additional coding model onto an existing stick")
    .option("-t, --target <path>", "Add to this installation directory")
    .option("--set-default", "Make the new model the default for opencode + launchers")
    .action(async (id, opts) => { await addModelCommand(id, opts); });

  program
    .command("remove-model [id]")
    .description("Remove a coding model from a stick")
    .option("-t, --target <path>", "Remove from this installation directory")
    .option("--force", "Allow removing the only or default model")
    .action(async (id, opts) => { await removeModelCommand(id, opts); });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  if (process.env.CODE_STICK_DEBUG === "1" && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
