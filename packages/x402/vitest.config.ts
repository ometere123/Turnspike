import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
const nm = (p: string) => resolve(__dirname, "node_modules", p);
// Sources of packages/middleware and packages/client are used unmodified; resolve their libraries from this package so
// one copy of each is used. Tests are *.spec.ts so the repository-root vitest run does not pick them up.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@turnspike-qie\/middleware\/(.*)$/, replacement: resolve(__dirname, "../middleware/src/$1") },
      { find: /^@turnspike-qie\/middleware$/, replacement: resolve(__dirname, "../middleware/src/index.ts") },
      { find: /^@turnspike-qie\/client$/, replacement: resolve(__dirname, "../client/src/index.ts") },
      { find: /^ethers$/, replacement: nm("ethers") },
      { find: /^zod$/, replacement: nm("zod") },
      { find: /^better-sqlite3$/, replacement: nm("better-sqlite3") },
    ],
  },
  test: { include: ["test/**/*.spec.ts"], testTimeout: 90_000, hookTimeout: 180_000, pool: "forks", fileParallelism: false },
});
