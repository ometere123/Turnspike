import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
