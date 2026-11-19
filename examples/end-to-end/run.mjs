// Complete two-sided Turnspike flow on a throwaway local chain, using the BUILT packages (dist), as an external user would:
//   seller: an Express API protected by @turnspike/middleware
//   owner:  funds an allowance account and sets limits on the real TurnpikeAllowance contract
//   agent:  buys the resource with @turnspike/client under an explicit spending policy
// The ERC-20 here is MockERC20, a labelled test double; nothing touches mainnet.
// Run from the repository root after `npx hardhat compile` and building packages/middleware and packages/client:
//   node examples/end-to-end/run.mjs
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

process.env.TURNSPIKE_LOG ??= "off";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "package.json"));
const { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager } = require("ethers");
const express = require("express");
const { turnspike } = require(join(root, "packages/middleware/dist/index.js"));
const { TurnspikeClient, MemoryJournal, formatUnits } = require(join(root, "packages/client/dist/index.js"));

const PORT = 8661, RPC = `http://127.0.0.1:${PORT}`;
const art = (p) => JSON.parse(readFileSync(join(root, "artifacts/contracts", p), "utf8"));
const log = (s) => console.log(s);

const win = process.platform === "win32";
const node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: root, shell: true, stdio: "ignore", detached: !win });
const stop = () => { try { if (win) spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); else process.kill(-node.pid, "SIGKILL"); } catch { /* already gone */ } };
let server;
try {
  const provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; i < 80; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const phrase = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
  const w = (i) => HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
  const owner = new NonceManager(w(0)), agent = new NonceManager(w(1)), merchant = w(2).address;
  const ownerAddr = await owner.getAddress();

  const t = art("test-helpers/MockERC20.sol/MockERC20.json"), v = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  const token = await (await new ContractFactory(t.abi, t.bytecode, owner).deploy()).waitForDeployment();
  const vault = await (await new ContractFactory(v.abi, v.bytecode, owner).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment();
  log(`1. contracts deployed: allowance ${vault.target}, test token ${token.target}`);

  // Owner: fund and set limits (in production this is done in the web console with a wallet).
  await (await token.mint(ownerAddr, 10_000_000n)).wait();
  await (await token.approve(vault.target, 10n ** 12n)).wait();
  await (await vault.deposit(1_000_000n)).wait();
  await (await vault.setPolicy(await agent.getAddress(), 10_000n, 30_000n)).wait();
  await (await vault.setMerchant(merchant, true)).wait();
  log(`2. owner funded 1 QUSDC, agent per-call cap 0.01, daily cap 0.03, merchant allowlisted`);

  // Seller: an ordinary Express API with one priced route.
  const mw = turnspike({
    rpcUrls: [RPC], chainId: 31337, contract: vault.target, token: token.target, merchant, hmacSecrets: ["e2e-".repeat(10)],
    dbPath: join(mkdtempSync(join(tmpdir(), "e2e-")), "seller.sqlite"), confirmations: 1,
    prices: { "/forecast/:city": { priceBase: 2500, validate: (req) => (/^[a-z-]{2,40}$/.test(req.params?.city ?? req.path.split("/")[2]) ? null : "unknown_city") } },
  });
  const app = express();
  app.use("/v1", mw);
  app.get("/v1/forecast/:city", (req, res) => res.json({ city: req.params.city, tomorrow: "sunny", source: "example seller" }));
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  log(`3. seller API listening on ${base}, /v1/forecast/:city costs 0.0025 QUSDC`);

  // Agent: explicit trust policy; it will not pay anyone else.
  const client = new TurnspikeClient({
    signer: agent, owner: ownerAddr, confirmations: 1, journal: new MemoryJournal(),
    network: { name: "local", chainId: 31337, contract: vault.target, token: token.target, decimals: 6, rpcUrls: [RPC], explorer: "http://localhost" },
    policy: { payees: [{ origin: base, merchant }], maxPriceBase: 5_000n },
  });
  const before = (await vault.account(ownerAddr)).balance;
  const r = await client.fetch(`${base}/v1/forecast/lagos`, {}, { idempotencyKey: "e2e-1" });
  if (!r.ok || r.kind !== "paid") throw new Error(`purchase failed: ${JSON.stringify(r, (_k, x) => (typeof x === "bigint" ? x.toString() : x))}`);
  const body = await r.response.json();
  log(`4. agent paid ${formatUnits(r.payment.priceBase)} QUSDC (tx ${r.payment.txHash}) and received ${JSON.stringify(body)}`);
  const again = await client.fetch(`${base}/v1/forecast/lagos`, {}, { idempotencyKey: "e2e-1" });
  const after = (await vault.account(ownerAddr)).balance;
  if (!again.ok || !again.replayed || before - after !== 2500n) throw new Error("repeat purchase should replay without paying again");
  log(`5. repeating the purchase replayed the stored response; owner was charged once (${formatUnits(before - after)} QUSDC)`);
  const bad = await fetch(`${base}/v1/forecast/LAGOS!`);
  if (bad.status !== 400) throw new Error(`invalid input should be 400, got ${bad.status}`);
  const pricey = await new TurnspikeClient({ ...client["o"], policy: { payees: [{ origin: base, merchant }], maxPriceBase: 1000n } }).fetch(`${base}/v1/forecast/abuja`);
  if (pricey.ok || pricey.error !== "price_above_max") throw new Error("price ceiling not enforced");
  log(`6. invalid input refused with 400 before any quote; a price over the agent's ceiling was refused before paying`);
  log("END-TO-END OK");
  mw.close();
  provider.destroy();
} catch (e) {
  console.error("END-TO-END FAILED:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  server?.close();
  stop();
}
