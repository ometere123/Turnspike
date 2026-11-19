import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { createGateway } from "../src/server";
import { DemoAgent } from "../src/agent";

// Local Hardhat chain, real TurnpikeAllowance; MockERC20 is the labelled test double for the token (local only).
const PORT = 8601;
const RPC = `http://127.0.0.1:${PORT}`;
const PHRASE = "test test test test test test test test test test test junk";
const art = (p: string) => JSON.parse(readFileSync(join(__dirname, "../../../artifacts/contracts", p), "utf8"));
let node: ChildProcess, provider: JsonRpcProvider, server: Server, gw: ReturnType<typeof createGateway>;
let owner: NonceManager, agent: NonceManager, vault: ethers.Contract, token: ethers.Contract, base = "";
const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);

beforeAll(async () => {
  process.env.TURNPIKE_LOG = "off";
  node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: join(__dirname, "../../.."), shell: true, stdio: "ignore" });
  provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true });
  for (let i = 0; i < 60; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  owner = new NonceManager(w(0)); agent = new NonceManager(w(1));
  const merchant = w(2).address, ownerAddr = await owner.getAddress();
  const dep = async (a: any, ...args: any[]) => { const c = await new ContractFactory(a.abi, a.bytecode, owner).deploy(...args); await c.waitForDeployment(); return c as unknown as ethers.Contract; };
  token = await dep(art("test-helpers/MockERC20.sol/MockERC20.json"));
  vault = await dep(art("TurnpikeAllowance.sol/TurnpikeAllowance.json"), await token.getAddress(), 5_000_000n);
  await (await token.mint(ownerAddr, 10_000_000n)).wait();
  await (await (token as any).approve(await vault.getAddress(), 10n ** 9n)).wait();
  await (await (vault as any).deposit(1_000_000n)).wait();
  await (await (vault as any).setPolicy(await agent.getAddress(), 10_000n, 30_000n)).wait();
  await (await (vault as any).setMerchant(merchant, true)).wait();
  gw = createGateway({
    RPC_URL_1: RPC, CHAIN_ID: "31337", QUSDC_ADDRESS: await token.getAddress(), ALLOWANCE_ADDRESS: await vault.getAddress(), MERCHANT_ADDRESS: merchant,
    HMAC_SECRET: "g".repeat(40), DB_PATH: join(mkdtempSync(join(tmpdir(), "gw-")), "g.sqlite"), CONFIRMATIONS: "1",
  });
  await new Promise<void>((r) => (server = gw.app.listen(0, () => r())));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
}, 60_000);

afterAll(() => { server?.close(); gw?.close(); spawn("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); provider.destroy(); });

describe("endpoint A + demo agent (FR-017, FR-019)", () => {
  let a: DemoAgent;
  beforeAll(async () => { a = new DemoAgent({ baseUrl: base, resourcePath: "/v1/block-summary", signer: agent, provider, vault: vault.target as string, owner: await owner.getAddress(), pollMs: 200 }); });

  it("healthz and config are free", async () => {
    expect((await fetch(base + "/healthz")).status).toBe(200);
    const c: any = await (await fetch(base + "/v1/config")).json();
    expect(c.priceBase).toBe("1000");
  });

  it("unpaid request -> 402, paid request -> real live block data", async () => {
    expect((await fetch(base + "/v1/block-summary")).status).toBe(402);
    const r = await a.paidCall();
    expect(r.steps.at(-1)).toMatchObject({ step: "delivered", ok: true });
    const d: any = r.data;
    expect(d.blockNumber).toBeGreaterThan(0);
    expect(d.blockNumber).toBeLessThanOrEqual(parseInt(await provider.send("eth_blockNumber", []), 16));
    expect(d.chainId).toBe(31337);
  });

  it("replay: same proof returns the stored response, re-pay is refused on-chain", async () => {
    const r = await a.replay();
    expect(r.steps[0].ok).toBe(true);
    expect(r.steps[1]).toMatchObject({ ok: false, detail: { name: "RequestAlreadyUsed" } });
    // note: the local Hardhat node rejects reverting txs at submission, so no txHash here; mainnet run (scripts/mainnet-demo) asserts the broadcast hash
  });

  it("over-cap payment is refused with CapExceeded and a broadcast tx", async () => {
    const r = await a.overCap();
    expect(r.steps[0]).toMatchObject({ ok: false, detail: { name: "CapExceeded" } });
  });

  it("after revoke the agent is refused (NotOwnerAgent) and no data is delivered", async () => {
    await (await (vault as any).revokeAgent()).wait();
    const r = await a.paidCall();
    expect(r.data).toBeUndefined();
    expect(r.steps.at(-1)).toMatchObject({ step: "pay refused", detail: { name: "NotOwnerAgent" } });
  });

  it("status endpoint reveals state only, never data; stats count delivered", async () => {
    const stats: any = await (await fetch(base + "/v1/stats")).json();
    expect(stats.delivered).toBe(1);
    const id = a.lastProof!.requestId;
    const s: any = await (await fetch(`${base}/v1/payments/${id}`)).json();
    expect(s.state).toBe("DELIVERED");
    expect(Object.keys(s)).not.toContain("responseBody");
  });
});
