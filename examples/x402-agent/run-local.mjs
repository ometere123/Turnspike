// Starts a throwaway local Hardhat node, runs src/local-demo.ts against it, stops the node, and exits with the demo's code.
// Local chain only. From the repository root, after `npx hardhat compile` and `npm install` in packages/x402:
//   node examples/x402-agent/run-local.mjs
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const PORT = Number(process.env.HARDHAT_PORT ?? 8662);
const RPC = `http://127.0.0.1:${PORT}`;
const win = process.platform === "win32";

const node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: root, shell: true, stdio: "ignore", detached: !win });
const stop = () => {
  try {
    if (win) spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
    else process.kill(-node.pid, "SIGKILL");
  } catch { /* already gone */ }
};

async function waitForNode() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`hardhat node did not start on ${RPC}`);
}

let code = 1;
try {
  await waitForNode();
  // tsx from packages/x402 runs the TypeScript sources; the example tsconfig maps @turnspike-qie/* to the workspace sources.
  const tsx = join(root, "packages/x402/node_modules/tsx/dist/cli.mjs");
  const r = spawnSync(process.execPath, [tsx, join(here, "src/local-demo.ts")], {
    cwd: here, stdio: "inherit",
    env: { ...process.env, RPC_URL: RPC, TURNSPIKE_LOG: process.env.TURNSPIKE_LOG ?? "off", TSX_TSCONFIG_PATH: join(here, "tsconfig.json") },
  });
  code = r.status ?? 1;
} catch (e) {
  console.error(e?.message ?? e);
} finally {
  stop();
}
process.exit(code);
