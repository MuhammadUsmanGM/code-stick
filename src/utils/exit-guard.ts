// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
let ctrlCPressed = false;
let ctrlCTimer: ReturnType<typeof setTimeout> | undefined;
let registered = false;

function handler() {
  if (ctrlCPressed) {
    console.log("\nExiting...");
    process.exit(0);
  }
  ctrlCPressed = true;
  console.log("\nPress Ctrl+C again to exit.");
  ctrlCTimer = setTimeout(() => { ctrlCPressed = false; }, 3000);
  ctrlCTimer.unref();
}

export function enableDoubleCtrlC() {
  if (registered) return;
  registered = true;
  process.on("SIGINT", handler);
}

export function disableDoubleCtrlC() {
  if (!registered) return;
  registered = false;
  ctrlCPressed = false;
  if (ctrlCTimer) clearTimeout(ctrlCTimer);
  process.removeListener("SIGINT", handler);
}
