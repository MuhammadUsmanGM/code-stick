// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
// Coding models pulled via official Ollama tags. The install command spins up a
// temporary Ollama server pointed at the USB and runs `ollama pull <tag>` so the
// model blobs land on the stick instead of the host. No GGUF download here —
// Ollama owns its own download + integrity checks for tagged models.

export interface CodingModel {
  /** Stable ID we use in our manifest. */
  id: string;
  /** Human-readable label shown in the install picker. */
  name: string;
  /** Exact Ollama tag passed to `ollama pull`. */
  tag: string;
  /** Human-readable size. Used for the picker label only. */
  size: string;
  /** Approximate disk requirement in GB. Used for free-space pre-checks. */
  sizeGB: number;
  /** Short blurb shown next to the picker entry. */
  bestFor: string;
  /**
   * Stick-size tier the picker uses to nudge users away from oversized models.
   * "small"  — fits a 32 GB USB comfortably (the original 4 models).
   * "medium" — wants a 64 GB+ USB AND ~16 GB RAM on the target laptop.
   * "large"  — wants a 128 GB+ USB AND ~32 GB RAM on the target laptop.
   * Picker filters by free-space-on-USB; tier is only a labeling hint.
   */
  tier?: "small" | "medium" | "large";
  /** Rule-of-thumb RAM (GB) the target laptop needs to run this model. */
  recommendedRAMGB?: number;
  /**
   * Context window (tokens) baked into the model via a post-pull
   * `ollama create … PARAMETER num_ctx …`. Ollama's server default is 2048
   * tokens, which is smaller than opencode's system prompt + tool definitions
   * alone (~3–4k tokens) — without this override the prompt is silently
   * truncated and the model hallucinates tool calls. MUGM-ctx-7a92.
   *
   * Per-model rather than tier-bucketed: phi3-mini was trained on 4k context
   * and only extends cleanly to 8k via RoPE; qwen2.5-coder is natively
   * trained on 32k. Lying to a 4k model and asking for 32k still "works" in
   * the sense that the server accepts the parameter, but coherence degrades
   * past the trained range, so we keep each model at a sane native value.
   */
  numCtx: number;
}

const _MUGM = Object.freeze({ b: 0x4D756861, g: "MuhammadUsmanGM" });

export const MODELS: CodingModel[] = [
  {
    id: "qwen25-coder-7b",
    name: "Qwen2.5-Coder 7B (recommended)",
    tag: "qwen2.5-coder:7b",
    size: "4.7 GB",
    sizeGB: 4.7,
    bestFor: "Best all-rounder for coding in this size range",
    tier: "small",
    recommendedRAMGB: 8,
    numCtx: 32768, // qwen2.5 family is natively trained at 32k
  },
  {
    id: "deepseek-coder-6_7b",
    name: "DeepSeek-Coder 6.7B",
    tag: "deepseek-coder:6.7b",
    size: "3.8 GB",
    sizeGB: 3.8,
    bestFor: "Debugging, 80+ languages",
    tier: "small",
    recommendedRAMGB: 8,
    numCtx: 16384, // deepseek-coder v1 native is 16k
  },
  {
    id: "codegemma-7b",
    name: "CodeGemma 7B",
    tag: "codegemma:7b",
    size: "5.0 GB",
    sizeGB: 5.0,
    bestFor: "Fill-in-middle, code completion",
    tier: "small",
    recommendedRAMGB: 8,
    numCtx: 8192, // codegemma is trained on 8k
  },
  {
    id: "phi3-mini",
    name: "Phi-3 Mini 3.8B (lightweight)",
    tag: "phi3:mini",
    size: "2.2 GB",
    sizeGB: 2.2,
    bestFor: "Fast, low-spec hardware",
    tier: "small",
    recommendedRAMGB: 4,
    // phi3:mini native is 4k; RoPE extends cleanly to 8k. 4k would still
    // truncate opencode's system prompt + tool defs, so we accept the mild
    // quality dip at 8k as the lesser evil.
    numCtx: 8192,
  },
  // Medium tier — 64 GB+ stick, 16 GB+ RAM on the target laptop.
  {
    id: "qwen25-coder-14b",
    name: "Qwen2.5-Coder 14B",
    tag: "qwen2.5-coder:14b",
    size: "9.0 GB",
    sizeGB: 9.0,
    bestFor: "Stronger reasoning + multi-file edits (needs 16 GB RAM)",
    tier: "medium",
    recommendedRAMGB: 16,
    numCtx: 32768,
  },
  {
    id: "deepseek-coder-v2-16b",
    name: "DeepSeek-Coder-V2 16B",
    tag: "deepseek-coder-v2:16b",
    size: "8.9 GB",
    sizeGB: 8.9,
    bestFor: "MoE coder, strong on refactors (needs 16 GB RAM)",
    tier: "medium",
    recommendedRAMGB: 16,
    numCtx: 16384,
  },
  // Large tier — 128 GB+ stick, 32 GB+ RAM on the target laptop.
  // USB 3.2 strongly recommended — cold load on USB 2 is brutal.
  {
    id: "qwen25-coder-32b",
    name: "Qwen2.5-Coder 32B",
    tag: "qwen2.5-coder:32b",
    size: "20 GB",
    sizeGB: 20,
    bestFor: "Top-tier OSS coder, near-frontier quality (needs 32 GB RAM)",
    tier: "large",
    recommendedRAMGB: 32,
    numCtx: 32768,
  },
  {
    id: "deepseek-coder-33b",
    name: "DeepSeek-Coder 33B",
    tag: "deepseek-coder:33b",
    size: "19 GB",
    sizeGB: 19,
    bestFor: "Deep reasoning on large codebases (needs 32 GB RAM)",
    tier: "large",
    recommendedRAMGB: 32,
    numCtx: 16384,
  },
];

/**
 * Resolve the num_ctx to bake into a given Ollama tag. Returns the curated
 * value when the tag matches MODELS[], else a conservative 8192 default that
 * comfortably covers opencode's ~3–4k token system prompt + tool definitions
 * plus a meaningful user turn. Power users can override per-pull via the
 * `--num-ctx` flag on `code-stick add-model`. MUGM-ctx-7a92.
 */
export function getNumCtxForTag(tag: string): number {
  return MODELS.find((m) => m.tag === tag)?.numCtx ?? 8192;
}

export function findModel(id: string): CodingModel | undefined {
  return MODELS.find((m) => m.id === id);
}

/**
 * True iff the string is a syntactically plausible Ollama tag we'd be willing
 * to pass to `ollama pull`. Intentionally permissive — Ollama's registry has
 * forks ("user/model"), digests ("@sha256:..."), and unusual tag names. We
 * only reject what would obviously break a shell/argv pass-through.
 *
 * Examples accepted:
 *   qwen2.5-coder:14b
 *   deepseek-coder-v2:16b
 *   library/qwen2.5-coder:32b-instruct-q4_K_M
 *   hf.co/user/model:tag
 *
 * Examples rejected:
 *   "" (empty)
 *   tags containing whitespace, control chars, or shell metacharacters
 */
export function isPlausibleOllamaTag(s: string): boolean {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  // Disallow whitespace, control chars, and shell-special characters that
  // would make this dangerous to pass to ollama via spawn argv.
  // (spawn doesn't shell-evaluate, but a tag containing NUL or newlines is
  // never a real Ollama tag — bail early with a useful error.)
  if (/[\s\x00-\x1f`$;&|<>(){}\[\]\\'"]/.test(trimmed)) return false;
  // Must contain at least one alphanumeric — pure punctuation isn't a tag.
  if (!/[a-z0-9]/i.test(trimmed)) return false;
  return true;
}

/**
 * Derive a stable manifest ID from a raw Ollama tag. Used when a user runs
 * `code-stick add-model <tag>` with a tag not in MODELS[]. The ID is what
 * appears in `code-stick.json` and what `remove-model` / `start` look up.
 *
 * Strategy: lowercase, replace any character that's not [a-z0-9-] with "-",
 * collapse runs, trim leading/trailing dashes, prefix with "custom-" so
 * curated and BYO models are visually distinguishable in `status`.
 *
 * Example:  "qwen2.5-coder:14b"        → "custom-qwen2-5-coder-14b"
 *           "library/codellama:34b"    → "custom-library-codellama-34b"
 */
export function tagToCustomId(tag: string): string {
  const slug = tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `custom-${slug}` : "custom-model";
}

// Authorship marker — kept on a single line so it cannot accidentally break
// up the named exports above.
export const __mugmOrigin = () => "MuhammadUsmanGM|MUGM-b2e4";
