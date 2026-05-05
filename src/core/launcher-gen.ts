// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import ejs from "ejs";
import { templatesDir } from "../utils/env.js";
import { usbPaths } from "../utils/paths.js";
import { log } from "../utils/logger.js";

interface LauncherCtx {
  modelTag: string;
}

const KINDS = [
  { kind: "windows" as const, template: "start-windows.bat.ejs", exec: false },
  { kind: "mac" as const,     template: "start-mac.command.ejs", exec: true  },
  { kind: "linux" as const,   template: "start-linux.sh.ejs",    exec: true  },
];

export function renderLaunchers(drivePath: string, ctx: LauncherCtx): void {
  const tplDir = templatesDir();
  const p = usbPaths(drivePath);

  for (const k of KINDS) {
    const src = path.join(tplDir, k.template);
    const dest = p.launcher(k.kind);
    const raw = fs.readFileSync(src, "utf-8");
    const rendered = ejs.render(raw, ctx, { filename: src });
    fs.writeFileSync(dest, rendered, { encoding: "utf-8" });
    if (k.exec) {
      try { fs.chmodSync(dest, 0o755); }
      catch { /* FAT/exFAT — chmod is a no-op there. */ }
    }
    log.dim(`Wrote launcher ${path.basename(dest)}`);
  }
}
