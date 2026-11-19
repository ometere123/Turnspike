import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { createGateway, loadEnv } from "../src/server";
import { DemoAgent } from "../src/agent";

// Local Hardhat chain with the real TurnpikeAllowance. MockERC20 is the labelled test double for the token (local chain only).
// The mnemonic is the public Hardhat test phrase; its keys hold no real value.
const PORT = 8602;
const RPC = `http://127.0.0.1:${PORT}`;
const PHRASE = "test test test test test test test test test test test junk";
const art = (p: string) => JSON.parse(readFileSync(join(__dirname, "../../../artifacts/contracts", p), "utf8"));
let node: ChildProcess, provider: JsonRpcProvider;
let owner: NonceManager, agent: NonceManager, vault: ethers.Contract, token: ethers.Contract, merchant: string, ownerAddr: string;
const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const servers: { server: Server; close: () => void }[] = [];

const solve = (token: string, bits: number) => {
  const [salt] = token.split(".");
  for (let n = 0; ; n++) {
    const d = createHash("sha256").update(`${salt}:${n}`).digest();
    let z = 0;
    for (const b of d) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
    if (z >= bits) return `${token}.${n}`;
  }
};

async function boot(extra: Record<string, string> = {}) {
  const port = 8620 + servers.length; // the demo agent calls the gateway over HTTP, so it needs a known address
  const gw = createGateway({
    RPC_URL_1: RPC, CHAIN_ID: "31337", QUSDC_ADDRESS: await token.getAddress(), ALLOWANCE_ADDRESS: await vault.getAddress(), MERCHANT_ADDRESS: merchant,
    HMAC_SECRET: "d".repeat(40), DB_PATH: join(mkdtempSync(join(tmpdir(), "demo-")), "d.sqlite"), CONFIRMATIONS: "1",
    DEMO_AGENT_KEY: w(1).privateKey, DEMO_OWNER: ownerAddr, DEMO_POW_BITS: "8", DEMO_PER_IP_HOUR: "2", DEMO_PER_IP_DAY: "10", DEMO_TX_PER_DAY: "100",
    DEMO_MIN_AGENT_GAS_WEI: "1", PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, ...extra,
  });
  const server = await new Promise<Server>((r) => { const s = gw.app.listen(port, () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  servers.push({ server, close: gw.close });
  return { base, gw };
}
const run = async (base: string, scenario: string, ip: string, bits = 8) => {
  const ch = await (await fetch(`${base}/demo/challenge`, { headers: { "x-forwarded-for": ip } })).json();
  return fetch(`${base}/demo/run/${scenario}`, { method: "POST", headers: { "x-forwarded-for": ip, "x-demo-pow": solve(ch.token, bits) } });
};

beforeAll(async () => {
  process.env.TURNPIKE_LOG = "off";
  node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: join(__dirname, "../../.."), shell: true, stdio: "ignore" });
  provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true });
  for (let i = 0; i < 60; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  owner = new NonceManager(w(0)); agent = new NonceManager(w(1));
  merchant = w(2).address; ownerAddr = await owner.getAddress();
  const dep = async (a: any, ...args: any[]) => { const c = await new ContractFactory(a.abi, a.bytecode, owner).deploy(...args); await c.waitForDeployment(); return c as unknown as ethers.Contract; };
  token = await dep(art("test-helpers/MockERC20.sol/MockERC20.json"));
  vault = await dep(art("TurnpikeAllowance.sol/TurnpikeAllowance.json"), await token.getAddress(), 5_000_000n);
  await (await token.mint(ownerAddr, 10_000_000n)).wait();
  await (await (token as any).approve(await vault.getAddress(), 10n ** 9n)).wait();
  await (await (vault as any).deposit(1_000_000n)).wait();
  await (await (vault as any).setPolicy(await agent.getAddress(), 10_000n, 100_000n)).wait();
  await (await (vault as any).setMerchant(merchant, true)).wait();
}, 60_000);

afterAll(() => {
  for (const s of servers) { s.server.close(); try { s.close(); } catch { /* already closed */ } }
  spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  provider.destroy();
});

describe("public demo guard", () => {
  it("rejects runs without a solved puzzle, and a puzzle cannot be reused or moved to another client", async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/demo/run/allowed`, { method: "POST" })).status).toBe(403);
    const ch = await (await fetch(`${base}/demo/challenge`, { headers: { "x-forwarded-for": "10.0.0.1" } })).json();
    const pow = solve(ch.token, 8);
    const wrong = await fetch(`${base}/demo/run/unauthorized-merchant`, { method: "POST", headers: { "x-forwarded-for": "10.0.0.2", "x-demo-pow": pow } });
    expect((await wrong.json()).error).toBe("pow_wrong_client");
    const bad = await fetch(`${base}/demo/run/unauthorized-merchant`, { method: "POST", headers: { "x-forwarded-for": "10.0.0.1", "x-demo-pow": ch.token + ".!!" } });
    expect((await bad.json()).error).toBe("pow_invalid");
    const good = await fetch(`${base}/demo/run/unauthorized-merchant`, { method: "POST", headers: { "x-forwarded-for": "10.0.0.1", "x-demo-pow": pow } });
    expect(good.status).toBe(200);
    const again = await fetch(`${base}/demo/run/unauthorized-merchant`, { method: "POST", headers: { "x-forwarded-for": "10.0.0.1", "x-demo-pow": pow } });
    expect((await again.json()).error).toBe("pow_used");
  });

  it("the unauthorized-merchant scenario shows the contract's real refusal without a transaction", async () => {
    const { base } = await boot();
    const before = await provider.send("eth_blockNumber", []);
    const r = await run(base, "unauthorized-merchant", "10.1.0.1");
    const body: any = await r.json();
    expect(body.steps[0]).toMatchObject({ ok: false, detail: { name: "MerchantNotAllowed", simulated: true } });
    expect(await provider.send("eth_blockNumber", [])).toBe(before); // eth_call only: no block was mined
  });

  it("per-client quota returns 429 with retry-after, while another client is unaffected", async () => {
    const { base } = await boot({ DEMO_PER_IP_HOUR: "2" });
    expect((await run(base, "unauthorized-merchant", "10.2.0.1")).status).toBe(200);
    expect((await run(base, "unauthorized-merchant", "10.2.0.1")).status).toBe(200);
    const third = await run(base, "unauthorized-merchant", "10.2.0.1");
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: "quota_exceeded", scope: "ip_hour" });
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await run(base, "unauthorized-merchant", "10.2.0.2")).status).toBe(200);
  });

  it("the global transaction budget caps total spend across all clients", async () => {
    const { base } = await boot({ DEMO_TX_PER_DAY: "2", DEMO_PER_IP_HOUR: "9" });
    expect((await run(base, "over-cap", "10.3.0.1")).status).toBe(200);
    expect((await run(base, "over-cap", "10.3.0.2")).status).toBe(200);
    const blocked = await run(base, "over-cap", "10.3.0.3");
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).scope).toBe("global_day");
    expect((await run(base, "unauthorized-merchant", "10.3.0.4")).status).toBe(200); // simulations cost no transactions
  });

  it("refuses to run when the agent's gas balance is below the floor", async () => {
    const { base, gw } = await boot({ DEMO_MIN_AGENT_GAS_WEI: "1" + "0".repeat(30) });
    const r = await run(base, "over-cap", "10.4.0.1");
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("demo_funds_low");
    expect(gw.guard.status().runsLast24h).toBe(0); // a run refused for lack of gas does not use up the visitor's quota
  });

  it("kill switch: DEMO_ENABLED=false disables every demo route", async () => {
    const { base } = await boot({ DEMO_ENABLED: "false" });
    expect((await fetch(`${base}/demo/challenge`)).status).toBe(404);
    expect((await fetch(`${base}/demo/run/allowed`, { method: "POST" })).status).toBe(404);
    expect(await (await fetch(`${base}/demo/status`)).json()).toEqual({ enabled: false });
  });

  it("rejects unknown scenarios and invalid configuration with readable errors", async () => {
    const { base } = await boot();
    expect((await run(base, "drain-everything", "10.5.0.1")).status).toBe(400);
    expect(() => loadEnv({ RPC_URL_1: "nope" })).toThrow(/Invalid gateway configuration/);
    expect(() => loadEnv({ RPC_URL_1: RPC, CHAIN_ID: "31337", QUSDC_ADDRESS: "0x1", ALLOWANCE_ADDRESS: "0x2", MERCHANT_ADDRESS: "0x3", HMAC_SECRET: "short", DB_PATH: "x" })).toThrow(/HMAC_SECRET/);
  });
});

describe("second paid endpoint: /v1/address/:address", () => {
  it("delivers live balances, and a proof for one address never unlocks another", async () => {
    const { base } = await boot({ DEMO_ENABLED: "false" });
    const target = w(5).address;
    const a1 = new DemoAgent({ baseUrl: base, resourcePath: `/v1/address/${target}`, signer: agent, provider, vault: vault.target as string, owner: ownerAddr, pollMs: 200 });
    const r = await a1.paidCall();
    expect(r.steps.at(-1)).toMatchObject({ step: "delivered", ok: true });
    const d: any = r.data;
    expect(d.address).toBe(target);
    expect(d.qusdcBaseUnits).toBe((await token.balanceOf(target)).toString());
    expect(d.qieWei).toBe((await provider.getBalance(target)).toString());
    expect(d.isContract).toBe(false);
    // present that proof against a different address: refused
    const other = w(6).address;
    const proof = Buffer.from(JSON.stringify(a1.lastProof)).toString("base64");
    const stolen = await fetch(`${base}/v1/address/${other}`, { headers: { "x-payment": proof } });
    expect(stolen.status).toBe(403);
    expect((await fetch(`${base}/v1/address/not-an-address`)).status).toBe(402); // price is asked first; validation happens after payment
  });
});
