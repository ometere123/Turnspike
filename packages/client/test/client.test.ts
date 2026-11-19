import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { AbstractSigner, ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, Wallet, ethers, makeError } from "ethers";
import { turnspike } from "../../middleware/src";
import { TurnspikeClient, FileJournal, MemoryJournal, type Network, type JournalRecord, type ClientOptions } from "../src";

// Local Hardhat chain, the real settlement contract and the real seller middleware. The ERC-20 is the labelled MockERC20
// test double (local chain only). Nothing here touches mainnet.
const PORT = 8641;
const RPC = `http://127.0.0.1:${PORT}`;
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
const art = (p: string) => JSON.parse(readFileSync(join(__dirname, "../../../artifacts/contracts", p), "utf8"));
let node: ChildProcess;
let provider: JsonRpcProvider;
let token: ethers.Contract, vault: ethers.Contract;
let network: Network;
let merchant: string, rogueMerchant: string;
const owners: Record<string, NonceManager> = {};
let agent: NonceManager, poorAgent: Wallet;
let seller: { base: string; close(): void; mw: ReturnType<typeof turnspike> };

const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const mine = (n = 1) => provider.send("hardhat_mine", ["0x" + n.toString(16)]);

async function startSeller(over: Partial<Parameters<typeof turnspike>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tsc-"));
  const mw = turnspike({
    rpcUrls: [RPC], chainId: 31337, contract: vault.target as string, token: token.target as string, merchant,
    hmacSecrets: ["s".repeat(40)], dbPath: join(dir, "s.sqlite"), confirmations: 1, retryAfterSeconds: 1, paymentGraceSeconds: 10 ** 9,
    prices: { "/report": 1000, "/pricey": 900_000 }, ...over,
  });
  const app = express();
  app.use("/v1", mw);
  let n = 0;
  app.get("/v1/report", (_q, r) => r.json({ report: "ok", n: ++n }));
  app.get("/v1/pricey", (_q, r) => r.json({ pricey: true }));
  app.get("/v1/free", (_q, r) => r.json({ free: true }));
  const server: Server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, mw, close: () => { server.close(); mw.close(); } };
}

function client(over: Partial<ClientOptions> = {}, ownerKey = "main") {
  return new TurnspikeClient({
    signer: agent, owner: (owners[ownerKey] as any).signer.address, network,
    policy: { payees: [{ origin: seller.base, merchant }], maxPriceBase: 10_000n },
    confirmations: 1, redeemTimeoutMs: 15_000, txTimeoutMs: 15_000, ...over,
  });
}
const agentNonce = async () => provider.getTransactionCount(await agent.getAddress(), "latest");
const balance = async (k: string) => (await vault.account(await owners[k].getAddress())).balance as bigint;

beforeAll(async () => {
  node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: join(__dirname, "../../.."), shell: true, stdio: "ignore" });
  provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; i < 60; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const deployer = new NonceManager(w(0));
  token = (await (await new ContractFactory(art("test-helpers/MockERC20.sol/MockERC20.json").abi, art("test-helpers/MockERC20.sol/MockERC20.json").bytecode, deployer).deploy()).waitForDeployment()) as any;
  const va = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  vault = (await (await new ContractFactory(va.abi, va.bytecode, deployer).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment()) as any;
  network = { name: "local", chainId: 31337, contract: vault.target as string, token: token.target as string, decimals: 6, rpcUrls: [RPC], explorer: "http://explorer.local" };
  agent = new NonceManager(w(1));
  merchant = w(2).address; rogueMerchant = w(3).address;
  poorAgent = Wallet.createRandom().connect(provider); // never funded with gas
  // owners: main (healthy), poor (low balance), paused, revoked, noMerchant (merchant not allowlisted), gasless (uses poorAgent)
  const setup: [string, number, bigint, boolean, string | null][] = [
    ["main", 4, 2_000_000n, true, null], ["poor", 5, 500n, true, null], ["paused", 6, 100_000n, true, "pause"],
    ["revoked", 7, 100_000n, true, "revoke"], ["noMerchant", 8, 100_000n, false, null], ["gasless", 9, 100_000n, true, "poorAgent"],
  ];
  for (const [k, i, dep, allow, mode] of setup) {
    const o = new NonceManager(w(i));
    owners[k] = o;
    const v = vault.connect(o) as any;
    await (await (token.connect(deployer) as any).mint(await o.getAddress(), 10_000_000n)).wait();
    await (await (token.connect(o) as any).approve(vault.target, 10n ** 12n)).wait();
    await (await v.deposit(dep)).wait();
    await (await v.setPolicy(mode === "poorAgent" ? poorAgent.address : await agent.getAddress(), 50_000n, 200_000n)).wait();
    if (allow) await (await v.setMerchant(merchant, true)).wait();
    if (mode === "pause") await (await v.setPaused(true)).wait();
    if (mode === "revoke") await (await v.revokeAgent()).wait();
  }
  seller = await startSeller();
}, 120_000);

afterAll(() => { seller?.close(); spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); provider.destroy(); });

describe("@turnspike-qie/client against the real middleware and contract", () => {
  it("CL-01 pays a trusted 402 and returns the paid response; repeating the key replays without a second payment", async () => {
    const c = client({ journal: new MemoryJournal() });
    const before = await balance("main");
    const n0 = await agentNonce();
    const r = await c.fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "k1" });
    expect(r.ok && r.kind).toBe("paid");
    if (!r.ok || r.kind !== "paid") throw new Error("unreachable");
    expect(await r.response.json()).toMatchObject({ report: "ok" });
    expect(r.payment.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await balance("main")).toBe(before - 1000n);
    const again = await c.fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "k1" });
    expect(again.ok && again.kind === "paid" && again.replayed).toBe(true);
    expect(await agentNonce()).toBe(n0 + 1); // exactly one transaction
    expect(await balance("main")).toBe(before - 1000n);
  });

  it("CL-02 free routes pass through untouched", async () => {
    const r = await client().fetch(`${seller.base}/v1/free`);
    expect(r.ok && r.kind).toBe("free");
  });

  it("CL-03 price above the policy maximum is refused before any transaction", async () => {
    const n0 = await agentNonce();
    const r = await client().fetch(`${seller.base}/v1/pricey`);
    expect(!r.ok && r.error).toBe("price_above_max");
    expect(!r.ok && r.paid).toBe(false);
    const lower = await client().fetch(`${seller.base}/v1/report`, {}, { maxPriceBase: 999n });
    expect(!lower.ok && lower.error).toBe("price_above_max");
    expect(await agentNonce()).toBe(n0);
  });

  it("CL-04 an unexpected merchant or an unlisted origin is refused (a malicious 402 cannot redirect funds)", async () => {
    const rogue = await startSeller({ merchant: rogueMerchant });
    const r1 = await client({ policy: { payees: [{ origin: rogue.base, merchant }], maxPriceBase: 10_000n } }).fetch(`${rogue.base}/v1/report`);
    expect(!r1.ok && r1.error).toBe("untrusted_destination");
    const r2 = await client().fetch(`${rogue.base}/v1/report`); // origin not listed at all
    expect(!r2.ok && r2.error).toBe("untrusted_destination");
    rogue.close();
  });

  it("CL-05 a challenge naming another chain, contract or token is refused", async () => {
    const r = await client({ network: { ...network, token: rogueMerchant } }).fetch(`${seller.base}/v1/report`);
    expect(!r.ok && r.error).toBe("wrong_network");
    const r2 = await client({ network: { ...network, chainId: 1990 } }).fetch(`${seller.base}/v1/report`);
    expect(!r2.ok && r2.error).toBe("wrong_network");
  });

  it("CL-06 owner balance too low, paused, revoked agent and unlisted merchant are refused before broadcast", async () => {
    const n0 = await agentNonce();
    expect((await client({}, "poor").fetch(`${seller.base}/v1/report`) as any).error).toBe("insufficient_balance");
    expect((await client({}, "paused").fetch(`${seller.base}/v1/report`) as any).error).toBe("paused");
    expect((await client({}, "revoked").fetch(`${seller.base}/v1/report`) as any).error).toBe("not_authorized_agent");
    expect((await client({}, "noMerchant").fetch(`${seller.base}/v1/report`) as any).error).toBe("merchant_not_allowed");
    expect(await agentNonce()).toBe(n0);
  });

  it("CL-07 an agent without gas is refused with insufficient_gas", async () => {
    const r = await client({ signer: poorAgent }, "gasless").fetch(`${seller.base}/v1/report`);
    expect(!r.ok && r.error).toBe("insufficient_gas");
    if (!r.ok) expect(r.quote?.gasCostWei).toBeGreaterThan(0n);
  });

  it("CL-08 dry run returns a full quote and broadcasts nothing", async () => {
    const n0 = await agentNonce();
    const r = await client().fetch(`${seller.base}/v1/report`, {}, { dryRun: true });
    expect(r.ok && r.kind).toBe("dry_run");
    if (r.ok && r.kind === "dry_run") {
      expect(r.quote).toMatchObject({ priceBase: 1000n, price: "0.001", merchant, chainId: 31337 });
      expect(r.quote.gasEstimate).toBeGreaterThan(20_000n);
    }
    expect(await agentNonce()).toBe(n0);
  });

  it("CL-09 the approve callback can decline; nothing is paid", async () => {
    const r = await client({ approve: (q) => q.priceBase < 10n }).fetch(`${seller.base}/v1/report`);
    expect(!r.ok && r.error).toBe("declined");
  });

  it("CL-10 expired (or about to expire) challenges are refused", async () => {
    const short = await startSeller({ challengeTtlSeconds: 5 });
    const r = await client({ policy: { payees: [{ origin: short.base, merchant }], maxPriceBase: 10_000n } }).fetch(`${short.base}/v1/report`);
    expect(!r.ok && r.error).toBe("challenge_expired");
    short.close();
  });

  it("CL-11 gateway down after payment: paid=true, then a NEW client process resumes from the file journal and delivers without paying again", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "tsj-")), "journal.json");
    let calls = 0;
    const flaky: typeof fetch = async (u, i) => { if (++calls > 1) throw new TypeError("fetch failed: ECONNREFUSED"); return fetch(u, i); };
    const before = await balance("main");
    const r = await client({ journal: new FileJournal(path), fetch: flaky, redeemTimeoutMs: 2500 }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "restart-after-confirm" });
    expect(!r.ok && r.error).toBe("gateway_unavailable");
    expect(!r.ok && r.paid).toBe(true);
    const rec = (await new FileJournal(path).get("restart-after-confirm"))!;
    expect(rec.state).toBe("confirmed");
    const n0 = await agentNonce();
    const r2 = await client({ journal: new FileJournal(path) }).resume("restart-after-confirm");
    expect(r2.ok && r2.kind).toBe("paid");
    expect(await agentNonce()).toBe(n0);
    expect(await balance("main")).toBe(before - 1000n);
  });

  it("CL-11b resuming a never-paid, already expired challenge refuses to pay (the seller would reject a late payment)", async () => {
    const j = new MemoryJournal();
    const ch = { protocol: "turnspike/1", requestId: "0x" + "ab".repeat(32), sig: "cd".repeat(32), priceBase: "1000", token: token.target as string, contract: vault.target as string, merchant, chainId: 31337, resourceId: "/report", expiresAt: Math.floor(Date.now() / 1000) - 5, paymentDeadline: Math.floor(Date.now() / 1000) + 55 };
    await j.put({ key: "stale", url: `${seller.base}/v1/report`, method: "GET", state: "challenged", challenge: ch as any, owner: (owners.main as any).signer.address, agent: await agent.getAddress(), updatedAt: 0 } as JournalRecord);
    const n0 = await agentNonce();
    const r = await client({ journal: j }).resume("stale");
    expect(!r.ok && r.error).toBe("challenge_expired");
    expect(!r.ok && r.paid).toBe(false);
    expect(await agentNonce()).toBe(n0);
  });

  it("CL-12 crash after broadcast but before the tx hash was saved: resume finds the payment on chain and does not pay twice", async () => {
    const inner = new MemoryJournal();
    const crashing = { get: (k: string) => inner.get(k), put: async (r: JournalRecord) => { if (r.state === "broadcast") throw new Error("process killed"); return inner.put(r); } };
    const before = await balance("main");
    await expect(client({ journal: crashing }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "crash-mid-broadcast" })).rejects.toThrow("process killed");
    expect((await inner.get("crash-mid-broadcast"))!.state).toBe("paying");
    await mine(1);
    const n0 = await agentNonce();
    const r = await client({ journal: inner }).resume("crash-mid-broadcast");
    expect(r.ok && r.kind).toBe("paid");
    expect(await agentNonce()).toBe(n0);
    expect(await balance("main")).toBe(before - 1000n);
  });

  it("CL-13 restart after broadcast before confirmation: tx_timeout, then resume confirms and delivers", async () => {
    const j = new MemoryJournal();
    await provider.send("evm_setAutomine", [false]);
    try {
      const r = await client({ journal: j, txTimeoutMs: 1500 }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "unconfirmed" });
      expect(!r.ok && r.error).toBe("tx_timeout");
      expect((await j.get("unconfirmed"))!.state).toBe("broadcast");
    } finally {
      await provider.send("evm_setAutomine", [true]);
    }
    await mine(1);
    const r2 = await client({ journal: j }).resume("unconfirmed");
    expect(r2.ok && r2.kind).toBe("paid");
  });

  it("CL-14 delayed gateway: 202 pending while the seller waits for more confirmations, then delivered", async () => {
    const slow = await startSeller({ confirmations: 4 });
    const miner = setInterval(() => { void mine(1); }, 700);
    try {
      const events: any[] = [];
      const r = await client({ policy: { payees: [{ origin: slow.base, merchant }], maxPriceBase: 10_000n }, onEvent: (e) => events.push(e) }).fetch(`${slow.base}/v1/report`);
      expect(r.ok && r.kind).toBe("paid");
      expect(JSON.stringify(events)).not.toContain(" sig"); // events never carry the proof secret
    } finally { clearInterval(miner); slow.close(); }
  }, 30_000);

  it("CL-15 state changes between quote and broadcast (owner pauses): the payment is refused or reverts, and no QUSDC moves", async () => {
    const before = await balance("main");
    const owner = vault.connect(owners.main) as any;
    const r = await client({ approve: async () => { await (await owner.setPaused(true)).wait(); return true; } }).fetch(`${seller.base}/v1/report`);
    await (await owner.setPaused(false)).wait();
    expect(r.ok).toBe(false);
    // A node that answers a reverting send with an unclassifiable error (Hardhat: UNKNOWN_ERROR) is treated as an
    // uncertain submission, so payment_pending is the expected conservative result alongside tx_reverted and paused.
    if (!r.ok) { expect(["tx_reverted", "paused", "payment_pending"]).toContain(r.error); expect(r.paid).toBe(false); }
    expect(await balance("main")).toBe(before);
  });

  // ---- 0.1.2 payment-safety regressions ----

  /** A fresh, real challenge from the seller (no payment). */
  async function liveChallenge(path = "/v1/report", base = seller.base) {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(402);
    return res.json();
  }
  async function challengedRecord(key: string, ch: any, url = `${seller.base}/v1/report`): Promise<JournalRecord> {
    return { key, url, method: "GET", state: "challenged", challenge: ch, owner: (owners.main as any).signer.address, agent: await agent.getAddress(), updatedAt: 0 };
  }
  /** Wraps the agent so sendTransaction fails ambiguously: after the node accepted it ("sent") or before ("lost"). */
  class AmbiguousSigner extends AbstractSigner {
    constructor(private inner: NonceManager, private mode: "sent" | "lost") { super(inner.provider); }
    getAddress() { return this.inner.getAddress(); }
    connect(): never { throw new Error("unused"); }
    signTransaction(tx: any) { return this.inner.signTransaction(tx); }
    signMessage(m: any) { return this.inner.signMessage(m); }
    signTypedData(d: any, t: any, v: any) { return this.inner.signTypedData(d, t, v); }
    async sendTransaction(tx: any): Promise<any> {
      if (this.mode === "sent") await this.inner.sendTransaction(tx);
      throw makeError("request timeout", "TIMEOUT", { operation: "eth_sendRawTransaction" } as any);
    }
  }

  it("CL-10b expiry boundary: exactly minSecondsToExpiry left is accepted, one second less is refused", async () => {
    const ch = await liveChallenge();
    const replay: typeof fetch = async () => new Response(JSON.stringify(ch), { status: 402, headers: { "content-type": "application/json" } });
    const at = (secondsLeft: number) => vi.spyOn(Date, "now").mockReturnValue((ch.expiresAt - secondsLeft) * 1000);
    try {
      at(20);
      const ok = await client({ fetch: replay }).fetch(`${seller.base}/v1/report`, {}, { dryRun: true });
      expect(ok.ok && ok.kind).toBe("dry_run");
      at(19);
      const late = await client({ fetch: replay }).fetch(`${seller.base}/v1/report`, {}, { dryRun: true });
      expect(!late.ok && late.error).toBe("challenge_expired");
    } finally { vi.restoreAllMocks(); }
  });

  it("CL-17 slow approval: a challenge that expires while approve() runs is not paid", async () => {
    const j = new MemoryJournal();
    const n0 = await agentNonce();
    const before = await balance("main");
    const slow = async (q: { expiresAt: number }) => { vi.spyOn(Date, "now").mockReturnValue((q.expiresAt - 5) * 1000); return true; };
    try {
      const r = await client({ journal: j, approve: slow }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "slow-approval" });
      expect(!r.ok && r.error).toBe("challenge_expired");
      expect(!r.ok && r.paid).toBe(false);
    } finally { vi.restoreAllMocks(); }
    expect((await j.get("slow-approval"))!.state).toBe("failed");
    expect(await agentNonce()).toBe(n0);
    expect(await balance("main")).toBe(before);
  });

  it("CL-18 ambiguous submission after the node accepted the tx: payment_pending, the key is held, resume settles it with one charge", async () => {
    const j = new MemoryJournal();
    const before = await balance("main");
    const n0 = await agentNonce();
    const r = await client({ journal: j, signer: new AmbiguousSigner(agent, "sent") }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "ambiguous-sent" });
    expect(!r.ok && r.error).toBe("payment_pending");
    expect((await j.get("ambiguous-sent"))!.state).toBe("paying"); // not "failed": a new purchase under this key is blocked
    await mine(1);
    const again = await client({ journal: j }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "ambiguous-sent" });
    expect(again.ok && again.kind).toBe("paid");
    expect(await agentNonce()).toBe(n0 + 1);
    expect(await balance("main")).toBe(before - 1000n);
  });

  it("CL-19 ambiguous submission that never reached the node: resume re-checks and pays exactly once", async () => {
    const j = new MemoryJournal();
    const before = await balance("main");
    const n0 = await agentNonce();
    const r = await client({ journal: j, signer: new AmbiguousSigner(agent, "lost") }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "ambiguous-lost" });
    expect(!r.ok && r.error).toBe("payment_pending");
    expect(await agentNonce()).toBe(n0);
    const done = await client({ journal: j }).resume("ambiguous-lost");
    expect(done.ok && done.kind).toBe("paid");
    expect(await agentNonce()).toBe(n0 + 1);
    expect(await balance("main")).toBe(before - 1000n);
  });

  it("CL-20 resuming an unsent challenge re-applies today's buyer policy, owner policy and approval", async () => {
    const n0 = await agentNonce();
    // Buyer ceiling lowered since the challenge was recorded.
    const j1 = new MemoryJournal(); await j1.put(await challengedRecord("lowered", await liveChallenge()));
    const r1 = await client({ journal: j1, policy: { payees: [{ origin: seller.base, merchant }], maxPriceBase: 500n } }).resume("lowered");
    expect(!r1.ok && r1.error).toBe("price_above_max");
    expect((await j1.get("lowered"))!.state).toBe("failed");
    // Payee removed from the allowlist.
    const j2 = new MemoryJournal(); await j2.put(await challengedRecord("untrusted", await liveChallenge()));
    const r2 = await client({ journal: j2, policy: { payees: [{ origin: "http://elsewhere.invalid", merchant }], maxPriceBase: 10_000n } }).resume("untrusted");
    expect(!r2.ok && r2.error).toBe("untrusted_destination");
    // Owner lowered the per-call cap on chain.
    const owner = vault.connect(owners.main) as any;
    await (await owner.setPolicy(await agent.getAddress(), 500n, 200_000n)).wait();
    try {
      const j3 = new MemoryJournal(); await j3.put(await challengedRecord("cap", await liveChallenge()));
      const r3 = await client({ journal: j3 }).resume("cap");
      expect(!r3.ok && r3.error).toBe("over_per_call_cap");
    } finally { await (await owner.setPolicy(await agent.getAddress(), 50_000n, 200_000n)).wait(); }
    // approve() is asked again and can decline.
    const j4 = new MemoryJournal(); await j4.put(await challengedRecord("declined", await liveChallenge()));
    const r4 = await client({ journal: j4, approve: () => false }).resume("declined");
    expect(!r4.ok && r4.error).toBe("declined");
    expect(await agentNonce()).toBe(n0); // the agent sent nothing in any of the four cases
  });

  it("CL-21 an idempotency key reused for a different URL, method or body is refused without paying or returning the old resource", async () => {
    const j = new MemoryJournal();
    const ok = await client({ journal: j }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "shared-key" });
    expect(ok.ok && ok.kind).toBe("paid");
    const n0 = await agentNonce();
    const c = client({ journal: j });
    const otherUrl = await c.fetch(`${seller.base}/v1/report?x=1`, {}, { idempotencyKey: "shared-key" });
    expect(!otherUrl.ok && otherUrl.error).toBe("idempotency_conflict");
    const otherMethod = await c.fetch(`${seller.base}/v1/report`, { method: "POST" }, { idempotencyKey: "shared-key" });
    expect(!otherMethod.ok && otherMethod.error).toBe("idempotency_conflict");
    const otherBody = await c.fetch(`${seller.base}/v1/report`, { method: "GET", body: "different" } as any, { idempotencyKey: "shared-key" });
    expect(!otherBody.ok && otherBody.error).toBe("idempotency_conflict");
    const resumeBody = await c.resume("shared-key", { body: "different" });
    expect(!resumeBody.ok && resumeBody.error).toBe("idempotency_conflict");
    const same = await c.fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "shared-key" });
    expect(same.ok && same.kind === "paid" && same.replayed).toBe(true);
    expect(await agentNonce()).toBe(n0);
  });

  it("CL-16 the constructor refuses an open policy", () => {
    expect(() => new TurnspikeClient({ signer: agent, owner: merchant, network, policy: { payees: [], maxPriceBase: 1n } })).toThrow(/payees/);
    expect(() => new TurnspikeClient({ signer: agent, owner: merchant, network, policy: { payees: [{ origin: "http://x", merchant }], maxPriceBase: 0n } })).toThrow(/maxPriceBase/);
  });
});
