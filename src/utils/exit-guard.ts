// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
//
// SIGINT handling lives in core/process-manager.ts via setupShutdownHooks().
// A double-Ctrl-C "press again to exit" wrapper would race the shutdown hook
// (both fire on the same signal), so we deliberately do nothing here. The
// commands that spawn child processes (install, add-model, remove-model,
// start) install setupShutdownHooks themselves; commands that don't spawn
// anything (status, update) get Node's default SIGINT-exits behavior, which
// is exactly what we want — there's no cleanup to perform.
//
// Kept as a no-op so the call site in cli.ts continues to compile while we
// figure out whether to remove the call entirely or repurpose it.
export function enableDoubleCtrlC(): void { /* no-op — see comment above */ }
export function disableDoubleCtrlC(): void { /* no-op */ }
