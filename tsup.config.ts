// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// Keep runtime deps unbundled. drivelist has native bindings that break when
// flattened; CJS-via-ESM deps (inquirer, got, tar, …) interop more reliably
// when Node resolves them itself than when esbuild rewrites them inline.
const RUNTIME_EXTERNAL = [
  "drivelist",
  "tar",
  "extract-zip",
  "got",
  "inquirer",
  "cli-progress",
  "ejs",
  "hasha",
  "tree-kill",
  "chalk",
  "commander",
];

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  external: RUNTIME_EXTERNAL,
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    "PKG_VERSION": JSON.stringify(pkg.version),
  },
});
