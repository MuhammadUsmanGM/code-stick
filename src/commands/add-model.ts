// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { log } from "../utils/logger.js";
import { promptWithEsc } from "../utils/prompt.js";
import { pickDrive, assertDriveReady, checkDiskSpace } from "../core/usb.js";
import {
  MODELS,
  findModel,
  isPlausibleOllamaTag,
  tagToCustomId,
  type CodingModel,
} from "../catalog/models.js";
import { loadManifest, saveManifest } from "../state/manifest.js";
import { preflightFilesystem } from "../core/preflight.js";
import { pullModelTag } from "../core/model-pull.js";
import { writeOpencodeConfig } from "../core/opencode-config.js";
import { renderLaunchers } from "../core/launcher-gen.js";
import { setupShutdownHooks, stopAll } from "../core/process-manager.js";
import { openInstallLog, closeInstallLog } from "../utils/install-log.js";

interface AddModelOptions {
  target?: string;
  setDefault?: boolean;
  yes?: boolean;
}

/**
 * Resolution of the user's `[id]` argument. A curated entry comes from
 * MODELS[]; a custom entry is synthesized from an arbitrary Ollama tag the
 * user passed directly (e.g. `code-stick add-model qwen2.5-coder:14b`).
 */
interface ResolvedModel {
  kind: "curated" | "custom";
  /** Manifest ID — stable identifier persisted to code-stick.json. */
  id: string;
  /** Display name (label for the picker / log output). */
  name: string;
  /** Exact tag passed to `ollama pull`. */
  tag: string;
  /**
   * Estimated disk requirement in GB. For curated models this is exact-ish;
   * for custom tags it's a worst-case guess so the free-space preflight has
   * something to gate against.
   */
  sizeGB: number;
  /** Optional curated metadata (only present when kind === "curated"). */
  meta?: CodingModel;
}

/**
 * Conservative size estimate for an unknown Ollama tag. We can't stat the
 * registry from here without spinning up the temp Ollama server, so we
 * over-estimate and let the user override with --yes. The number is
 * pessimistic on purpose: better to refuse and ask than to brick a USB
 * mid-pull with ENOSPC.
 *
 * Heuristic: look at trailing `:Nb` parameter count, multiply by ~0.6 GB/B
 * (typical Q4_K_M quant footprint), floor at 4 GB.
 */
export function estimateCustomSizeGB(tag: string): number {
  const m = /:(\d+(?:\.\d+)?)b\b/i.exec(tag);
  if (m) {
    const params = parseFloat(m[1]);
    if (Number.isFinite(params) && params > 0) {
      return Math.max(4, Math.ceil(params * 0.6));
    }
  }
  // No `:Nb` in the tag — assume a mid-size 7B-class model.
  return 6;
}

export async function addModelCommand(modelId: string | undefined, opts: AddModelOptions): Promise<void> {
  setupShutdownHooks();
  log.banner("Add model");

  const drivePath = await pickDrive(opts.target);
  assertDriveReady(drivePath);
  openInstallLog(drivePath, "add-model");
  try {

  const manifest = loadManifest(drivePath);
  if (!manifest) {
    log.error("No installation found at this drive.");
    log.info(`Run: code-stick install --target "${drivePath}"`);
    process.exit(1);
  }

  const resolved = await resolveModelArg(modelId, manifest.models.map((m) => m.id), opts);
  if (!resolved) { log.info("Cancelled."); return; }

  if (manifest.models.some((m) => m.id === resolved.id || m.tag === resolved.tag)) {
    log.warn(`${resolved.name} is already installed on this stick.`);
    return;
  }

  // preflightFilesystem only really needs sizeGB + name from the metadata.
  // For curated models pass the real entry; for custom synthesize a minimal
  // CodingModel-shaped object so the preflight signature doesn't change.
  const preflightArg: CodingModel = resolved.meta ?? {
    id: resolved.id,
    name: resolved.name,
    tag: resolved.tag,
    size: `${resolved.sizeGB} GB`,
    sizeGB: resolved.sizeGB,
    bestFor: "custom Ollama tag",
  };
  preflightFilesystem(drivePath, preflightArg);

  const requiredGB = Math.ceil(resolved.sizeGB + 1);
  const ok = await checkDiskSpace(drivePath, requiredGB);
  if (!ok) {
    throw new Error(
      `Not enough free space on ${drivePath} for ${resolved.name} (~${requiredGB} GB). ` +
      `Free space (or remove an unused model with \`code-stick remove-model\`) and re-run.`
    );
  }

  log.info(`Pulling ${resolved.tag} into USB store...`);
  try {
    await pullModelTag(drivePath, resolved.tag);
  } finally {
    await stopAll().catch(() => undefined);
  }

  manifest.models.push({ id: resolved.id, tag: resolved.tag, addedAt: new Date().toISOString() });
  if (opts.setDefault) manifest.defaultModelId = resolved.id;
  manifest.updatedAt = new Date().toISOString();

  writeOpencodeConfig(drivePath, manifest);
  renderLaunchers(drivePath, { modelTag: manifest.models.find((m) => m.id === manifest.defaultModelId)?.tag ?? resolved.tag });
  saveManifest(drivePath, manifest);

  log.blank();
  log.success(`Added ${resolved.name} to ${drivePath}`);
  if (opts.setDefault) log.info(`Default model is now ${resolved.tag}`);
  else log.dim(`Default model still ${manifest.defaultModelId}. Pass --set-default to change.`);
  } finally {
    closeInstallLog();
  }
}

/**
 * Turn the optional `[id]` argument into a concrete model to pull. Three paths:
 *
 *   1. No arg → interactive picker over the curated MODELS[] (minus what's
 *      already installed). Returns null on Esc / no remaining entries.
 *   2. Arg matches a curated id → return that curated entry.
 *   3. Arg looks like an Ollama tag (contains `:`, `/`, or `.`) → treat as
 *      a bring-your-own-tag custom install. Loud confirm gate unless --yes.
 *
 * Anything that's neither a known id nor a plausible tag throws with the
 * list of valid ids so typos get a clear error instead of a registry 404.
 */
async function resolveModelArg(
  arg: string | undefined,
  alreadyInstalled: string[],
  opts: AddModelOptions,
): Promise<ResolvedModel | null> {
  if (arg) {
    const curated = findModel(arg);
    if (curated) {
      return { kind: "curated", id: curated.id, name: curated.name, tag: curated.tag, sizeGB: curated.sizeGB, meta: curated };
    }
    // Heuristic: a real Ollama tag is the kind of string that contains a
    // version separator or a registry path. Bare ids without those characters
    // are almost always typos of catalog ids — refuse with the curated list.
    const looksLikeTag = /[:/.]/.test(arg);
    if (!looksLikeTag || !isPlausibleOllamaTag(arg)) {
      const ids = MODELS.map((x) => x.id).join(", ");
      throw new Error(
        `Unknown model "${arg}". Pass either a curated id (${ids}) ` +
        `or a full Ollama tag like \`qwen2.5-coder:14b\`.`,
      );
    }
    return resolveCustomTag(arg, opts);
  }

  const remaining = MODELS.filter((m) => !alreadyInstalled.includes(m.id));
  if (remaining.length === 0) {
    log.info("All curated models are already installed on this stick.");
    log.dim("Add any other Ollama tag with: code-stick add-model <tag>");
    log.dim("Example: code-stick add-model qwen2.5-coder:14b");
    return null;
  }
  const choices = remaining.map((m) => {
    const tierTag = m.tier && m.tier !== "small" ? `  [${m.tier}]` : "";
    return {
      name: `${m.name} — ${m.size}  ${m.bestFor}${tierTag}`,
      value: m.id,
    };
  });
  const ans = await promptWithEsc<{ id: string }>([
    {
      type: "list",
      name: "id",
      message: "Pick a coding model to add:",
      choices,
      default: remaining[0].id,
      // Match the install picker: render the whole list, no wrap-around.
      pageSize: Math.max(choices.length, 7),
      loop: false,
    },
  ]);
  if (!ans) return null;
  const curated = findModel(ans.id);
  if (!curated) return null;
  return { kind: "curated", id: curated.id, name: curated.name, tag: curated.tag, sizeGB: curated.sizeGB, meta: curated };
}

/**
 * Build a ResolvedModel for an arbitrary Ollama tag, with a loud confirm
 * gate because: (a) we can't verify the tag exists until `ollama pull` runs,
 * (b) size is a guess, and (c) custom tags don't get the curated metadata
 * shown in `status` / picker re-runs. --yes skips the prompt for scripts.
 */
async function resolveCustomTag(tag: string, opts: AddModelOptions): Promise<ResolvedModel | null> {
  const id = tagToCustomId(tag);
  const sizeGB = estimateCustomSizeGB(tag);

  if (!opts.yes) {
    log.blank();
    log.warn(`⚠  Custom Ollama tag — not in code-stick's curated list.`);
    log.dim(`Tag:           ${tag}`);
    log.dim(`Manifest id:   ${id}`);
    log.dim(`Estimated size: ~${sizeGB} GB (rough — based on parameter count in tag)`);
    log.dim("");
    log.dim("If the tag doesn't exist on ollama.com, the pull will fail and");
    log.dim("nothing will be added to the stick. No way to verify before pulling.");
    log.blank();
    const ans = await promptWithEsc<{ proceed: boolean }>([
      { type: "confirm", name: "proceed", message: `Pull \`${tag}\` onto the stick?`, default: false },
    ]);
    if (!ans || !ans.proceed) return null;
  }

  return {
    kind: "custom",
    id,
    name: `${tag} (custom)`,
    tag,
    sizeGB,
  };
}
