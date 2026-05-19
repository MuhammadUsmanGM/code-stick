# Troubleshooting

Common issues hit during install, launch, or runtime. Search by symptom.

- [Model hallucinates or invents tool calls (v0.2.0 only — fixed in v0.2.1)](#model-hallucinates-or-invents-tool-calls)
- [Windows: `npm install` fails with node-gyp / MSB errors](#windows-npm-install-fails)
- [macOS: "ollama can't be opened, developer cannot be verified"](#macos-gatekeeper-blocks-the-launcher)
- [Linux/macOS: "Permission denied" launching from FAT32/exFAT](#linuxmacos-permission-denied-on-fat32exfat)
- [Windows: install aborts with "MAX_PATH risk"](#windows-max_path-risk)
- [Ollama port 11434 already in use](#ollama-port-11434-already-in-use)
- [Debugging an install](#debugging-an-install)
- [Reporting a bug](#reporting-a-bug)

---

## Model hallucinates or invents tool calls

**Affects:** code-stick v0.2.0. Fixed in v0.2.1.

**Symptom:** opencode launches fine, the model responds, but it invents file
paths, makes up function names, or fires malformed tool calls — even with
strong models like `qwen2.5-coder:32b`.

**Cause:** Ollama's server default context window is **2048 tokens**, which
is smaller than opencode's system prompt + 10 tool definitions (~3–4k
tokens) on its own. The model sees a truncated prompt and confabulates the
parts it never received. Bigger models hallucinate *more confidently* on
truncated input — which is why stronger models can feel worse than smaller
ones for this specific bug.

**Fix (v0.2.1):** code-stick now bakes a per-model `num_ctx` into every
pulled tag via `ollama create … PARAMETER num_ctx …`, sized to each model's
native training range (qwen2.5-coder → 32k, deepseek-coder → 16k,
phi3-mini → 8k, etc.). New installs get this automatically.

**Upgrading an existing v0.2.0 stick:**

```bash
npm i -g code-stick@latest
code-stick upgrade-engine --target <USB-path>
```

`upgrade-engine` swaps in the new launchers + opencode config and then
re-bakes every model already on the stick with the correct context window.
The model weight blobs are untouched — `ollama create` just rewrites the
manifest layer (tiny, seconds per model), so a re-bake on a 32 GB stick
finishes in well under a minute.

**Verify after the upgrade:**

```bash
# in a separate terminal while opencode is running
ollama show <your-tag> --modelfile
```

The output should contain a `PARAMETER num_ctx <number>` line with a value
≥ 8192. If it still shows 2048 or no `num_ctx` at all, `upgrade-engine` did
not re-bake — re-run with `CODE_STICK_DEBUG=1` and open an issue with the
log.

**Power users adding a raw Ollama tag can override per pull:**

```bash
code-stick add-model llama3.1:70b --num-ctx 32768
```

---

## Windows: `npm install` fails

**Symptom:** node-gyp or MSB errors during `npm install -g code-stick`.

**Cause:** `drivelist` (used for USB auto-detection) has native bindings.
Without Visual Studio Build Tools the prebuild-install step can fail.

**Fix — option 1:** Install **Visual Studio Build Tools 2022** with the
*Desktop development with C++* workload, then retry.

**Fix — option 2:** Skip auto-detection entirely. `code-stick install
--target E:\` does not need `drivelist`. The CLI warns and falls back to
manual path entry on its own if drivelist failed to load.

`drivelist` is declared as an **optional dependency**, so a build failure
should not abort `npm install` — it just disables auto-detection.

---

## macOS: Gatekeeper blocks the launcher

**Symptom:** "ollama can't be opened, developer cannot be verified" on
first launch from the USB.

**Cause:** Gatekeeper quarantines unsigned binaries that arrived via
"external media." code-stick is not yet notarized — notarization needs an
Apple Developer Program account (on the roadmap).

**Fix — option 1 (recommended):** Right-click `start-mac.command` → **Open**
→ **Open**. This adds a per-binary exception so future double-clicks work.

**Fix — option 2:** If the launcher exits with a "translocated to a
read-only sandbox" message, that's macOS App Translocation copying the
launcher to a randomized scratch mount before run. The right-click-Open
ritual above also clears it.

**Fix — option 3 (last resort):**

```bash
xattr -dr com.apple.quarantine /Volumes/<your-usb>
```

Neither launchers nor `code-stick install` itself are affected — only the
per-machine first-launch dialog. `code-stick doctor` runs the same probes
from a CLI context where Gatekeeper does not apply.

---

## Linux/macOS: Permission denied on FAT32/exFAT

**Symptom:** Launcher refuses to run with "Permission denied" or
"Operation not permitted."

**Cause:** FAT32 and exFAT cannot store the POSIX `+x` bit, so binaries
copied to such a stick lose executability. The installer warns about this
at install time.

**Workaround — invoke launchers via `bash`:**

```bash
bash start-linux.sh
bash start-mac.command
```

**Long-term fix:** Format the stick as **NTFS** (Windows + Linux) or
**APFS/HFS+** (macOS-only). Or stick with **exFAT** if you accept the
`bash` workaround for cross-OS use.

---

## Windows: MAX_PATH risk

**Symptom:** Installer aborts with "MAX_PATH risk" before doing any work.

**Cause:** Windows caps individual paths at 260 chars by default.
Pre-staged opencode dependencies live deep under
`<USB>\cache\opencode\node_modules\@ai-sdk\openai-compatible\dist\internal\...`,
and a USB mounted at a long path (e.g. `C:\Users\Long
Name\Downloads\code-stick-stage\`) overflows the limit mid-install. The
installer detects this up-front and refuses to start.

**Three fixes, in order of preference:**

1. **Mount the USB at a short path.** Assign a single drive letter via Disk
   Management, or `subst X: <current-path>` in Command Prompt, then re-run
   with `--target X:\`.
2. **Enable Win10 1607+ long paths system-wide** (PowerShell as Admin):
   ```powershell
   New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem `
     -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
   ```
   Reboot, then re-run the installer.
3. **Re-run from a shorter working directory.** The installer's host-side
   stage dir lives under `%TEMP%`; if your user profile path is itself
   long, point `TMP`/`TEMP` at `C:\t` and retry.

---

## Ollama port 11434 already in use

**Symptom:** Launcher refuses to start because port 11434 is taken.

**Cause:** A host-installed Ollama is already running, or a previous
session didn't shut down cleanly.

**Fix:** Stop your host's Ollama process first. The launchers refuse to
start a second instance on the same port — this is a safety feature, not a
bug. `code-stick doctor` can identify the offending process.

---

## Debugging an install

```bash
CODE_STICK_DEBUG=1 code-stick install --target E:\ --no-cleanup
```

`--no-cleanup` keeps `.code-stick-tmp/` and the downloaded archives so you
can inspect them.

---

## Reporting a bug

When `code-stick` crashes it writes a **redacted** report to your OS temp
dir (e.g. `%TEMP%\code-stick\bug-report-install-2026-...md`). The path is
printed to your terminal. The report has your home dir, hostname, USB
path, and common token shapes scrubbed before it is written. Open it,
eyeball it, then attach it to a new issue at
[github.com/MuhammadUsmanGM/code-stick/issues](https://github.com/MuhammadUsmanGM/code-stick/issues).

code-stick does **not** ship telemetry. No background HTTP calls, no
auto-reporting. Bug submission is fully manual and entirely under your
control. See [`SECURITY.md`](SECURITY.md) for the full trust model.
