// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
// Every OS+arch the USB must support. The install command always downloads
// artefacts for ALL of these by default so the same stick boots on any of them.
// Users may opt out of full portability via `--targets <list>` — see
// parseTargetsFlag() below.

export type Target =
  | "windows-x64"
  | "windows-arm64"
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64";

export const ALL_TARGETS: Target[] = [
  "windows-x64",
  "windows-arm64",
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
];

/** OS family — drives launcher selection (.bat / .command / .sh). */
export type OSFamily = "windows" | "mac" | "linux";

export function osFamilyOf(t: Target): OSFamily {
  if (t === "windows-x64" || t === "windows-arm64") return "windows";
  if (t === "darwin-arm64" || t === "darwin-x64") return "mac";
  return "linux";
}

/** Targets belonging to a given OS family. Used by --targets `windows`/`mac`/`linux`. */
export function targetsForFamily(family: OSFamily): Target[] {
  return ALL_TARGETS.filter((t) => osFamilyOf(t) === family);
}

const FAMILY_NAMES: OSFamily[] = ["windows", "mac", "linux"];

function isTarget(s: string): s is Target {
  return (ALL_TARGETS as string[]).includes(s);
}

function isFamily(s: string): s is OSFamily {
  return (FAMILY_NAMES as string[]).includes(s);
}

/**
 * Resolve the Target the current Node process is running on. Used by
 * `--targets host` to mean "just the OS I'm installing from."
 *
 * win32-arm64, freebsd, openbsd etc. are not in the catalog — throw a
 * clear error so the user picks an explicit list instead of getting a
 * cryptic "downloads succeeded but nothing extracted" later.
 */
export function resolveHostTarget(): Target {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "win32" && arch === "x64") return "windows-x64";
  if (platform === "win32" && arch === "arm64") return "windows-arm64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  throw new Error(
    `Unsupported host (${platform}/${arch}) — cannot resolve --targets host. ` +
    `Pass an explicit list instead, e.g. --targets ${ALL_TARGETS.join(",")}.`,
  );
}

/**
 * Parse a `--targets <list>` CLI value into a deduplicated Target[].
 *
 * Accepted inputs (case-insensitive, whitespace tolerant):
 *   - undefined / "" / "all"           → ALL_TARGETS (fully portable, default)
 *   - "host"                            → just the current OS+arch
 *   - "windows" / "mac" / "linux"       → all targets in that family
 *   - "windows-x64,linux-arm64"         → explicit Target IDs
 *   - any mix of the above, comma-separated
 *
 * Throws an actionable error on unknown tokens — silent skipping would
 * leave the user with a stick that secretly doesn't boot on the OS they
 * thought they'd selected.
 */
export function parseTargetsFlag(input: string | undefined): Target[] {
  if (input === undefined || input === null) return [...ALL_TARGETS];
  const trimmed = String(input).trim().toLowerCase();
  if (trimmed === "" || trimmed === "all") return [...ALL_TARGETS];

  const tokens = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return [...ALL_TARGETS];

  const out = new Set<Target>();
  const unknown: string[] = [];
  for (const tok of tokens) {
    if (tok === "all") {
      for (const t of ALL_TARGETS) out.add(t);
    } else if (tok === "host") {
      out.add(resolveHostTarget());
    } else if (isFamily(tok)) {
      for (const t of targetsForFamily(tok)) out.add(t);
    } else if (isTarget(tok)) {
      out.add(tok);
    } else {
      unknown.push(tok);
    }
  }

  if (unknown.length) {
    throw new Error(
      `Unknown --targets token(s): ${unknown.join(", ")}. ` +
      `Valid values: all, host, ${FAMILY_NAMES.join(", ")}, or any of ` +
      `${ALL_TARGETS.join(", ")} (comma-separated).`,
    );
  }

  // Preserve ALL_TARGETS order for stable on-disk manifests + log output.
  return ALL_TARGETS.filter((t) => out.has(t));
}

/** True when the resolved subset covers every catalog target. */
export function isFullPortability(targets: readonly Target[]): boolean {
  if (targets.length !== ALL_TARGETS.length) return false;
  const set = new Set(targets);
  return ALL_TARGETS.every((t) => set.has(t));
}

/** OS families present in `targets` (used to decide which launchers to write). */
export function familiesPresent(targets: readonly Target[]): OSFamily[] {
  const seen = new Set<OSFamily>();
  for (const t of targets) seen.add(osFamilyOf(t));
  return FAMILY_NAMES.filter((f) => seen.has(f));
}
