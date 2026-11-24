import { defineConfig } from "@playwright/test";

// Read-only checks of a deployed site (preview or production). LIVE_URL is required. No wallet, no payment, no demo run.
export default defineConfig({
  testDir: "./tests",
  testMatch: "live.spec.ts",
  workers: 1,
  timeout: 90_000,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results/live-results.json" }]],
  outputDir: "results/live-artifacts",
  use: { baseURL: process.env.LIVE_URL, trace: "retain-on-failure", viewport: { width: 1440, height: 900 } },
});
