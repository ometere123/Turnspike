import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
const nm = (p: string) => resolve(__dirname, "node_modules", p);
// The repo's own sources (packages/middleware, packages/client) are imported unmodified from ../../packages; make them
// resolve their dependencies from this spike's pinned node_modules so exactly one copy of each library is used.
export default defineConfig({
  resolve: { alias: { ethers: nm("ethers"), zod: nm("zod"), "better-sqlite3": nm("better-sqlite3") } },
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 120_000, pool: "forks", fileParallelism: false },
});
