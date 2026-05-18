// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import fs from "node:fs";
import path from "node:path";
import { usbPaths } from "../utils/paths.js";
import { findModel } from "../catalog/models.js";
import type { Manifest } from "../state/manifest.js";
import { defaultModel } from "../state/manifest.js";

/**
 * Render <USB>/config/opencode/opencode.json from a manifest. opencode reads
 * $XDG_CONFIG_HOME/opencode/opencode.json on POSIX and
 * %APPDATA%\opencode\opencode.json on Windows. Launchers redirect both env
 * vars at <USB>/config.
 *
 * All installed models are exposed under the single `ollama` provider; the
 * top-level `model` field points to the manifest default.
 */
export function writeOpencodeConfig(drivePath: string, manifest: Manifest): void {
  const p = usbPaths(drivePath);
  const dir = path.join(p.config, "opencode");
  fs.mkdirSync(dir, { recursive: true });

  // v1.x note: per-model `tools: true` is documented in the opencode v1.x
  // provider schema as the way to declare tool-use support. Older v0.4.x
  // ignored unknown model fields, so this is forward-safe even if a stick
  // momentarily holds a v0.4.x binary mid-upgrade. MUGM-d3c1-ocv2.
  const models: Record<string, { name: string; tools: boolean }> = {};
  for (const m of manifest.models) {
    const meta = findModel(m.id);
    models[m.tag] = { name: meta?.name ?? m.tag, tools: true };
  }

  const def = defaultModel(manifest);
  // Empty stick (last model just removed) → write a config without a default
  // model. opencode treats `model` as optional; the user picks a provider on
  // first launch. Once they `code-stick add-model`, this gets re-rendered.
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    provider: {
      ollama: {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama (code-stick)",
        options: { baseURL: "http://127.0.0.1:11434/v1" },
        models,
      },
    },
  };
  if (def) config.model = `ollama/${def.tag}`;

  fs.writeFileSync(
    path.join(dir, "opencode.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}
