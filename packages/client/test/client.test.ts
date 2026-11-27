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
  for (let i = 0; ; i++) { try { await provider.getBlockNumber(); break; } catch { if (i >= 240) throw new Error(`local Hardhat chain at ${RPC} did not start within 120 s`); await new Promise((r) => setTimeout(r, 500)); } }
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

  // ---- second review: concurrency, unresolved expiry, legacy records ----

  const only = (j: MemoryJournal) => ({ get: (k: string) => j.get(k), put: (r: JournalRecord) => j.put(r) }); // a 0.1.0-style journal: no swap

  it("CL-22 two concurrent fetches with one idempotency key make exactly one QUSDC payment (memory, file and swap-less journals)", { timeout: 60_000 }, async () => {
    const path = join(mkdtempSync(join(tmpdir(), "tsj-")), "journal.json");
    const mem = new MemoryJournal(), legacy = only(new MemoryJournal());
    const cases: [string, () => any][] = [["memory", () => mem], ["file", () => new FileJournal(path)], ["swapless", () => legacy]];
    for (const [name, journal] of cases) {
      const before = await balance("main");
      const n0 = await agentNonce();
      const key = `concurrent-${name}`;
      // Separate client instances (and, for the file journal, separate FileJournal objects on one file) as two workers would have.
      const [a, b] = await Promise.all([client({ journal: journal() }), client({ journal: journal() })].map((c) => c.fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: key })));
      const results = [a, b];
      expect(results.filter((r) => r.ok && r.kind === "paid")).toHaveLength(1);
      const loser = results.find((r) => !r.ok)!;
      expect(!loser.ok && loser.error).toBe("payment_pending");
      expect(!loser.ok && loser.maybePaid).toBe(true);
      expect(await agentNonce()).toBe(n0 + 1);
      expect(await balance("main")).toBe(before - 1000n);
      const again = await client({ journal: journal() }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: key });
      expect(again.ok && again.kind === "paid" && again.replayed).toBe(true);
      expect(await balance("main")).toBe(before - 1000n);
    }
  });

  it("CL-23 a reservation abandoned before any challenge is taken over after the timeout, and the old holder is fenced out", async () => {
    const j = new MemoryJournal();
    const stale: JournalRecord = { key: "abandoned", url: `${seller.base}/v1/report`, method: "GET", state: "reserved", owner: (owners.main as any).signer.address, agent: await agent.getAddress(), lockToken: "old-holder", updatedAt: Math.floor(Date.now() / 1000) - 600 };
    await j.put(stale);
    const before = await balance("main");
    const n0 = await agentNonce();
    const r = await client({ journal: j }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "abandoned" });
    expect(r.ok && r.kind).toBe("paid");
    expect(await agentNonce()).toBe(n0 + 1);
    expect(await balance("main")).toBe(before - 1000n);
    expect(await j.swap({ ...stale, state: "challenged", rev: 1 }, 0)).toBe(false); // the old holder's revision is gone: it can no longer record a challenge
    const busy: JournalRecord = { ...stale, key: "busy", updatedAt: Math.floor(Date.now() / 1000) };
    await j.put(busy);
    const b = await client({ journal: j }).resume("busy");
    expect(!b.ok && b.error).toBe("payment_pending");
    expect(!b.ok && b.maybePaid).toBe(true);
  });

  it("CL-24 an ambiguous submission whose challenge then expires stays unresolved (not 'not paid') until the chain settles it", { timeout: 60_000 }, async () => {
    // (a) nothing actually reached the node; the challenge expires; the nonce is later consumed: only then is it resolved.
    const j = new MemoryJournal();
    const n0 = await agentNonce();
    const before = await balance("main");
    const r = await client({ journal: j, signer: new AmbiguousSigner(agent, "lost") }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "lost-then-expired" });
    expect(!r.ok && r.error).toBe("payment_pending");
    const exp = (await j.get("lost-then-expired"))!.challenge!.expiresAt;
    const atExpiry = () => vi.spyOn(Date, "now").mockReturnValue((exp + 5) * 1000);
    try {
      atExpiry();
      const u = await client({ journal: j }).resume("lost-then-expired");
      expect(!u.ok && u.error).toBe("payment_pending");
      expect(!u.ok && u.paid).toBe(false);
      expect(!u.ok && u.maybePaid).toBe(true);
      expect((await j.get("lost-then-expired"))!.state).toBe("paying");
    } finally { vi.restoreAllMocks(); }
    expect(await agentNonce()).toBe(n0); // resume did not send a new payment for an expired challenge
    await (await agent.sendTransaction({ to: await agent.getAddress(), value: 0n })).wait(); // the agent's next transaction consumes that nonce
    try {
      atExpiry();
      const settled = await client({ journal: j }).resume("lost-then-expired");
      expect(!settled.ok && settled.error).toBe("challenge_expired");
      expect(!settled.ok && settled.maybePaid).toBeFalsy();
      expect((await j.get("lost-then-expired"))!.state).toBe("failed");
    } finally { vi.restoreAllMocks(); }
    expect(await balance("main")).toBe(before);

    // (b) the submission did reach the node: after expiry, resume finds it on chain and delivers, with one charge.
    const j2 = new MemoryJournal();
    const before2 = await balance("main");
    const s = await client({ journal: j2, signer: new AmbiguousSigner(agent, "sent") }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "sent-then-expired" });
    expect(!s.ok && s.error).toBe("payment_pending");
    await mine(1);
    const exp2 = (await j2.get("sent-then-expired"))!.challenge!.expiresAt;
    vi.spyOn(Date, "now").mockReturnValue((exp2 + 5) * 1000);
    let rec;
    try { rec = await client({ journal: j2, redeemTimeoutMs: 5000 }).resume("sent-then-expired"); } finally { vi.restoreAllMocks(); }
    expect(rec.ok && rec.kind).toBe("paid");
    expect(await balance("main")).toBe(before2 - 1000n);
  });

  it("CL-25 a 0.1.0 journal record (no fingerprint) is reused only for a body-less GET of the same URL", async () => {
    const j = new MemoryJournal();
    const paid = await client({ journal: j }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "legacy" });
    expect(paid.ok && paid.kind).toBe("paid");
    const rec = (await j.get("legacy"))!;
    delete rec.fingerprint; delete rec.lockToken;
    await j.put(rec); // now shaped like a record written by 0.1.0
    const n0 = await agentNonce();
    const c = client({ journal: j });
    const same = await c.fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "legacy" });
    expect(same.ok && same.kind === "paid" && same.replayed).toBe(true);
    const withBody = await c.fetch(`${seller.base}/v1/report`, { method: "GET", body: "x" } as any, { idempotencyKey: "legacy" });
    expect(!withBody.ok && withBody.error).toBe("idempotency_conflict");
    const resumeBody = await c.resume("legacy", { body: "x" });
    expect(!resumeBody.ok && resumeBody.error).toBe("idempotency_conflict");
    await j.put({ ...rec, key: "legacy-post", method: "POST" });
    const post = await c.fetch(`${seller.base}/v1/report`, { method: "POST" }, { idempotencyKey: "legacy-post" });
    expect(!post.ok && post.error).toBe("idempotency_conflict"); // its body was never recorded, so it cannot be matched
    expect(await agentNonce()).toBe(n0);
  });

  // ---- third review: takeover race, stale writers ----

  /** Signer whose send waits for `open()` and then fails definitively (as if the node said "insufficient funds"). */
  class BlockedFailSigner extends AbstractSigner {
    private gate!: () => void;
    readonly opened = new Promise<void>((r) => { this.gate = r; });
    constructor(private inner: NonceManager) { super(inner.provider); }
    open() { this.gate(); }
    getAddress() { return this.inner.getAddress(); }
    connect(): never { throw new Error("unused"); }
    signTransaction(tx: any) { return this.inner.signTransaction(tx); }
    signMessage(m: any) { return this.inner.signMessage(m); }
    signTypedData(d: any, t: any, v: any) { return this.inner.signTypedData(d, t, v); }
    async sendTransaction(): Promise<any> { await this.opened; throw makeError("insufficient funds for intrinsic transaction cost", "INSUFFICIENT_FUNDS", {} as any); }
  }
  const waitFor = async (cond: () => Promise<boolean>) => { for (let i = 0; i < 400; i++) { if (await cond()) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error("timed out"); };

  it("CL-26 takeover race: the original holder records its challenge right before the takeover CAS; the takeover fails and only that challenge is ever paid", async () => {
    const inner = new MemoryJournal();
    const old = Math.floor(Date.now() / 1000) - 600;
    const stale: JournalRecord = { key: "race-takeover", url: `${seller.base}/v1/report`, method: "GET", state: "reserved", owner: (owners.main as any).signer.address, agent: await agent.getAddress(), lockToken: "holder", rev: 3, updatedAt: old };
    await inner.put(stale);
    const ch = await liveChallenge();
    let interleaved = false;
    const j = {
      get: (k: string) => inner.get(k),
      put: (r: JournalRecord) => inner.put(r),
      swap: async (r: JournalRecord, expect: any) => {
        if (!interleaved && r.key === "race-takeover" && r.state === "reserved") {
          interleaved = true; // the original worker transitions reserved -> challenged immediately before the takeover's CAS
          expect_(await inner.swap({ ...stale, state: "challenged", challenge: ch, rev: 4 }, 3)).toBe(true);
        }
        return inner.swap(r, expect);
      },
    };
    const expect_ = expect;
    const n0 = await agentNonce();
    const before = await balance("main");
    const r = await client({ journal: j as any }).resume("race-takeover");
    expect(interleaved).toBe(true);
    expect(!r.ok && r.error).toBe("payment_pending");
    expect(!r.ok && r.maybePaid).toBe(true);
    const rec = (await inner.get("race-takeover"))!;
    expect(rec.state).toBe("challenged");
    expect(rec.challenge!.requestId).toBe(ch.requestId); // the holder's challenge was not replaced
    expect(await agentNonce()).toBe(n0);
    // The holder (or any resume) then pays exactly that challenge, once.
    const done = await client({ journal: inner }).resume("race-takeover");
    expect(done.ok && done.kind).toBe("paid");
    expect(done.ok && done.kind === "paid" && done.payment.requestId).toBe(ch.requestId);
    expect(await balance("main")).toBe(before - 1000n);
    expect(await agentNonce()).toBe(n0 + 1);
  });

  it("CL-27 concurrent resumes of one recorded challenge: one transaction, one charge, final record delivered", async () => {
    const j = new MemoryJournal();
    await j.put(await challengedRecord("race-resume", await liveChallenge()));
    const n0 = await agentNonce();
    const before = await balance("main");
    const results = await Promise.all([client({ journal: j }), client({ journal: j })].map((c) => c.resume("race-resume")));
    expect(results.some((r) => r.ok && r.kind === "paid")).toBe(true);
    for (const r of results) if (!r.ok) expect(r.paid || r.maybePaid).toBe(true); // never a "not paid" verdict
    expect(await agentNonce()).toBe(n0 + 1);
    expect(await balance("main")).toBe(before - 1000n);
    expect((await j.get("race-resume"))!.state).toBe("delivered");
  });

  it("CL-28 a successful payment racing a failed send: the failing worker cannot overwrite delivered with failed", { timeout: 60_000 }, async () => {
    const j = new MemoryJournal();
    const n0 = await agentNonce();
    const before = await balance("main");
    const blocked = new BlockedFailSigner(agent);
    const loser = client({ journal: j, signer: blocked }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "race-fail" });
    await waitFor(async () => (await j.get("race-fail"))?.state === "paying"); // worker B is inside sendTransaction
    const winner = await client({ journal: j }).resume("race-fail"); // worker A settles it and pays
    expect(winner.ok && winner.kind).toBe("paid");
    expect((await j.get("race-fail"))!.state).toBe("delivered");
    blocked.open(); // now B's send fails definitively and B tries to record "failed" from its stale copy
    const late = await loser;
    expect(!late.ok && !late.paid && !late.maybePaid).toBe(false); // B does not report "not paid"
    const final = (await j.get("race-fail"))!;
    expect(final.state).toBe("delivered");
    expect(final.txHash).toBe(winner.ok && winner.kind === "paid" ? winner.payment.txHash : "");
    expect(await agentNonce()).toBe(n0 + 1);
    expect(await balance("main")).toBe(before - 1000n);
    // A later fetch with the key replays; the completed purchase was not reopened.
    const again = await client({ journal: j }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "race-fail" });
    expect(again.ok && again.kind === "paid" && again.replayed).toBe(true);
    expect(await balance("main")).toBe(before - 1000n);
  });

  // ---- fourth review: purchase-attempt identity across key reuse ----

  /** Signer that really sends the transaction, then holds the result until `open()` (a delayed broadcast acknowledgement). */
  class SendThenHold extends AbstractSigner {
    private gate!: () => void;
    readonly opened = new Promise<void>((r) => { this.gate = r; });
    sentHash?: string;
    constructor(private inner: NonceManager) { super(inner.provider); }
    open() { this.gate(); }
    getAddress() { return this.inner.getAddress(); }
    connect(): never { throw new Error("unused"); }
    signTransaction(tx: any) { return this.inner.signTransaction(tx); }
    signMessage(m: any) { return this.inner.signMessage(m); }
    signTypedData(d: any, t: any, v: any) { return this.inner.signTypedData(d, t, v); }
    async sendTransaction(tx: any): Promise<any> { const r = await this.inner.sendTransaction(tx); this.sentHash = r.hash; await this.opened; return r; }
  }

  it("CL-29 [failure injected outside the client; both attempts charge, by design of the test] failed-key reuse, then the old attempt's delayed broadcast, confirmation and delivery: the new record is untouched and each caller gets its own purchase", { timeout: 60_000 }, async () => {
    const j = new MemoryJournal();
    const before = await balance("main");
    const hold = new SendThenHold(agent);
    const oldCall = client({ journal: j, signer: hold }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "reuse" });
    await waitFor(async () => !!hold.sentHash); // attempt 1's transaction is on its way; its worker has not recorded it yet
    const first = (await j.get("reuse"))!;
    expect(first.state).toBe("paying");
    await mine(1);
    // Injected: attempt 1 is closed as failed, which makes the key reusable (the condition under review).
    expect(await j.swap({ ...first, state: "failed", error: "injected for the test", rev: first.rev! + 1 }, first.rev!)).toBe(true);
    const fresh = await client({ journal: j }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "reuse" }); // attempt 2
    expect(fresh.ok && fresh.kind).toBe("paid");
    const newer = (await j.get("reuse"))!;
    expect(newer.state).toBe("delivered");
    expect(newer.attempt).not.toBe(first.attempt);
    hold.open(); // attempt 1 now records its broadcast, confirms and redeems
    const old = await oldCall;
    expect(old.ok && old.kind).toBe("paid"); // its own payment is still recovered for its own caller
    if (old.ok && old.kind === "paid") {
      expect(old.payment.requestId).toBe(first.challenge!.requestId);
      expect(old.payment.txHash).toBe(hold.sentHash);
    }
    expect(await j.get("reuse")).toEqual(newer); // no tx hash, confirmation or delivery of attempt 1 leaked into attempt 2
    const later = await client({ journal: j }).resume("reuse");
    expect(later.ok && later.kind === "paid" && later.payment.requestId).toBe(newer.challenge!.requestId);
    expect(later.ok && later.kind === "paid" && later.payment.txHash).toBe(newer.txHash);
    expect(await balance("main")).toBe(before - 2000n); // two attempts, each paid once
  });

  it("CL-30 a stale worker of an old attempt that loses to a newer attempt never returns the newer attempt's resource or proof", async () => {
    const inner = new MemoryJournal();
    const ch = await liveChallenge();
    await inner.put({ ...(await challengedRecord("reuse2", ch)), attempt: "attempt-1", rev: 1 });
    // A real, delivered attempt 2 under the same key (bought through a separate journal, then installed).
    const other = new MemoryJournal();
    const bought = await client({ journal: other }).fetch(`${seller.base}/v1/report`, {}, { idempotencyKey: "reuse2" });
    expect(bought.ok && bought.kind).toBe("paid");
    const attempt2 = (await other.get("reuse2"))!;
    let injected = false;
    const j = {
      get: (k: string) => inner.get(k),
      put: (r: JournalRecord) => inner.put(r),
      swap: async (r: JournalRecord, expect: any) => {
        if (!injected && r.state === "paying") { injected = true; await inner.put({ ...attempt2, rev: 10 }); } // attempt 2 lands first
        return inner.swap(r, expect);
      },
    };
    const n0 = await agentNonce();
    const r = await client({ journal: j as any }).resume("reuse2");
    expect(injected).toBe(true);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.maybePaid).toBe(true);
      expect(r.payment?.requestId).toBe(ch.requestId); // its own attempt, not attempt 2's
      expect(r.payment?.txHash).not.toBe(attempt2.txHash);
    }
    expect(await agentNonce()).toBe(n0); // it lost before sending anything
    expect((await inner.get("reuse2"))!.attempt).toBe(attempt2.attempt);
  });

  it("CL-16 the constructor refuses an open policy", () => {
    expect(() => new TurnspikeClient({ signer: agent, owner: merchant, network, policy: { payees: [], maxPriceBase: 1n } })).toThrow(/payees/);
    expect(() => new TurnspikeClient({ signer: agent, owner: merchant, network, policy: { payees: [{ origin: "http://x", merchant }], maxPriceBase: 0n } })).toThrow(/maxPriceBase/);
  });
});
