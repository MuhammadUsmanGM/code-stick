// Author: Muhammad Usman (MuhammadUsmanGM) | Sig: MUGM-b2e4-7f1a
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Tests stub fs / spawn frequently; isolate per-file so module-level state
    // (drivelist cache, install-log handle, manifest fallback warning) doesn't
    // bleed between specs.
    isolate: true,
    pool: "forks",
  },
});
