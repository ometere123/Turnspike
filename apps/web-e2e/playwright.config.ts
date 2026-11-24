import { defineConfig } from "@playwright/test";

// Started by run.mjs, which supplies the local chain, the gateway and the production build. Serial: the tests share one chain.
export default defineConfig({
  testDir: "./tests",
  testIgnore: "live.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results/results.json" }]],
  outputDir: "results/artifacts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
});
