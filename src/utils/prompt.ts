// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import inquirer from "inquirer";
import readline from "readline";

let keypressInitialized = false;
function ensureKeypressEvents() {
  if (keypressInitialized) return;
  if (!process.stdin.isTTY) return;
  readline.emitKeypressEvents(process.stdin);
  keypressInitialized = true;
}

/** inquirer.prompt with Esc support. Returns null when Esc is pressed. */
export async function promptWithEsc<T extends Record<string, any>>(
  questions: Parameters<typeof inquirer.prompt>[0]
): Promise<T | null> {
  if (!process.stdin.isTTY) return inquirer.prompt<T>(questions);
  ensureKeypressEvents();

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => process.stdin.removeListener("keypress", onKeypress);

    const onKeypress = (_ch: unknown, key?: { name?: string }) => {
      if (key?.name === "escape" && !settled) {
        settled = true;
        cleanup();
        try { (p.ui as unknown as { close: () => void }).close(); } catch { /* ignore */ }
        console.log();
        resolve(null);
      }
    };
    process.stdin.on("keypress", onKeypress);

    const p = inquirer.prompt<T>(questions);
    p.then((answers) => {
      if (!settled) { settled = true; cleanup(); resolve(answers); }
    }).catch((err) => { settled = true; cleanup(); reject(err); });
  });
}
