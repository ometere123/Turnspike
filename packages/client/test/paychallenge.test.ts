import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { startNode, stopNode } from "../../../scripts/test-util/hardhat-node";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { AbstractSigner, ContractFactory, HDNodeWallet, Interface, JsonRpcProvider, NonceManager, ethers, makeError } from "ethers";
import { turnspike } from "../../middleware/src";
import { TurnspikeClient, FileJournal, MemoryJournal, ALLOWANCE_ABI, encodeProof, type Network, type JournalRecord, type ClientOptions, type Journal } from "../src";

// payChallenge, proof_presented, recovery and durable nonce allocation. Local Hardhat chain, the real settlement contract,
// the real seller middleware (for genuine signed challenges and proof redemption) and the labelled MockERC20 test double.
// Nothing here touches mainnet. Uses its own port so it never shares a chain with client.test.ts.
const PORT = 8643;
const RPC = `http://127.0.0.1:${PORT}`;
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
const AGENT_INDEX = 1;
const CLIENT_DIR = join(__dirname, "..");
const art = (p: string) => JSON.parse(readFileSync(join(__dirname, "../../../artifacts/contracts", p), "utf8"));
const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);
let node: ChildProcess;
let provider: JsonRpcProvider;
let token: ethers.Contract, vault: ethers.Contract;
let network: Network;
let merchant: string, owner: string, agentAddr: string;
// A plain wallet, not a NonceManager: NonceManager overwrites the nonce the client pins, and the worker processes send
// with the same key, which would leave any in-process nonce cache stale.
let agent: HDNodeWallet;
let seller: { base: string; close(): void };

const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const mine = (n = 1) => provider.send("hardhat_mine", ["0x" + n.toString(16)]);
const automine = async (on: boolean) => { await provider.send("evm_setIntervalMining", [0]); await provider.send("evm_setAutomine", [on]); };
const agentNonce = () => provider.getTransactionCount(agentAddr, "latest");
const balance = async () => (await vault.account(owner)).balance as bigint;
const tmpJournal = () => join(mkdtempSync(join(tmpdir(), "tspc-")), "journal.json");

async function startSeller() {
  const dir = mkdtempSync(join(tmpdir(), "tspcs-"));
  const mw = turnspike({
    rpcUrls: [RPC], chainId: 31337, contract: vault.target as string, token: token.target as string, merchant,
    hmacSecrets: ["s".repeat(40)], dbPath: join(dir, "s.sqlite"), confirmations: 1, retryAfterSeconds: 1, paymentGraceSeconds: 10 ** 9,
    rateLimitPerMinute: 100_000, prices: { "/report": 1000 }, onEvent: () => {},
  });
  const app = express();
  app.use("/v1", mw);
  app.get("/v1/report", (_q, r) => r.json({ report: "ok" }));
  const server: Server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, close: () => { server.close(); mw.close(); } };
}

function client(over: Partial<ClientOptions> = {}) {
  return new TurnspikeClient({
    signer: agent, owner, network, policy: { payees: [{ origin: seller.base, merchant }], maxPriceBase: 10_000n },
    confirmations: 1, txTimeoutMs: 15_000, redeemTimeoutMs: 15_000, ...over,
  });
}

/** A fresh, real challenge from the seller for `url` (no payment). */
async function challengeFor(url: string) {
  const res = await fetch(url);
  expect(res.status).toBe(402);
  return res.json();
}
let seq = 0;
/** A new purchase: a distinct URL, its real challenge and a context. */
async function purchase(key = `k-${++seq}`) {
  const url = `${seller.base}/v1/report?n=${++seq}`;
  return { url, key, ch: await challengeFor(url), ctx: { url, method: "GET", purchaseKey: key } };
}

/** Paid events emitted by the contract for this agent since `fromBlock`, as requestIds. */
async function paidRequestIds(fromBlock: number): Promise<string[]> {
  const ev = iface.getEvent("Paid")!;
  const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const logs = await provider.getLogs({ address: vault.target as string, topics: [ev.topicHash, pad(owner), pad(agentAddr)], fromBlock, toBlock: "latest" });
  return logs.map((l) => String(iface.parseLog({ topics: [...l.topics], data: l.data })!.args.requestId).toLowerCase());
}

/** Wraps the agent so sendTransaction fails ambiguously: after the node accepted it ("sent") or before ("lost"). */
class AmbiguousSigner extends AbstractSigner {
  constructor(private inner: HDNodeWallet, private mode: "sent" | "lost") { super(inner.provider); }
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

/** Runs the worker script (built client) in a separate OS process. */
function worker(args: Record<string, unknown>) {
  const full = {
    dist: join(CLIENT_DIR, "dist/index.js"), rpc: RPC, chainId: 31337, contract: vault.target, token: token.target, owner, merchant,
    phrase: PHRASE, agentIndex: AGENT_INDEX, base: seller.base, ...args,
  };
  return spawn(process.execPath, [join(__dirname, "fixtures/pay-worker.cjs"), JSON.stringify(full)], { stdio: ["ignore", "pipe", "pipe"] });
}
function collect(c: ChildProcess): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((res) => {
    let out = "", err = "";
    c.stdout!.on("data", (d) => (out += d)); c.stderr!.on("data", (d) => (err += d));
    c.on("close", (code) => res({ code, out, err }));
  });
}

beforeAll(async () => {
  // The worker processes run the built client, so build it from the current sources first.
  const build = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: CLIENT_DIR, shell: true, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`client build failed: ${build.stdout}${build.stderr}`);
  node = startNode(PORT, join(__dirname, "../../.."));
  provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; i < 120; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const deployer = new NonceManager(w(0));
  const ta = art("test-helpers/MockERC20.sol/MockERC20.json");
  token = (await (await new ContractFactory(ta.abi, ta.bytecode, deployer).deploy()).waitForDeployment()) as any;
  const va = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  vault = (await (await new ContractFactory(va.abi, va.bytecode, deployer).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment()) as any;
  network = { name: "local", chainId: 31337, contract: vault.target as string, token: token.target as string, decimals: 6, rpcUrls: [RPC], explorer: "http://explorer.local" };
  agent = w(AGENT_INDEX);
  agentAddr = await agent.getAddress();
  merchant = w(2).address;
  const o = new NonceManager(w(4));
  owner = await o.getAddress();
  const v = vault.connect(o) as any;
  await (await (token.connect(deployer) as any).mint(owner, 10_000_000n)).wait();
  await (await (token.connect(o) as any).approve(vault.target, 10n ** 12n)).wait();
  await (await v.deposit(4_000_000n)).wait();
  await (await v.setPolicy(agentAddr, 50_000n, 2_000_000n)).wait();
  await (await v.setMerchant(merchant, true)).wait();
  seller = await startSeller();
}, 180_000);

afterAll(() => { seller?.close(); stopNode(node); provider?.destroy(); });

describe("payChallenge, recovery and durable nonce allocation", () => {
  it("PC-01 pays a challenge, emits Paid, returns a proof the seller accepts; proof_presented and delivered are recorded forward-only", async () => {
    const j = new MemoryJournal();
    const c = client({ journal: j });
    const { ch, ctx, url, key } = await purchase();
    const before = await balance();
    const n0 = await agentNonce();
    const r = await c.payChallenge(ch, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(r.resumed).toBe(false);
    expect(r.proof).toEqual({ requestId: ch.requestId, txHash: r.payment.txHash, sig: ch.sig });
    expect(r.payment).toMatchObject({ requestId: ch.requestId, priceBase: 1000n });
    const receipt = (await provider.getTransactionReceipt(r.proof.txHash))!;
    const paid = receipt.logs.map((l) => { try { return iface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } }).filter((p) => p?.name === "Paid");
    expect(paid).toHaveLength(1);
    expect(paid[0]!.args.toObject()).toMatchObject({ owner, agent: agentAddr, merchant, requestId: ch.requestId, amount: 1000n });
    expect(await balance()).toBe(before - 1000n);
    expect(await agentNonce()).toBe(n0 + 1);
    expect((await j.get(key))!.state).toBe("confirmed");
    // No HTTP happened in payChallenge; the proof works when the caller presents it.
    const res = await fetch(url, { headers: { "x-payment": encodeProof(r.proof) } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report: "ok" });
    expect(await c.markProofPresented(key, "0x" + "00".repeat(32))).toBe(false); // another attempt's requestId: nothing written
    expect(await c.markProofPresented(key, ch.requestId)).toBe(true);
    expect((await j.get(key))!.state).toBe("proof_presented");
    expect(await c.markDelivered(key)).toBe(true);
    expect((await j.get(key))!.state).toBe("delivered");
    expect(await c.markProofPresented(key)).toBe(true); // forward-only: delivered is kept
    expect((await j.get(key))!.state).toBe("delivered");
    expect(await c.markDelivered("no-such-key")).toBe(false);
  });

  it("PC-02 the same purchase key twice, and concurrently: one charge, every success carries the same proof", async () => {
    const j = new MemoryJournal();
    const { ch, ctx } = await purchase();
    const before = await balance();
    const n0 = await agentNonce();
    const first = await client({ journal: j }).payChallenge(ch, ctx);
    const again = await client({ journal: j }).payChallenge(ch, ctx);
    expect(first.ok && !first.resumed).toBe(true);
    expect(again.ok && again.resumed).toBe(true);
    expect(again.ok && first.ok && again.proof).toEqual(first.ok && first.proof);
    // Concurrent: two clients (two workers) race one new key with one challenge.
    const p2 = await purchase();
    const results = await Promise.all([client({ journal: j }), client({ journal: j })].map((c) => c.payChallenge(p2.ch, p2.ctx)));
    expect(results.some((r) => r.ok)).toBe(true);
    for (const r of results) if (!r.ok) expect(r.paid || r.maybePaid).toBe(true); // a loser never says "not paid"
    const settled = await client({ journal: j }).payChallenge(p2.ch, p2.ctx);
    expect(settled.ok && settled.resumed).toBe(true);
    for (const r of results) if (r.ok && settled.ok) expect(r.proof).toEqual(settled.proof);
    expect(await agentNonce()).toBe(n0 + 2);
    expect(await balance()).toBe(before - 2000n);
  });

  it("PC-03 the same key with a different challenge or request is refused and pays nothing; the existing proof is reported", async () => {
    const j = new MemoryJournal();
    const c = client({ journal: j });
    const p = await purchase();
    const paid = await c.payChallenge(p.ch, p.ctx);
    expect(paid.ok).toBe(true);
    const before = await balance();
    const n0 = await agentNonce();
    const other = await challengeFor(p.url); // the seller issues a new requestId for the same URL
    const r = await c.payChallenge(other, p.ctx);
    expect(!r.ok && r.error).toBe("idempotency_conflict");
    expect(!r.ok && r.paid).toBe(true); // describes the purchase holding the key, which is paid
    expect(!r.ok && r.proof).toEqual(paid.ok && paid.proof); // so the caller can re-present it instead of paying again
    const tampered = await c.payChallenge({ ...p.ch, priceBase: "999" }, p.ctx); // same requestId, different terms
    expect(!tampered.ok && tampered.error).toBe("idempotency_conflict");
    const otherUrl = await c.payChallenge(p.ch, { ...p.ctx, url: `${seller.base}/v1/report?elsewhere=1` });
    expect(!otherUrl.ok && otherUrl.error).toBe("idempotency_conflict");
    const otherBody = await c.payChallenge(p.ch, { ...p.ctx, bodyHash: "0x" + "11".repeat(32) });
    expect(!otherBody.ok && otherBody.error).toBe("idempotency_conflict");
    expect(await vault.isUsed(merchant, other.requestId)).toBe(false);
    expect(await agentNonce()).toBe(n0);
    expect(await balance()).toBe(before);
    // A refusal before recording (here by approve) leaves the key free.
    const q = await purchase();
    const declined = await client({ journal: j, approve: () => false }).payChallenge(q.ch, q.ctx);
    expect(!declined.ok && declined.error).toBe("declined");
    expect(await j.get(q.key)).toBeUndefined(); // refused before recording: the key was never taken
  });

  it("PC-04 an uncertain send, then payChallenge again: maybePaid while unresolved, never a second charge; a new challenge under the key is refused", { timeout: 60_000 }, async () => {
    // (a) the node accepted the transaction but the client saw a timeout, and it is not mined yet.
    const j = new MemoryJournal();
    const p = await purchase();
    const before = await balance();
    const n0 = await agentNonce();
    await automine(false);
    try {
      const r = await client({ journal: j, signer: new AmbiguousSigner(agent, "sent") }).payChallenge(p.ch, p.ctx);
      expect(!r.ok && r.error).toBe("payment_pending");
      expect(!r.ok && r.maybePaid).toBe(true);
      expect((await j.get(p.key))!.state).toBe("paying");
      const again = await client({ journal: j }).payChallenge(p.ch, p.ctx);
      expect(!again.ok && again.maybePaid).toBe(true); // a transaction at the recorded nonce is pending
      expect(!again.ok && again.paid).toBe(false);
      const fresh = await challengeFor(p.url);
      const conflict = await client({ journal: j }).payChallenge(fresh, p.ctx);
      expect(!conflict.ok && conflict.error).toBe("idempotency_conflict");
      expect(!conflict.ok && conflict.maybePaid).toBe(true);
    } finally { await automine(true); }
    await mine(1);
    const settled = await client({ journal: j }).payChallenge(p.ch, p.ctx);
    expect(settled.ok && settled.resumed).toBe(true);
    expect(await agentNonce()).toBe(n0 + 1);
    expect(await balance()).toBe(before - 1000n);

    // (b) the submission never reached the node: the retry re-sends at the recorded nonce and pays exactly once.
    const q = await purchase();
    const n1 = await agentNonce();
    const lost = await client({ journal: j, signer: new AmbiguousSigner(agent, "lost") }).payChallenge(q.ch, q.ctx);
    expect(!lost.ok && lost.maybePaid).toBe(true);
    const recordedNonce = (await j.get(q.key))!.nonce;
    expect(recordedNonce).toBe(n1);
    const done = await client({ journal: j }).payChallenge(q.ch, q.ctx);
    expect(done.ok && done.resumed).toBe(true);
    const tx = await provider.getTransaction(done.ok ? done.proof.txHash : "");
    expect(tx!.nonce).toBe(recordedNonce); // the resend reused the nonce, so the hidden first one could never also mine
    expect(await agentNonce()).toBe(n1 + 1);
    expect(await balance()).toBe(before - 2000n);
  });

  it("PC-05 recoverPending after a simulated crash settles every unfinished purchase from the chain and pays nothing new", { timeout: 60_000 }, async () => {
    const path = tmpJournal();
    const inner = new FileJournal(path);
    // (a) crash after broadcast, before the hash was saved: the write of "broadcast" kills the process.
    const crashing: Journal = {
      get: (k) => inner.get(k), put: (r) => inner.put(r), list: () => inner.list(),
      swap: async (r, e) => { if (r.state === "broadcast") throw new Error("process killed"); return inner.swap(r, e); },
      allocateNonce: (a, n, o) => inner.allocateNonce(a, n, o),
    };
    const a = await purchase("crash-after-broadcast");
    const before = await balance();
    await expect(client({ journal: crashing }).payChallenge(a.ch, a.ctx)).rejects.toThrow("process killed");
    expect((await inner.get(a.key))!.state).toBe("paying");
    // (b) broadcast, then the process stopped waiting before confirmation.
    const b = await purchase("broadcast-unconfirmed");
    await automine(false);
    try {
      const r = await client({ journal: inner, txTimeoutMs: 1500 }).payChallenge(b.ch, b.ctx);
      expect(!r.ok && r.error).toBe("tx_timeout");
      expect(!r.ok && r.maybePaid).toBe(true);
    } finally { await automine(true); }
    await mine(1);
    expect((await inner.get(b.key))!.state).toBe("broadcast");
    // (c) a reservation abandoned before any challenge, (d) a recorded challenge that was never sent.
    const stamp = Math.floor(Date.now() / 1000);
    await inner.put({ key: "abandoned", url: `${seller.base}/v1/report?x=abandoned`, method: "GET", state: "reserved", owner, agent: agentAddr, rev: 1, attempt: "a1", updatedAt: stamp - 3600 });
    const d = await purchase("never-sent");
    await inner.put({ key: d.key, url: d.url, method: "GET", state: "challenged", challenge: d.ch, owner, agent: agentAddr, rev: 1, attempt: "d1", updatedAt: stamp });
    // (e) another agent's record in the shared journal is not touched.
    await inner.put({ key: "someone-else", url: d.url, method: "GET", state: "challenged", challenge: d.ch, owner, agent: merchant, rev: 1, attempt: "e1", updatedAt: stamp });

    const fresh = client({ journal: new FileJournal(path) }); // a new process after the restart
    expect((await fresh.pendingPurchases()).map((r) => r.key).sort()).toEqual(["abandoned", a.key, b.key, d.key].sort());
    const n0 = await agentNonce();
    const out = await fresh.recoverPending();
    const by = Object.fromEntries(out.map((o) => [o.key, o]));
    expect(by[a.key].before).toBe("paying");
    const ra = by[a.key].result!;
    expect(ra.ok && ra.proof.requestId).toBe(a.ch.requestId);
    expect(by[a.key].after).toBe("confirmed");
    expect(by[b.key].result!.ok).toBe(true);
    expect(by[b.key].after).toBe("confirmed");
    expect(by.abandoned.result).toBeNull();
    expect(by.abandoned.after).toBe("failed");
    expect(by[d.key].result).toBeNull();
    expect(by[d.key].after).toBe("challenged");
    expect(by["someone-else"]).toBeUndefined();
    expect(await agentNonce()).toBe(n0); // recovery sent nothing
    expect(await balance()).toBe(before - 2000n); // (a) and (b) each charged once
    // The recovered proof is accepted by the seller.
    if (!ra.ok) throw new Error("unreachable");
    expect((await fetch(a.url, { headers: { "x-payment": encodeProof(ra.proof) } })).status).toBe(200);
    // Opting in pays the never-sent challenge after the full checks.
    const paid = await fresh.recoverPending({ payUnsent: true });
    expect(paid.find((o) => o.key === d.key)!.result!.ok).toBe(true);
    expect(await balance()).toBe(before - 3000n);
  });

  it("PC-06 two OS processes, one agent key, one FileJournal, 10 concurrent purchases each: 20 Paid events, no nonce errors, no duplicate charges", { timeout: 180_000 }, async () => {
    const path = tmpJournal();
    const fromBlock = await provider.getBlockNumber();
    const before = await balance();
    const n0 = await agentNonce();
    // Interval mining: like a real chain, a transaction whose nonce is ahead of the chain waits in the mempool. (Hardhat's
    // automine refuses such a transaction, which would make any multi-sender test meaningless.)
    await provider.send("evm_setAutomine", [false]);
    await provider.send("evm_setIntervalMining", [300]);
    let runs: { code: number | null; out: string; err: string }[];
    try {
      runs = await Promise.all([1, 2].map((id) => collect(worker({ mode: "buy", journal: path, worker: id, count: 10 }))));
    } finally { await automine(true); }
    for (const r of runs) expect(r.err).toBe("");
    for (const r of runs) expect(r.code).toBe(0);
    const results = runs.flatMap((r) => r.out.trim().split("\n").map((l) => JSON.parse(l)));
    expect(results).toHaveLength(20);
    const failures = results.filter((r) => !r.ok);
    expect(failures).toEqual([]); // includes: no nonce errors, no payment_pending, no maybePaid
    const requestIds = results.map((r) => r.requestId.toLowerCase());
    expect(new Set(requestIds).size).toBe(20);
    const events = await paidRequestIds(fromBlock + 1);
    expect(events).toHaveLength(20);
    expect(new Set(events)).toEqual(new Set(requestIds));
    expect(await agentNonce()).toBe(n0 + 20); // no wasted or replaced transactions
    expect(await balance()).toBe(before - 20_000n);
    const nonces = await Promise.all(results.map(async (r) => (await provider.getTransaction(r.txHash))!.nonce));
    expect(new Set(nonces).size).toBe(20);
    const recs = await new FileJournal(path).list();
    expect(recs.filter((r) => r.state === "confirmed")).toHaveLength(20);
    // Every reservation ends: the chain has passed all 20 nonces, so the next allocation is the chain's next nonce.
    const lease = await new FileJournal(path).allocateNonce(agentAddr, await provider.getTransactionCount(agentAddr, "pending"));
    expect(lease.nonce).toBe(n0 + 20);
    await lease.release({ sent: false });
  });

  it("PC-07 a process killed mid-payment: its nonce reservation is reclaimed (no stalled agent) and recovery pays its purchase exactly once", { timeout: 120_000 }, async () => {
    const path = tmpJournal();
    const fj = new FileJournal(path);
    const before = await balance();
    const n0 = await agentNonce();
    const fromBlock = await provider.getBlockNumber();
    const child = worker({ mode: "hang", journal: path, worker: 7 });
    const exited = new Promise<void>((r) => child.on("exit", () => r()));
    await new Promise<void>((res, rej) => {
      let out = "";
      child.stdout!.on("data", (d) => { out += d; if (out.includes("SENDING")) res(); });
      child.on("exit", () => rej(new Error(`worker exited early: ${out}`)));
    });
    const dead = (await fj.get("hang-7"))!;
    expect(dead.state).toBe("paying");
    expect(dead.nonce).toBe(n0);
    const held = (await fj.nonceState(agentAddr))!.entries;
    expect(held).toEqual([expect.objectContaining({ nonce: n0, status: "held", pid: child.pid })]);
    child.kill("SIGKILL");
    await exited;

    // A new purchase in this process is not blocked behind the dead reservation: it is handed the reclaimed nonce.
    const p = await purchase();
    const r = await client({ journal: fj }).payChallenge(p.ch, p.ctx);
    expect(r.ok).toBe(true);
    expect((await provider.getTransaction(r.ok ? r.proof.txHash : ""))!.nonce).toBe(n0);
    expect((await fj.nonceState(agentAddr))!.entries.some((e) => e.pid === child.pid)).toBe(false);

    // Recovery settles the killed purchase: its recorded nonce was consumed by another payment and its requestId is
    // unused on chain, so it was provably never charged; it is paid once, at a fresh nonce.
    const out = await client({ journal: fj }).recoverPending();
    const rec = out.find((o) => o.key === "hang-7")!;
    expect(rec.before).toBe("paying");
    expect(rec.result!.ok).toBe(true);
    expect(rec.after).toBe("confirmed");
    // Running recovery again only re-reads proofs (confirmed, not yet presented): it sends nothing.
    const again = await client({ journal: fj }).recoverPending();
    expect(again.map((o) => o.result?.ok)).toEqual([true, true]);
    expect(await agentNonce()).toBe(n0 + 2);
    expect(await balance()).toBe(before - 2000n);
    const events = await paidRequestIds(fromBlock + 1);
    expect(events.sort()).toEqual([p.ch.requestId.toLowerCase(), dead.challenge!.requestId.toLowerCase()].sort());
  });

  it("PC-08 nonce allocation rules: gaps are reused, sent nonces stay blocked until the chain passes them, stale and superseded leases end", async () => {
    for (const j of [new MemoryJournal({ nonceLeaseTtlMs: 200 }), new FileJournal(tmpJournal(), { nonceLeaseTtlMs: 200 })]) {
      const a = "0x00000000000000000000000000000000000000aa";
      const l5 = await j.allocateNonce(a, 5), l6 = await j.allocateNonce(a, 5), l7 = await j.allocateNonce(a, 5);
      expect([l5.nonce, l6.nonce, l7.nonce]).toEqual([5, 6, 7]);
      await l6.release({ sent: false }); // never broadcast: a gap that would stall nonce 7
      await l5.release({ sent: true }); // possibly in a mempool: must not be handed out again
      expect((await j.allocateNonce(a, 5)).nonce).toBe(6); // the gap is reused first
      const resend = await j.allocateNonce(a, 5, { nonce: 7 }); // a resend takes nonce 7 over from its holder
      expect(resend.nonce).toBe(7);
      await l7.release({ sent: false }); // the superseded holder's release is a no-op...
      expect((await j.allocateNonce(a, 5)).nonce).toBe(8); // ...so 7 stays blocked, and so does the sent 5
      await new Promise((r) => setTimeout(r, 300)); // every lease is now past its TTL
      expect((await j.allocateNonce(a, 5)).nonce).toBe(5); // reclaimed, lowest first
      expect((await j.allocateNonce(a, 20)).nonce).toBe(20); // the chain moved past the journal: max(chainPending, next)
    }
  });

  it("PC-09 S7 deadline margin: a paymentDeadline closer than mining + confirmations + safety is refused before sending; a looser margin pays", async () => {
    // Deadlines are judged on chain time (the seller and the client both use the latest block), so base them on it.
    const chainNow = async () => (await provider.getBlock("latest"))!.timestamp;
    const nowS = await chainNow();
    // confirmations 1, default expectedBlockTimeMs 3600 and deadlineSafetySeconds 10: needs 17.2 s
    {
      const j = new MemoryJournal();
      const c = client({ journal: j });
      const { ch, ctx, key } = await purchase();
      const before = await balance(), n0 = await agentNonce();
      const r = await c.payChallenge({ ...ch, paymentDeadline: nowS + 15 }, ctx);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect([r.error, r.paid, !!r.maybePaid]).toEqual(["challenge_expired", false, false]);
      expect(await balance()).toBe(before);
      expect(await agentNonce()).toBe(n0);
      expect(await j.get(key)).toBeUndefined();
    }
    // a configured safety margin is honoured even with plenty of expiry left
    {
      const c = client({ journal: new MemoryJournal(), deadlineSafetySeconds: 120 });
      const { ch, ctx } = await purchase();
      const r = await c.payChallenge({ ...ch, paymentDeadline: nowS + 100 }, ctx);
      expect(r.ok ? "ok" : r.error).toBe("challenge_expired");
    }
    // faster blocks and a smaller margin fit the same deadline: paid once
    {
      const c = client({ journal: new MemoryJournal(), expectedBlockTimeMs: 500, deadlineSafetySeconds: 2 });
      const { ch, ctx } = await purchase();
      const before = await balance();
      const r = await c.payChallenge({ ...ch, paymentDeadline: (await chainNow()) + 15 }, ctx);
      expect(r.ok).toBe(true);
      expect(await balance()).toBe(before - 1000n);
    }
  });
});
