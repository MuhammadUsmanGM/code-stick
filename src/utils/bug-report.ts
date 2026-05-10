// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b9r3-ep71
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { activeLogPath } from "./install-log.js";

declare const PKG_VERSION: string | undefined;
const version = typeof PKG_VERSION !== "undefined" ? PKG_VERSION : "dev";

/**
 * Local-only redacted error reporter.
 *
 * We deliberately do NOT ship telemetry to a server we own. Standing up a
 * privacy-compliant ingest endpoint, retention policy, and SLO is the wrong
 * spend for a 0.x project. Instead, when an install/launch crashes we:
 *
 *   1. Build a redacted snapshot of the error + relevant environment.
 *   2. Save it to a local file the user can attach to a GitHub issue.
 *   3. Print a one-line "open an issue at <url>" remediation.
 *
 * No network call. No PII leaks. The user has total control.
 *
 * Redaction rules (applied to message + stack):
 *   - Replace the user's home directory with $HOME.
 *   - Replace anything that looks like a USB drive path with $USB.
 *   - Replace machine hostname with $HOST.
 *   - Replace anything matching common token/key shapes with $REDACTED.
 *
 * Redaction is *defense in depth*: the goal is that a user can paste the
 * report straight into a public issue without re-reading it. False positives
 * (over-redaction) are fine; false negatives are not.
 */

export interface BugReportInputs {
  command: string;
  err: unknown;
  drivePath?: string | null;
}

export interface BugReportResult {
  /** Path on disk where the report was written, or null if writing failed. */
  filePath: string | null;
  /** Body of the report (redacted), suitable for piping into a GitHub issue. */
  body: string;
}

const ISSUE_URL = "https://github.com/MuhammadUsmanGM/code-stick/issues/new";

export function buildBugReport(inputs: BugReportInputs): BugReportResult {
  const { command, err, drivePath } = inputs;
  const e = err instanceof Error ? err : new Error(String(err));
  const home = os.homedir();
  const host = os.hostname();

  const redact = (s: string): string => {
    let out = s;
    if (home) out = out.split(home).join("$HOME");
    if (host) out = out.split(host).join("$HOST");
    if (drivePath) out = out.split(drivePath).join("$USB");
    // Token/key shapes — best effort, never claims to be exhaustive.
    out = out.replace(/(npm_[A-Za-z0-9_]{20,})/g, "$REDACTED_NPM_TOKEN");
    out = out.replace(/(ghp_[A-Za-z0-9]{30,})/g, "$REDACTED_GH_TOKEN");
    out = out.replace(/(sk-[A-Za-z0-9_-]{20,})/g, "$REDACTED_API_KEY");
    // Drive letters on Windows: anonymize anything outside the install target
    // by collapsing to <DRIVE>:\... form. We keep the structure for triage.
    out = out.replace(/[A-Za-z]:\\Users\\[^\\]+/g, "$HOME");
    return out;
  };

  const meta = {
    "code-stick": version,
    command,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: redact(os.release()),
    cwd: redact(process.cwd()),
    drivePath: drivePath ? "$USB" : null,
    activeLog: activeLogPath() ? "$USB/state/install.log" : null,
    timestamp: new Date().toISOString(),
  };

  const body = [
    "### code-stick bug report",
    "",
    "**Auto-generated. All paths and identifying info have been redacted. Review before posting.**",
    "",
    "#### Environment",
    "```json",
    JSON.stringify(meta, null, 2),
    "```",
    "",
    "#### Error",
    "```",
    redact(e.message || "(no message)"),
    "```",
    "",
    "#### Stack",
    "```",
    redact(e.stack || "(no stack)"),
    "```",
    "",
    "#### What I was doing",
    "<!-- Describe the steps you took before the error. -->",
    "",
    "#### Attached log",
    "<!-- If $USB/state/install.log exists, attach it as a file (it contains the full install trace). -->",
    "",
  ].join("\n");

  let filePath: string | null = null;
  try {
    const dir = path.join(os.tmpdir(), "code-stick");
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    filePath = path.join(dir, `bug-report-${command}-${ts}.md`);
    fs.writeFileSync(filePath, body, "utf-8");
  } catch {
    // tmpdir not writable — return body in-memory and let the caller print it.
    filePath = null;
  }

  return { filePath, body };
}

export function bugReportRemediation(report: BugReportResult): string[] {
  const lines = [
    "Something went wrong. To help us fix it:",
  ];
  if (report.filePath) {
    lines.push(`  1. Review the redacted report: ${report.filePath}`);
    lines.push(`  2. Open an issue with it: ${ISSUE_URL}`);
  } else {
    lines.push(`  1. Copy the redacted report below into a new issue:`);
    lines.push(`     ${ISSUE_URL}`);
  }
  lines.push("Set CODE_STICK_DEBUG=1 to also print the full untruncated stack to your terminal.");
  return lines;
}
