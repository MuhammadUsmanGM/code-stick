// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { Command } from "commander";
import { log } from "./utils/logger.js";
import { enableDoubleCtrlC } from "./utils/exit-guard.js";
import { buildBugReport, bugReportRemediation } from "./utils/bug-report.js";
import { installCommand } from "./commands/install.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";
import { upgradeEngineCommand } from "./commands/upgrade-engine.js";
import { doctorCommand } from "./commands/doctor.js";
import { addModelCommand } from "./commands/add-model.js";
import { removeModelCommand } from "./commands/remove-model.js";
import { addTargetsCommand } from "./commands/add-targets.js";
import { pruneCommand } from "./commands/prune.js";
import { uninstallCommand } from "./commands/uninstall.js";

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
    .option("-m, --model <id>", "Pick a model non-interactively. Curated ids: qwen25-coder-7b, qwen25-coder-14b, qwen25-coder-32b, deepseek-coder-6_7b, deepseek-coder-v2-16b, codegemma-7b, phi3-mini. Or add any Ollama tag later with `code-stick add-model <tag>`.")
    .option("-y, --yes", "Skip confirmations where possible")
    .option("--no-cleanup", "Keep installer archives + temp dirs after install (debugging)")
    .option(
      "--targets <list>",
      "Which OS targets to stage. Comma-separated. Tokens: all (default, fully portable), " +
      "host, windows, mac, linux, or any of windows-x64, windows-arm64, darwin-arm64, darwin-x64, linux-x64, linux-arm64. " +
      "Anything other than 'all' will print a non-portability warning.",
    )
    .option(
      "--opencode-version <ver>",
      "Override the bundled opencode release (e.g. v1.15.4). Default is the version SHA-pinned in this code-stick build. " +
      "Non-default versions are not SHA-pinned and require CODE_STICK_ALLOW_UNVERIFIED=1.",
    )
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
    .command("doctor")
    .description("Live audit of an installed stick (filesystem, port, ollama, opencode, models)")
    .option("-t, --target <path>", "Audit this installation directory")
    .option("--no-probe", "Skip live ollama serve / opencode --version probes (static checks only)")
    .action(async (opts) => { await doctorCommand(opts); });

  program
    .command("upgrade-engine")
    .description("Re-download + swap Ollama + opencode binaries, preserving the model store")
    .option("-t, --target <path>", "Upgrade this installation directory")
    .option("-y, --yes", "Skip confirmation")
    .option("--no-cleanup", "Keep installer archives + temp dirs after upgrade (debugging)")
    .option(
      "--opencode-version <ver>",
      "Swap to this opencode release instead of the bundled default (e.g. v1.15.4). " +
      "Non-default versions are not SHA-pinned and require CODE_STICK_ALLOW_UNVERIFIED=1.",
    )
    .action(async (opts) => { await upgradeEngineCommand(opts); });

  program
    .command("add-model [id-or-tag]")
    .description(
      "Pull a coding model onto an existing stick. Accepts a curated id " +
      "(qwen25-coder-7b, qwen25-coder-14b, qwen25-coder-32b, ...) OR any " +
      "Ollama tag (e.g. `qwen2.5-coder:14b`, `deepseek-coder-v2:16b`)."
    )
    .option("-t, --target <path>", "Add to this installation directory")
    .option("--set-default", "Make the new model the default for opencode + launchers")
    .option("-y, --yes", "Skip the custom-tag confirmation prompt")
    .option(
      "--num-ctx <n>",
      "Override the baked context window (tokens) for a custom Ollama tag. " +
        "Curated tags use a tuned per-model value automatically; this flag only " +
        "applies to raw tags passed via `add-model <tag>`. Default for custom " +
        "tags: 8192. Examples: 16384, 32768.",
    )
    .action(async (id, opts) => { await addModelCommand(id, opts); });

  program
    .command("remove-model [id]")
    .description("Remove a coding model from a stick")
    .option("-t, --target <path>", "Remove from this installation directory")
    .option("--force", "Allow removing the only or default model")
    .action(async (id, opts) => { await removeModelCommand(id, opts); });

  program
    .command("add-targets [list]")
    .description("Add OS targets to a stick installed with --targets (restore portability)")
    .option("-t, --target <path>", "Add to this installation directory")
    .option("-y, --yes", "Skip confirmation")
    .option("--no-cleanup", "Keep installer archives + temp dirs after run (debugging)")
    .action(async (list, opts) => { await addTargetsCommand(list, opts); });

  program
    .command("prune")
    .description("Run ollama prune on the USB model store to reclaim orphaned blobs")
    .option("-t, --target <path>", "Prune this installation directory")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (opts) => { await pruneCommand(opts); });

  program
    .command("uninstall")
    .description("Remove code-stick (binaries, models, config, launchers) from a USB")
    .option("-t, --target <path>", "Uninstall from this directory")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--force", "Proceed even if no code-stick manifest is detected at the target")
    .action(async (opts) => { await uninstallCommand(opts); });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  if (process.env.CODE_STICK_DEBUG === "1" && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  // Don't generate bug reports for user-cancellation paths (Ctrl+C, prompt
  // step-back) or for already-cleanly-handled domain errors that the
  // commands intentionally throw with remediation lines. The marker is the
  // CODE_STICK_NO_REPORT env var that command code can set when re-throwing.
  if (process.env.CODE_STICK_NO_REPORT !== "1") {
    try {
      const cmd = (process.argv[2] || "unknown").replace(/[^a-z0-9-]/gi, "");
      const report = buildBugReport({ command: cmd, err });
      log.blank();
      for (const line of bugReportRemediation(report)) log.dim(line);
    } catch {
      // Bug-report-generation must never mask the original error.
    }
  }
  process.exit(1);
});
