// Browser tests of the production web build against a LOCAL chain (Hardhat, reporting chain 1990 so the app's network
// checks pass), the real TurnpikeAllowance contract, a labelled mock token, and a real local gateway on disposable SQLite.
// Nothing touches QIE Mainnet. Run after: root npm ci, `npx hardhat compile`, building packages/client, npm ci in apps/web
// and here, and `npx playwright install chromium` here.
//   node apps/web-e2e/run.mjs [playwright arguments]      SKIP_BUILD=1 reuses apps/web/.next from a previous run
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const web = join(root, "apps/web");
const require = createRequire(join(root, "package.json"));
const { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager } = require("ethers");
const win = process.platform === "win32";

const RPC_PORT = 8945, GW_PORT = 8946, WEB_PORT = 3100;
const RPC = `http://127.0.0.1:${RPC_PORT}`, GW = `http://127.0.0.1:${GW_PORT}`;
// Deterministic: the first two contracts deployed by Hardhat account 0. The web build needs them before they exist.
const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3", VAULT = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test phrase
const account = (i, p) => { const w = HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`); return p ? w.connect(p) : w; };
const MERCHANT = account(3).address;

const procs = [];
const tmp = mkdtempSync(join(tmpdir(), "turnspike-e2e-"));
function start(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { detached: !win, stdio: ["ignore", "pipe", "pipe"], ...opts });
  let log = "";
  const keep = (d) => { log = (log + d).slice(-8000); };
  p.stdout.on("data", keep);
  p.stderr.on("data", keep);
  p.tail = () => log;
  procs.push(p);
  return p;
}
function stopAll() {
  for (const p of procs.reverse()) {
    try { if (win) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); else process.kill(-p.pid, "SIGKILL"); } catch { /* gone */ }
  }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* a handle may linger on Windows */ }
}
async function up(url, p, init) {
  for (let i = 0; i < 160; i++) {
    if (p.exitCode !== null) throw new Error(`process exited early:\n${p.tail()}`);
    try { const r = await fetch(url, init); if (r.status < 500) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not start:\n${p.tail()}`);
}
async function portFree(port) {
  try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1500) }); return false; } catch (e) { return e?.name !== "TimeoutError"; }
}
const art = (p) => JSON.parse(readFileSync(join(root, "artifacts/contracts", p), "utf8"));
const bin = (dir, ...p) => join(dir, "node_modules", ...p);

let code = 1;
try {
  for (const p of [RPC_PORT, GW_PORT, WEB_PORT]) if (!(await portFree(p))) throw new Error(`port ${p} is in use; stop whatever holds it first`);

  const node = start(process.execPath, [bin(root, "hardhat/internal/cli/bootstrap.js"), "--config", "hardhat.e2e.config.ts", "node", "--port", String(RPC_PORT)], { cwd: root });
  await up(RPC, node, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
  const provider = new JsonRpcProvider(RPC, 1990, { staticNetwork: true, cacheTimeout: -1 });
  const deployer = new NonceManager(account(0, provider));
  const t = art("test-helpers/MockERC20.sol/MockERC20.json"), v = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  const token = await (await new ContractFactory(t.abi, t.bytecode, deployer).deploy()).waitForDeployment();
  const vault = await (await new ContractFactory(v.abi, v.bytecode, deployer).deploy(TOKEN, 5_000_000n)).waitForDeployment();
  if (token.target !== TOKEN || vault.target !== VAULT) throw new Error("unexpected deployment addresses");
  for (const i of [0, 1, 2]) await (await token.mint(account(i).address, 100_000_000n)).wait();

  // The gateway itself, compiled the way its image is, on disposable data.
  const gwDir = join(tmp, "gw");
  const built = spawnSync(process.execPath, [bin(root, "typescript/bin/tsc"), "-p", "tsconfig.build.json", "--outDir", gwDir], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) throw new Error("gateway build failed");
  const gw = start(process.execPath, [join(gwDir, "apps/gateway/src/server.js")], {
    cwd: root,
    env: {
      ...process.env, NODE_PATH: join(root, "node_modules"), PORT: String(GW_PORT), RPC_URL_1: RPC, CHAIN_ID: "1990", QUSDC_ADDRESS: TOKEN, ALLOWANCE_ADDRESS: VAULT,
      MERCHANT_ADDRESS: MERCHANT, HMAC_SECRET: randomBytes(32).toString("hex"), DB_PATH: join(tmp, "gw.sqlite"), CONFIRMATIONS: "1", RECONCILE: "false", DEMO_ENABLED: "false", TURNSPIKE_LOG: "off",
    },
  });
  await up(`${GW}/healthz`, gw);

  // A separate owner (account 5) makes one purchase through the built client SDK: 402, pay, verified, 200. Used by the Operations tests.
  const { TurnspikeClient, MemoryJournal } = require(join(root, "packages/client/dist/index.js"));
  const owner = new NonceManager(account(5, provider)), agent = new NonceManager(account(6, provider));
  await (await token.mint(account(5).address, 10_000_000n)).wait();
  await (await token.connect(owner).approve(VAULT, 10_000_000n)).wait();
  await (await vault.connect(owner).deposit(1_000_000n)).wait();
  await (await vault.connect(owner).setPolicy(account(6).address, 10_000n, 100_000n)).wait();
  await (await vault.connect(owner).setMerchant(MERCHANT, true)).wait();
  const client = new TurnspikeClient({
    signer: agent, owner: account(5).address, confirmations: 1, journal: new MemoryJournal(),
    network: { name: "local", chainId: 1990, contract: VAULT, token: TOKEN, decimals: 6, rpcUrls: [RPC], explorer: "http://localhost" },
    policy: { payees: [{ origin: GW, merchant: MERCHANT }], maxPriceBase: 10_000n },
  });
  const bought = await client.fetch(`${GW}/v1/block-summary`, {}, { idempotencyKey: "e2e-1" });
  if (!bought.ok || bought.kind !== "paid") throw new Error(`local purchase failed: ${bought.error ?? bought.kind}`);

  // Two transactions that are not payments: a plain transfer, and a payment the contract refuses.
  const plain = await (await account(4, provider).sendTransaction({ to: account(7).address, value: 1n })).wait();
  // Automine rejects a reverting transaction at submission, so mine this one by hand to get its real reverted receipt.
  await provider.send("evm_setAutomine", [false]);
  const refused = await vault.connect(agent).pay(account(5).address, MERCHANT, "0x" + "11".repeat(32), 20_000n, { gasLimit: 300_000n });
  await provider.send("hardhat_mine", ["0x1"]);
  await provider.send("evm_setAutomine", [true]);
  await provider.send("hardhat_mine", ["0x5"]);
  await provider.send("evm_setIntervalMining", [10_000]); // a live chain keeps moving; an idle head would (correctly) be reported as stale

  if (!process.env.SKIP_BUILD) {
    const b = spawnSync("npm", ["run", "build"], {
      cwd: web, shell: true, stdio: "inherit",
      env: { ...process.env, NEXT_PUBLIC_CHAIN_ID: "1990", NEXT_PUBLIC_RPC_URL: RPC, NEXT_PUBLIC_ALLOWANCE_ADDRESS: VAULT, NEXT_PUBLIC_QUSDC_ADDRESS: TOKEN, NEXT_PUBLIC_MERCHANT_ADDRESS: MERCHANT, NEXT_PUBLIC_DEPLOY_BLOCK: "1", NEXT_PUBLIC_GATEWAY_URL: GW },
    });
    if (b.status !== 0) throw new Error("web build failed");
  }
  const site = start(process.execPath, [bin(web, "next/dist/bin/next"), "start", "-p", String(WEB_PORT)], { cwd: web });
  await up(`http://127.0.0.1:${WEB_PORT}/`, site);

  mkdirSync(join(here, "results"), { recursive: true });
  const git = (...a) => spawnSync("git", a, { cwd: root }).stdout.toString().trim();
  const dirty = git("status", "--porcelain", "--", "apps", "packages", "contracts") !== "";
  console.log(`commit ${git("rev-parse", "HEAD")}${dirty ? " (with uncommitted changes)" : ""}, ${new Date().toISOString()}`);
  const record = process.argv[2] === "record"; // see record.mjs; RECORD_TERMINAL is the saved output of examples/end-to-end/run.mjs
  // Not spawnSync: that would stop this process from draining the output of the node and the servers, and block them.
  const child = spawn(process.execPath, record ? [join(here, "record.mjs"), "local"] : [bin(here, "@playwright/test/cli.js"), "test", ...process.argv.slice(2)], {
    cwd: here, stdio: "inherit",
    env: { ...process.env, E2E_BASE_URL: `http://127.0.0.1:${WEB_PORT}`, E2E_RPC: RPC, E2E_GW: GW, E2E_TOKEN: TOKEN, E2E_VAULT: VAULT, E2E_MERCHANT: MERCHANT, E2E_PAID_TX: bought.payment.txHash, E2E_PAID_ID: bought.payment.requestId, E2E_PLAIN_TX: plain.hash, E2E_REVERT_TX: refused.hash },
  });
  code = await new Promise((res) => child.on("exit", (c) => res(c ?? 1)));
} catch (e) {
  console.error(e);
} finally { stopAll(); }
process.exit(code);
