// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
// Every OS+arch the USB must support. The install command always downloads
// artefacts for ALL of these so the same stick boots on any of them.

export type Target =
  | "windows-x64"
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64";

export const ALL_TARGETS: Target[] = [
  "windows-x64",
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
];

/** OS family — drives launcher selection (.bat / .command / .sh). */
export type OSFamily = "windows" | "mac" | "linux";

export function osFamilyOf(t: Target): OSFamily {
  if (t === "windows-x64") return "windows";
  if (t === "darwin-arm64" || t === "darwin-x64") return "mac";
  return "linux";
}
