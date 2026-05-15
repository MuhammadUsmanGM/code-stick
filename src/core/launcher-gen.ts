// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import ejs from "ejs";
import { templatesDir } from "../utils/env.js";
import { usbPaths } from "../utils/paths.js";
import { log } from "../utils/logger.js";
import {
  ALL_TARGETS,
  familiesPresent,
  type OSFamily,
  type Target,
} from "../catalog/targets.js";

interface LauncherCtx {
  modelTag: string;
  /**
   * Targets actually staged on this stick. Used to skip launchers for OS
   * families whose binaries don't exist (a `--targets host` install on
   * Windows shouldn't ship a start-mac.command pointing at a missing dir).
   * Defaults to ALL_TARGETS for full-portability behavior.
   */
  targets?: readonly Target[];
}

interface LauncherKind {
  kind: OSFamily;
  template: string;
  exec: boolean;
}

const KINDS: LauncherKind[] = [
  { kind: "windows", template: "start-windows.bat.ejs", exec: false },
  { kind: "mac",     template: "start-mac.command.ejs", exec: true  },
  { kind: "linux",   template: "start-linux.sh.ejs",    exec: true  },
];

export function renderLaunchers(drivePath: string, ctx: LauncherCtx): void {
  const tplDir = templatesDir();
  const p = usbPaths(drivePath);
  const targets = ctx.targets ?? ALL_TARGETS;
  const families = new Set(familiesPresent(targets));

  for (const k of KINDS) {
    if (!families.has(k.kind)) {
      log.dim(`Skipping launcher start-${k.kind}.* — no ${k.kind} target staged on this stick`);
      continue;
    }
    const src = path.join(tplDir, k.template);
    const dest = p.launcher(k.kind);
    const raw = fs.readFileSync(src, "utf-8");
    const rendered = ejs.render(raw, { modelTag: ctx.modelTag }, { filename: src });
    fs.writeFileSync(dest, rendered, { encoding: "utf-8" });
    if (k.exec) {
      try { fs.chmodSync(dest, 0o755); }
      catch { /* FAT/exFAT — chmod is a no-op there. */ }
    }
    log.dim(`Wrote launcher ${path.basename(dest)}`);
  }
}
