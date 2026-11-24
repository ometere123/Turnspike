// Local Hardhat chain, the real TurnpikeAllowance contract, a labelled mock token, and two RPC endpoints that can be made to fail.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, "../../..");
export const require = createRequire(join(root, "package.json"));
const { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager } = require("ethers");
const win = process.platform === "win32";
const art = (p) => JSON.parse(readFileSync(join(root, "artifacts/contracts", p), "utf8"));
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test phrase
export const CHAIN = 31337;
export const SECRET = "local-test-hmac-".repeat(4);
export const ADMIN = "local-test-admin-".repeat(4);

export function kill(p) {
  if (!p || p.exitCode !== null) return;
  try { if (win) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); else process.kill(-p.pid, "SIGKILL"); } catch { /* gone */ }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startChain(port) {
  const node = spawn(process.execPath, [join(root, "node_modules/hardhat/internal/cli/bootstrap.js"), "node", "--port", String(port)], { cwd: root, stdio: ["ignore", "ignore", "ignore"], detached: !win });
  const url = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(url, CHAIN, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; i < 120; i++) { try { await provider.send("eth_chainId", []); break; } catch { await sleep(500); } }
  const w = (i) => new NonceManager(HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider));
  const owner = w(0), agent = w(1), stranger = w(4);
  const merchant = await w(2).getAddress(), merchant2 = await w(3).getAddress(), ownerAddress = await owner.getAddress();
  const t = art("test-helpers/MockERC20.sol/MockERC20.json"), v = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  const token = await (await new ContractFactory(t.abi, t.bytecode, owner).deploy()).waitForDeployment();
  const deploy = async () => {
    const c = await (await new ContractFactory(v.abi, v.bytecode, owner).deploy(token.target, 5_000_000n)).waitForDeployment();
    await (await token.mint(ownerAddress, 5_000_000n)).wait();
    await (await token.approve(c.target, 10n ** 12n)).wait();
    await (await c.deposit(2_000_000n)).wait();
    await (await c.setPolicy(await agent.getAddress(), 100_000n, 1_000_000n)).wait();
    await (await c.setMerchant(merchant, true)).wait();
    await (await c.setMerchant(merchant2, true)).wait();
    return c;
  };
  const vault = await deploy(), other = await deploy();
  const pay = async (requestId, amount = 1000n, { to = merchant, on = vault } = {}) => { const tx = await on.connect(agent).pay(ownerAddress, to, requestId, amount); await tx.wait(); return tx.hash; };
  return { node, url, provider, owner, agent, stranger, ownerAddress, merchant, merchant2, token, vault, other, pay, mine: (n = 1) => provider.send("hardhat_mine", ["0x" + n.toString(16)]), balance: async () => (await vault.account(ownerAddress)).balance };
}

/** An RPC endpoint in front of the local node. `mode`: ok, down, hang, wrongchain, error, garbage. `hook` may rewrite one answer. */
export async function startRpc(port, target) {
  const s = { mode: "ok", hook: null, hold: null, calls: [], url: `http://127.0.0.1:${port}` };
  s.server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const q = JSON.parse(raw);
    s.calls.push(q.method);
    const reply = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    if (s.mode === "down") return void res.destroy();
    if (s.mode === "hang") return;
    if (s.mode === "garbage") return void res.end("<html>");
    if (s.mode === "error") return reply({ jsonrpc: "2.0", id: q.id, error: { code: -32000, message: "x" } });
    if (s.mode === "wrongchain" && q.method === "eth_chainId") return reply({ jsonrpc: "2.0", id: q.id, result: "0x1" });
    if (s.hold && (await s.hold(q)) === "drop") return;
    const real = await (await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: raw })).json();
    if (s.hook && real.result !== undefined) real.result = await s.hook(q, real.result);
    reply(real);
  });
  await new Promise((r) => s.server.listen(port, "127.0.0.1", r));
  return s;
}

export function makeGateway(c, rpcs, port, over = {}) {
  const dir = mkdtempSync(join(tmpdir(), "turnspike-cf-"));
  const g = {
    dir, url: `http://127.0.0.1:${port}`, proc: null,
    bindings: {
      PAYMENTS_ENABLED: "true", LEDGER_NAME: "test", RPC_URLS: rpcs.map((r) => r.url).join(","), CHAIN_ID: String(CHAIN), CONTRACT: c.vault.target, TOKEN: c.token.target, MERCHANT: c.merchant,
      CONFIRMATIONS: "1", CHALLENGE_TTL_SECONDS: "300", PAYMENT_GRACE_SECONDS: "1000000000", RETENTION_SECONDS: "604800", LEASE_SECONDS: "11", CHALLENGES_PER_DAY: "10000", RATE_LIMIT_PER_MINUTE: "1000",
      RECONCILE_FROM_BLOCK: "0", ALLOWED_ORIGINS: "https://turnspike-qie.vercel.app", OWN_ADDRESSES: "", EXPLORER: "http://localhost", HMAC_SECRET: SECRET, ADMIN_TOKEN: ADMIN, ...over,
    },
    async start(extra = {}) {
      g.bindings = { ...g.bindings, ...extra };
      const p = spawn(process.execPath, [join(here, "serve.mjs"), JSON.stringify({ port, script: join(here, "../dist/index.js"), persist: join(g.dir, "do"), bindings: g.bindings })], { stdio: ["ignore", "pipe", "pipe"], detached: !win });
      let out = "";
      p.stderr.on("data", (d) => { out += d; });
      await new Promise((res, rej) => {
        p.stdout.on("data", (d) => { out += d; if (String(d).includes("ready")) res(); });
        p.on("exit", () => rej(new Error("gateway exited: " + out)));
        setTimeout(() => rej(new Error("gateway did not start: " + out)), 30_000).unref();
      });
      g.proc = p; g.log = () => out;
      return g;
    },
    crash() { kill(g.proc); g.proc = null; },
    async restart(extra) { g.crash(); await sleep(400); return g.start(extra); },
    get: (path, headers = {}) => fetch(g.url + path, { headers }),
    proof: (ch, txHash, over = {}) => ({ "x-payment": Buffer.from(JSON.stringify({ requestId: ch.requestId, txHash, sig: ch.sig, ...over })).toString("base64") }),
    async challenge(path = "/v1/block-summary") { const r = await g.get(path); if (r.status !== 402) throw new Error(`expected 402, got ${r.status}: ${await r.text()}`); return r.json(); },
    admin: (path, init = {}) => fetch(g.url + "/admin" + path, { ...init, headers: { authorization: `Bearer ${ADMIN}`, ...(init.headers ?? {}) } }),
    reconcile: async () => (await g.admin("/reconcile", { method: "POST" })).json(),
    close() { g.crash(); try { rmSync(g.dir, { recursive: true, force: true }); } catch { /* a handle may linger */ } },
  };
  return g;
}
