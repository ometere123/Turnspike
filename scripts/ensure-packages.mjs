#!/usr/bin/env node
// Installs and builds the workspace packages that other parts of the repository import, so a fresh clone can run
// `npm test` at the root and `npm run typecheck|build|test` in apps/mcp-cf without the manual steps CI performs.
// Idempotent: a package that already has node_modules (and dist, where it is built) is left alone.
//   node scripts/ensure-packages.mjs            client, cli and mcp (what the root tests need)
//   node scripts/ensure-packages.mjs client mcp only those packages
//   node scripts/ensure-packages.mjs chain      root install present and contracts compiled (local-chain tests)
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// build: whether other code imports the package's compiled dist (tests run the built mcp server and client).
const PACKAGES = { client: { build: true }, cli: { build: false }, mcp: { build: true } };

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PACKAGES);
for (const name of wanted) {
  if (name === "chain") {
    // Tests that start a local Hardhat chain need the root install and compiled contract artifacts.
    if (!existsSync(join(root, "node_modules", "hardhat"))) {
      console.error("ensure-packages: the repository root is not installed. Run `npm ci` in the repository root first (on Windows without Visual Studio build tools: `npm ci --ignore-scripts`).");
      process.exit(1);
    }
    if (!existsSync(join(root, "artifacts", "contracts"))) {
      console.log("ensure-packages: compiling contracts (npx hardhat compile)");
      const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["hardhat", "compile"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
      if (r.status !== 0) process.exit(r.status ?? 1);
    }
    continue;
  }
  if (!(name in PACKAGES)) { console.error(`ensure-packages: unknown package "${name}" (known: ${Object.keys(PACKAGES).join(", ")}, chain)`); process.exit(2); }
  const dir = join(root, "packages", name);
  const run = (...args) => {
    console.log(`ensure-packages: packages/${name}: npm ${args.join(" ")}`);
    const r = spawnSync(npm, args, { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) { console.error(`ensure-packages: packages/${name}: npm ${args.join(" ")} failed`); process.exit(r.status ?? 1); }
  };
  if (!existsSync(join(dir, "node_modules"))) run(existsSync(join(dir, "package-lock.json")) ? "ci" : "install", "--no-audit", "--no-fund");
  if (PACKAGES[name].build && !existsSync(join(dir, "dist"))) run("run", "build");
}
