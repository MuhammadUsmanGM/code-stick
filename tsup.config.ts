// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { defineConfig } from "tsup";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// Keep every runtime dep external so tsup never inlines a CJS module that
// uses `require()` into the ESM bundle. Bundling `drivelist` (CJS + native
// bindings) into ESM produced "Dynamic require of fs is not supported" at
// runtime — the safe fix is to leave node_modules alone and resolve at runtime.
const externals = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
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
  external: externals,
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    "PKG_VERSION": JSON.stringify(pkg.version),
  },
});
