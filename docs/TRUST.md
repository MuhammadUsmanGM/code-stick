# The code-stick Trust Model

`code-stick` is built for environments where security, privacy, and host integrity are non-negotiable. This document outlines the five pillars of trust that ensure your host machine remains clean, your code stays private, and the binaries you run are exactly what you expect.

---

## 1. Zero Residue (Environment Isolation)
The "Zero Install" promise is enforced by strict environment isolation. When you launch `code-stick` from a USB:
*   **Redirected Configs:** All application configurations are redirected to `<USB>/config`.
*   **Isolated Caches:** Temporary files and npm caches are pinned to `<USB>/cache`.
*   **Local State:** Runtime logs and internal state are stored in `<USB>/state`.
*   **Result:** No files are written to your `AppData`, `Documents`, or `~/.config` folders. Your host remains as clean as it was before you plugged in the stick.

## 2. 100% Offline (Airgapped by Design)
The tool is designed to work in restricted environments (banks, defense, hospitals).
*   **No Telemetry:** There are zero background "pings," analytics, or heartbeat calls.
*   **Pre-staged Dependencies:** Every runtime dependency needed for the AI agent to work is pre-staged onto the USB during the initial install.
*   **Local Inference:** All model weights live on the USB and run on the host's RAM/GPU without ever reaching out to the internet.

## 3. Privacy-Preserving Bug Reports
We believe you shouldn't have to leak your identity to report a bug.
*   **Automatic Redaction:** Our crash reporter automatically scrubs your home directory path, hostname, USB drive letters, and common API key patterns (`sk-`, `npm_`, `ghp_`) before the report ever touches your disk.
*   **Manual Upload Only:** Reports are saved to your local temp directory for your review. `code-stick` will **never** auto-upload a report. You are in total control of what you share.

## 4. Binary Integrity & Pinned Hashes
Every binary we ship is a verifiable "unit of trust."
*   **SHA-256 Verification:** The installer pins every version of Ollama and opencode with a cryptographic SHA-256 hash.
*   **Tamper Protection:** If a download is corrupted or tampered with in transit, the installer will immediately detect the mismatch and abort the installation.
*   **Verifiable Pins:** You can cross-check our pins directly against the upstream GitHub releases for both projects.

## 5. Transparent & Verifiable
Security should not be a "black box."
*   **Open Source:** The entire `code-stick` logic is under 5,000 lines of TypeScript, making it easy to audit in an afternoon.
*   **Plain Text Launchers:** The scripts that start the agent (`.bat`, `.sh`, `.command`) are plain text. You can open them in any editor to see exactly how environment variables are being set and which processes are being spawned.
*   **Self-Audit Guide:** Our `SECURITY.md` file provides a "cheat sheet" of where to look in the source code to verify every security claim we make.

---

For a deep dive into the technical implementation and threat model, see [SECURITY.md](./SECURITY.md).
