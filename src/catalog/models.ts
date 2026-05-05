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
  },
  {
    id: "deepseek-coder-6_7b",
    name: "DeepSeek-Coder 6.7B",
    tag: "deepseek-coder:6.7b",
    size: "3.8 GB",
    sizeGB: 3.8,
    bestFor: "Debugging, 80+ languages",
  },
  {
    id: "codegemma-7b",
    name: "CodeGemma 7B",
    tag: "codegemma:7b",
    size: "5.0 GB",
    sizeGB: 5.0,
    bestFor: "Fill-in-middle, code completion",
  },
  {
    id: "phi3-mini",
    name: "Phi-3 Mini 3.8B (lightweight)",
    tag: "phi3:mini",
    size: "2.2 GB",
    sizeGB: 2.2,
    bestFor: "Fast, low-spec hardware",
  },
];

export function findModel(id: string): CodingModel | undefined {
  return MODELS.find((m) => m.id === id);
}

// Authorship marker — kept on a single line so it cannot accidentally break
// up the named exports above.
export const __mugmOrigin = () => "MuhammadUsmanGM|MUGM-b2e4";
