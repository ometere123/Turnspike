// Adversarial tests (independent tester). Every test asserts the SAFE outcome; a failing test is a finding.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { startNode, stopNode } from "../../../scripts/test-util/hardhat-node";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { ContractFactory, HDNodeWallet, Interface, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { turnspike, type TurnspikeConfig, type TurnspikeMiddleware } from "@turnspike-qie/middleware";
import { TurnspikeClient, MemoryJournal, FileJournal, type Network as TsNetwork } from "@turnspike-qie/client";
import {
  x402Seller, createX402Fetch, MemoryProofStore, FileProofStore, createFacilitatorServer, facilitatorAuthHeaders, canonicalRequest,
  TurnspikeAllowanceClient, SCHEME, b64json, unb64json, callContext,
} from "../src";
import { createHmac } from "node:crypto";

const PORT = 8681;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN = 31337;
const ROOT = resolve(__dirname, "../../..");
const PHRASE = "test test test test test test test test test test test junk";
const SECRET = "s".repeat(40);
const art = (p: string) => JSON.parse(readFileSync(join(ROOT, "artifacts/contracts", p), "utf8"));
const PAID = new Interface(["event Paid(address indexed owner, address indexed agent, address indexed merchant, bytes32 requestId, uint256 amount)"]);

let node: ChildProcess;
let provider: JsonRpcProvider;
let token: ethers.Contract, vault: ethers.Contract;
let ownerW: HDNodeWallet, agentW: HDNodeWallet, ownerNM: NonceManager;
let merchant: string, merchant2: string;
let tsNet: TsNetwork;
let chainOffset = 0;
const clock = () => Math.floor(Date.now() / 1000) + chainOffset;
const syncClock = async () => { chainOffset = (await provider.getBlock("latest"))!.timestamp - Math.floor(Date.now() / 1000); };
const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const mine = (n = 1) => provider.send("hardhat_mine", ["0x" + n.toString(16)]);
const closers: (() => unknown)[] = [];
const head = () => provider.getBlockNumber().then((h) => h + 1);
async function paidLogs(fromBlock: number) {
  const logs = await provider.getLogs({ address: vault.target as string, topics: [PAID.getEvent("Paid")!.topicHash], fromBlock });
  return logs.map((l) => ({ tx: l.transactionHash.toLowerCase(), ...PAID.parseLog({ topics: [...l.topics], data: l.data })!.args.toObject() }));
}
const listen = (app: express.Express): Promise<Server> => new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
const baseOf = (s: Server) => `http://127.0.0.1:${(s.address() as any).port}`;

interface Seller { base: string; mw: TurnspikeMiddleware; calls: { n: number }; events: Record<string, unknown>[]; flags: Record<string, any> }
async function startSeller(over: Partial<TurnspikeConfig> = {}, extra?: (app: express.Express, flags: Record<string, any>) => void): Promise<Seller> {
  const dir = mkdtempSync(join(tmpdir(), "x402adv-"));
  const events: Record<string, unknown>[] = [];
  const mw = turnspike({
    rpcUrls: [RPC], chainId: CHAIN, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: [SECRET],
    dbPath: join(dir, "s.sqlite"), confirmations: 1, retryAfterSeconds: 1, prices: { "/report": 1000, "/other": 1000, "/bad": 1000 }, x402: true,
    rateLimitPerMinute: 100_000, paymentGraceSeconds: 10 ** 9, clock, onEvent: (e) => events.push(e), ...over,
  });
  const calls = { n: 0 };
  const flags: Record<string, any> = {};
  const app = express();
  extra?.(app, flags);
  app.use("/v1", x402Seller(mw));
  app.get("/v1/report", (q, r) => r.json({ route: "report", query: q.query, n: ++calls.n, marker: "SECRET-BODY-MARKER" }));
  app.get("/v1/other", (_q, r) => r.json({ route: "other", n: ++calls.n }));
  app.get("/v1/bad", (_q, r) => {
    ++calls.n;
    if (flags.mode === "500") return void r.status(500).json({ error: "boom" });
    if (flags.mode === "402") return void r.status(402).json({ error: "pay again" });
    r.json({ route: "bad", ok: true });
  });
  const server = await listen(app);
  closers.push(() => { server.closeAllConnections?.(); server.close(); mw.close(); });
  return { base: baseOf(server), mw, calls, events, flags };
}

function mkAgent(payees: { origin: string; merchant: string }[], o: { journal?: any; proofStore?: any; retry?: any; onEvent?: any; clientEvent?: any } = {}) {
  const journal = o.journal ?? new MemoryJournal();
  const client = new TurnspikeClient({ signer: agentW, owner: ownerW.address, network: tsNet, policy: { payees, maxPriceBase: 10_000n }, journal, confirmations: 1, txTimeoutMs: 20_000, onEvent: o.clientEvent } as any);
  const proofStore = o.proofStore ?? new MemoryProofStore();
  const pay = createX402Fetch({ client, journal, owner: ownerW.address, agent: agentW.address, network: { chainId: CHAIN, token: tsNet.token }, proofStore, retry: o.retry ?? { attempts: 4, baseDelayMs: 200, maxDelayMs: 1000, totalMs: 15_000 }, onEvent: o.onEvent });
  return { pay, client, journal, proofStore };
}
const present = (url: string, header: string, extra: Record<string, string> = {}) => fetch(url, { headers: { "payment-signature": header, ...extra } });
async function rawChallenge(url: string) {
  const r = await fetch(url);
  return { status: r.status, body: await r.json(), required: unb64json<any>(r.headers.get("payment-required")!) };
}
async function payDirect(url: string) {
  const c = await rawChallenge(url);
  const acc = c.required.accepts[0];
  const tx = await (vault.connect(agentW) as any).pay(ownerW.address, acc.payTo, acc.extra.requestId, BigInt(acc.amount));
  await tx.wait();
  return { header: b64json({ x402Version: 2, resource: c.required.resource, accepted: acc, payload: { requestId: acc.extra.requestId, txHash: tx.hash, sig: acc.extra.sig } }), acc, txHash: tx.hash as string, challenge: c };
}
/** A seller that serves a forged (but on-chain payable) 402; `mut` customises it. Records PAYMENT-SIGNATURE hits. */
async function fakeSeller(mut: (pr: any, base: string) => void) {
  const hits = { sig: 0 };
  const app = express();
  let base = "";
  app.use((q, _r, n) => { if (q.header("payment-signature")) hits.sig++; n(); });
  app.get("/x", (_q, r) => {
    const acc = { scheme: SCHEME, network: "eip155:31337", amount: "1000", asset: tsNet.token, payTo: merchant, maxTimeoutSeconds: 300,
      extra: { resourceId: "/x", protocol: "turnspike/1", contract: tsNet.contract, assetTransferMethod: "vault-pay", paymentFlow: "upfront", requestId: ethers.id("x" + Math.random()), sig: "ab".repeat(32), expiresAt: clock() + 300, paymentDeadline: clock() + 360 } };
    const pr = { x402Version: 2, resource: { url: `${base}/x` }, accepts: [acc] };
    mut(pr, base);
    r.status(402).setHeader("PAYMENT-REQUIRED", b64json(pr)).json({});
  });
  const s = await listen(app);
  base = baseOf(s);
  closers.push(() => s.close());
  return { base, hits };
}

let A: Seller;

beforeAll(async () => {
  process.env.TURNSPIKE_LOG = "off";
  node = startNode(PORT, ROOT);
  provider = new JsonRpcProvider(RPC, CHAIN, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; i < 120; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const deployer = new NonceManager(w(0));
  const mock = art("test-helpers/MockERC20.sol/MockERC20.json");
  token = (await (await new ContractFactory(mock.abi, mock.bytecode, deployer).deploy()).waitForDeployment()) as any;
  const va = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  vault = (await (await new ContractFactory(va.abi, va.bytecode, deployer).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment()) as any;
  ownerW = w(4); agentW = w(1); merchant = w(2).address; merchant2 = w(3).address;
  ownerNM = new NonceManager(ownerW);
  await (await (token.connect(deployer) as any).mint(ownerW.address, 10_000_000n)).wait();
  await (await (token.connect(ownerNM) as any).approve(vault.target, 10n ** 12n)).wait();
  await (await (vault.connect(ownerNM) as any).deposit(4_000_000n)).wait();
  await (await (vault.connect(ownerNM) as any).setPolicy(agentW.address, 50_000n, 1_000_000n)).wait();
  await (await (vault.connect(ownerNM) as any).setMerchant(merchant, true)).wait();
  await (await (vault.connect(ownerNM) as any).setMerchant(merchant2, true)).wait();
  tsNet = { name: "local", chainId: CHAIN, contract: vault.target as string, token: token.target as string, decimals: 6, rpcUrls: [RPC], explorer: "http://explorer.local" };
  await syncClock();
  A = await startSeller();
}, 180_000);

afterAll(() => {
  for (const c of closers) { try { c(); } catch { /* ignore */ } }
  stopNode(node);
  provider?.destroy();
});

/* ------------------------------------------------------------------ 1. payee binding */
describe("1 payee binding", () => {
  it("1a 402 from an origin not on the payee list: refused, nothing paid", async () => {
    const from = await head();
    const r = await mkAgent([{ origin: "http://127.0.0.1:1", merchant }]).pay(`${A.base}/v1/report?pb=1`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.error, r.paid, r.maybePaid]).toEqual(["untrusted_destination", false, false]);
    expect(await paidLogs(from)).toHaveLength(0);
  });

  it("1b same-origin redirect to a path that 402s: pays once for the final resource and delivers it", async () => {
    const S = await startSeller({}, (app) => app.get("/go", (_q, r) => r.redirect(302, "/v1/report?redir=1")));
    const from = await head();
    const r = await mkAgent([{ origin: S.base, merchant }]).pay(`${S.base}/go`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(await r.response.json()).toMatchObject({ route: "report", query: { redir: "1" } });
    expect(await paidLogs(from)).toHaveLength(1);
    expect(S.calls.n).toBe(1);
  });

  it("1c cross-origin redirect before payment: refused, nothing paid", async () => {
    const S = await startSeller({}, (app) => app.get("/go", (_q, r) => r.redirect(302, `${A.base}/v1/report?xo=1`)));
    const from = await head();
    const r = await mkAgent([{ origin: S.base, merchant }, { origin: A.base, merchant }]).pay(`${S.base}/go`);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toBe("cross_origin_redirect"); expect(r.paid).toBe(false); }
    expect(await paidLogs(from)).toHaveLength(0);
  });

  it("1d cross-origin redirect AFTER payment: PAYMENT-SIGNATURE never sent to the other origin", async () => {
    const evil = await fakeSeller(() => {});
    const S = await startSeller({}, (app, f) => app.use((q, r, n) => (q.header("payment-signature") && f.redir !== false ? r.redirect(307, `${evil.base}/steal`) : n())));
    const from = await head();
    const r = await mkAgent([{ origin: S.base, merchant }]).pay(`${S.base}/v1/report?xo2=1`);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.paid).toBe(true); expect(r.error).toBe("cross_origin_redirect"); }
    expect(evil.hits.sig).toBe(0);
    expect(await paidLogs(from)).toHaveLength(1);
  });

  it("1e PaymentRequired.resource.url on another origin: refused before paying", async () => {
    const f = await fakeSeller((pr) => { pr.resource.url = "http://evil.example/x"; });
    const from = await head();
    const r = await mkAgent([{ origin: f.base, merchant }]).pay(`${f.base}/x`);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.paid).toBe(false); expect(r.maybePaid).toBe(false); }
    expect(await paidLogs(from)).toHaveLength(0);
  });

  it("1f PaymentRequired.resource.url missing or not a URL: refused before paying", async () => {
    const from = await head();
    for (const m of [(pr: any) => delete pr.resource, (pr: any) => (pr.resource.url = "javascript:alert(1)"), (pr: any) => (pr.resource.url = "/x")]) {
      const f = await fakeSeller(m);
      const r = await mkAgent([{ origin: f.base, merchant }]).pay(`${f.base}/x`);
      expect(r.ok).toBe(false);
    }
    expect(await paidLogs(from)).toHaveLength(0);
  });

  it("1g Request object input: fails closed (throws or refuses), nothing paid", async () => {
    const from = await head();
    const out = await mkAgent([{ origin: A.base, merchant }]).pay(new Request(`${A.base}/v1/report?req=1`) as any).catch(() => ({ ok: false, thrown: true }));
    expect(out.ok).toBe(false);
    expect(await paidLogs(from)).toHaveLength(0);
  });

  it("1h origin variants: credentials, other port, trailing dot, localhost vs 127.0.0.1 never pay; uppercase scheme/host pays once to the right merchant", async () => {
    const port = new URL(A.base).port;
    const payees = [{ origin: A.base, merchant }];
    const from = await head();
    const variants = [`http://user:pw@127.0.0.1:${port}/v1/report?v=1`, `http://127.0.0.1:1${port}/v1/report?v=2`, `http://localhost.:${port}/v1/report?v=3`, `http://localhost:${port}/v1/report?v=4`];
    for (const u of variants) {
      const r = await mkAgent(payees).pay(u).catch((e) => ({ ok: false, error: String(e) } as any));
      expect([u, r.ok]).toEqual([u, false]);
    }
    expect(await paidLogs(from)).toHaveLength(0);
    const up = await mkAgent(payees).pay(`HTTP://127.0.0.1:${port}/v1/report?v=5`);
    expect(up.ok).toBe(true);
    const logs = await paidLogs(from);
    expect(logs).toHaveLength(1);
    expect(logs[0].merchant.toLowerCase()).toBe(merchant.toLowerCase());
  });

  it("1i client scheme without the wrapper context: fails closed, nothing paid", async () => {
    const a = mkAgent([{ origin: A.base, merchant }]);
    const c = await rawChallenge(`${A.base}/v1/report?noctx=1`);
    const sch = new TurnspikeAllowanceClient(a.client as any);
    await expect(sch.createPaymentPayload(2, c.required.accepts[0])).rejects.toThrow(/no_call_context/);
    const xc = new x402Client();
    xc.register("eip155:31337" as any, sch);
    const from = await head();
    let outcome = "";
    try { outcome = String((await wrapFetchWithPayment(fetch, xc)(`${A.base}/v1/report?noctx=2`)).status); } catch (e: any) { outcome = "threw " + e.message; }
    expect(outcome).toMatch(/threw/);
    expect(await paidLogs(from)).toHaveLength(0);
  });

  it("1j explicit purchaseKey reused for a different URL never returns the other resource as this one", async () => {
    const a = mkAgent([{ origin: A.base, merchant }]);
    const r1 = await a.pay(`${A.base}/v1/report?pk=1`, {}, { purchaseKey: "k-shared" });
    expect(r1.ok).toBe(true);
    const from = await head();
    const r2 = await a.pay(`${A.base}/v1/other`, {}, { purchaseKey: "k-shared" });
    expect(await paidLogs(from)).toHaveLength(0);
    // SAFE: a refusal (idempotency conflict), not ok:true carrying /report?pk=1's body as the answer for /other
    if (r2.ok) expect((await r2.response.json()).route).toBe("other");
  });
});

/* ------------------------------------------------------------------ 2. double charge */
describe("2 double charge", () => {
  it("2a concurrent pay() for the same resource without purchaseKey: exactly one charge", async () => {
    const a = mkAgent([{ origin: A.base, merchant }]);
    const from = await head();
    const url = `${A.base}/v1/report?conc=1`;
    const rs = await Promise.all([a.pay(url), a.pay(url), a.pay(url)]);
    expect(await paidLogs(from)).toHaveLength(1);
    expect(rs.some((r) => r.ok)).toBe(true);
    // the losers can complete afterwards without a new charge
    for (const r of rs) if (!r.ok) expect((await a.pay(url)).ok).toBe(true);
    expect(await paidLogs(from)).toHaveLength(1);
  });

  it("2b seller 500 after settle, then process restart with a FileProofStore/FileJournal pair: one charge, delivered", async () => {
    const S = await startSeller();
    S.flags.mode = "500";
    const dir = mkdtempSync(join(tmpdir(), "x402advj-"));
    const mk = () => mkAgent([{ origin: S.base, merchant }], { journal: new FileJournal(join(dir, "j.json")), proofStore: new FileProofStore(join(dir, "p.json")), retry: { attempts: 2, baseDelayMs: 100, maxDelayMs: 100, totalMs: 3000 } });
    const from = await head();
    const url = `${S.base}/v1/bad?rs=1`;
    const r1 = await mk().pay(url);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.paid).toBe(true);
    S.flags.mode = "ok";
    const r2 = await mk().pay(url); // "restarted" process: new instances over the same files
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.resumed).toBe(true);
    expect(await paidLogs(from)).toHaveLength(1);
  });

  it("2c seller answers 402 after settle: no second payment; later delivered with the same proof", async () => {
    const S = await startSeller();
    S.flags.mode = "402";
    const a = mkAgent([{ origin: S.base, merchant }]);
    const from = await head();
    const url = `${S.base}/v1/bad?p402=1`;
    const r1 = await a.pay(url);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.paid || r1.maybePaid).toBe(true);
    expect(await paidLogs(from)).toHaveLength(1);
    S.flags.mode = "ok";
    const r2 = await a.pay(url);
    expect(r2.ok).toBe(true);
    expect(await paidLogs(from)).toHaveLength(1);
  });

  it("2d connection reset on every paid response, then recovery: one charge", async () => {
    const S = await startSeller({}, (app, f) => app.use((q, r, n) => {
      if (f.reset && q.header("payment-signature")) { (r as any).end = () => { q.socket.destroy(); return r; }; }
      n();
    }));
    S.flags.reset = true;
    const a = mkAgent([{ origin: S.base, merchant }], { retry: { attempts: 2, baseDelayMs: 100, maxDelayMs: 100, totalMs: 3000 } });
    const from = await head();
    const url = `${S.base}/v1/report?reset=1`;
    const r1 = await a.pay(url);
    expect(r1.ok).toBe(false);
    S.flags.reset = false;
    expect((await a.pay(url)).ok).toBe(true);
    expect(await paidLogs(from)).toHaveLength(1);
    expect(S.calls.n).toBe(1);
  });

  it("2e intents: same intent twice = one charge; a different intent = a deliberate second charge", async () => {
    const a = mkAgent([{ origin: A.base, merchant }]);
    const url = `${A.base}/v1/report?intent=1`;
    const from = await head();
    expect((await a.pay(url, {}, { intent: "a" })).ok).toBe(true);
    expect((await a.pay(url, {}, { intent: "a" })).ok).toBe(true);
    expect(await paidLogs(from)).toHaveLength(1);
    expect((await a.pay(url, {}, { intent: "b" })).ok).toBe(true);
    expect(await paidLogs(from)).toHaveLength(2);
    expect((await a.pay(url)).ok).toBe(true); // no intent: its own key
    expect(await paidLogs(from)).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ 3. proof theft */
describe("3 proof theft", () => {
  it("3a stolen PAYMENT-SIGNATURE: only a replay of the same stored response, on that resource, within the window", async () => {
    const S = await startSeller({ replayWindowSeconds: 3 });
    const a = mkAgent([{ origin: S.base, merchant }]);
    const r = await a.pay(`${S.base}/v1/report?steal=1`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = await r.response.text();
    const stolen = (await a.proofStore.get(r.purchaseKey))!.header!;
    const calls = S.calls.n;
    const thief = await present(`${S.base}/v1/report?steal=1`, stolen);
    expect(thief.status).toBe(200);
    expect(thief.headers.get("x-turnspike-replay")).toBe("1");
    expect(await thief.text()).toBe(body);
    expect((await present(`${S.base}/v1/report?steal=2`, stolen)).status).toBe(402);
    expect((await present(`${S.base}/v1/other`, stolen)).status).toBe(402);
    expect((await present(`${A.base}/v1/report?steal=1`, stolen)).status).toBeGreaterThanOrEqual(400); // other seller instance (other store)
    const proof = unb64json<any>(stolen).payload;
    expect((await fetch(`${S.base}/v1/other`, { headers: { "x-payment": b64json(proof) } })).status).toBe(403);
    expect(S.calls.n).toBe(calls);
    await new Promise((res) => setTimeout(res, 4200));
    expect((await present(`${S.base}/v1/report?steal=1`, stolen)).status).toBe(410);
    expect((await fetch(`${S.base}/v1/report?steal=1`, { headers: { "x-payment": b64json(proof) } })).status).toBe(410);
  });

  it("3b tampering accepted (amount, payTo, network, asset, resourceId) with a valid proof never delivers", async () => {
    const { header } = await payDirect(`${A.base}/v1/report?tamp=1`);
    const p = unb64json<any>(header);
    const calls = A.calls.n;
    const muts: ((x: any) => void)[] = [
      (x) => (x.accepted.amount = "1"), (x) => (x.accepted.amount = "100000"), (x) => (x.accepted.payTo = merchant2),
      (x) => (x.accepted.network = "eip155:1"), (x) => (x.accepted.asset = merchant2), (x) => (x.accepted.extra.resourceId = "/other"),
      (x) => (x.payload.txHash = "0x" + "00".repeat(32)), (x) => (x.resource = { url: "http://evil/" }), (x) => (x.accepted.extra.expiresAt = 1), (x) => (x.accepted.extra.paymentDeadline = 1),
    ];
    const delivered: number[] = [];
    for (const [i, m] of muts.entries()) { const v = structuredClone(p); m(v); if ((await present(`${A.base}/v1/report?tamp=1`, b64json(v))).status < 400) delivered.push(i); }
    // indices: 0 amount=1, 1 amount=100000, 2 payTo, 3 network, 4 asset, 5 resourceId, 6 txHash, 7 resource.url, 8 expiresAt, 9 paymentDeadline
    expect(delivered).toEqual([]);
    expect(A.calls.n).toBe(calls);
    expect((await present(`${A.base}/v1/report?tamp=1`, header)).status).toBe(200);
  });
});

/* ------------------------------------------------------------------ 4. facilitator server */
describe("4 facilitator server", () => {
  const FS = "f".repeat(40);
  const sign = (method: string, path: string, body: string, ts = String(Math.floor(Date.now() / 1000)), nonce = Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32)) => ({
    "x-turnspike-timestamp": ts, "x-turnspike-nonce": nonce, "x-turnspike-signature": createHmac("sha256", FS).update(canonicalRequest(ts, nonce, method, path, body)).digest("hex"),
  });

  it("4a HMAC bypass attempts are all 401; malformed bodies are 4xx with no stack; Object.prototype untouched", async () => {
    const events: Record<string, unknown>[] = [];
    const F = await createFacilitatorServer({ backend: A.mw, secrets: [FS], onEvent: (e) => events.push(e), maxBodyBytes: 4096 });
    closers.push(() => F.close());
    const body = JSON.stringify({ x402Version: 2 });
    const post = (path: string, b: string, h: Record<string, string>, ct = "application/json") => fetch(`${F.url}${path}`, { method: "POST", body: b, headers: { "content-type": ct, ...h } });
    // body changed after signing
    expect((await post("/settle", body + " ", sign("POST", "/settle", body))).status).toBe(401);
    // path changed after signing (verify -> settle), case change, trailing slash
    expect((await post("/settle", body, sign("POST", "/verify", body))).status).toBe(401);
    expect((await post("/SETTLE", body, sign("POST", "/settle", body))).status).toBe(401);
    expect((await post("/settle/", body, sign("POST", "/settle", body))).status).toBe(401);
    // method changed
    expect((await fetch(`${F.url}/supported`, { headers: sign("POST", "/supported", "") })).status).toBe(401);
    // uppercase hex signature / header-name case: header names are case-insensitive by HTTP, so only the value matters
    const h = sign("GET", "/supported", "");
    expect((await fetch(`${F.url}/supported`, { headers: { ...h, "x-turnspike-signature": h["x-turnspike-signature"].toUpperCase() } })).status).toBe(401);
    // timestamp skew edges
    const now = Math.floor(Date.now() / 1000);
    expect((await fetch(`${F.url}/supported`, { headers: sign("GET", "/supported", "", String(now - 62)) })).status).toBe(401);
    expect((await fetch(`${F.url}/supported`, { headers: sign("GET", "/supported", "", String(now + 62)) })).status).toBe(401);
    expect((await fetch(`${F.url}/supported`, { headers: sign("GET", "/supported", "", String(now - 55)) })).status).toBe(200);
    expect((await fetch(`${F.url}/supported`, { headers: sign("GET", "/supported", "", "-" + now) })).status).toBe(401);
    // nonce reuse with a fresh signature
    const n = "a".repeat(32);
    expect((await fetch(`${F.url}/supported`, { headers: sign("GET", "/supported", "", undefined, n) })).status).toBe(200);
    expect((await fetch(`${F.url}/supported`, { headers: sign("GET", "/supported", "", undefined, n) })).status).toBe(401);
    // query string appended to a signed request: the route ignores it (not a bypass, documented)
    // oversized body (signed): 413, generic error
    const big = JSON.stringify({ pad: "x".repeat(10_000) });
    const r413 = await post("/settle", big, sign("POST", "/settle", big));
    expect(r413.status).toBe(413);
    // malformed JSON, prototype pollution, odd content types (all signed): 400, no stack
    const bads: [string, string][] = [
      ["{not json", "application/json"],
      [JSON.stringify({ __proto__: { polluted: 1 }, constructor: { prototype: { polluted: 1 } } }), "application/json"],
      ['{"x402Version":2,"paymentPayload":{"x402Version":2,"accepted":{"scheme":"a","network":"eip155:1","amount":"1","asset":"a","payTo":"a","maxTimeoutSeconds":1,"extra":{"__proto__":{"polluted":1}}},"payload":{"__proto__":{"polluted":1}}},"paymentRequirements":{"scheme":"a","network":"eip155:1","amount":"1","asset":"a","payTo":"a","maxTimeoutSeconds":1,"extra":{"__proto__":{"polluted":1}}}}', "application/json"],
      ['{"x402Version":2,"paymentPayload":{"x402Version":2,"accepted":{"scheme":"a","network":"eip155:1","amount":"1","asset":"a","payTo":"a","maxTimeoutSeconds":1,"extra":{}},"payload":{}},"paymentRequirements":{"scheme":"a","network":"eip155:1","amount":"1","asset":"a","payTo":"a","maxTimeoutSeconds":1,"extra":{}}}', "application/json"],
      [body, "text/plain"], [body, "application/x-www-form-urlencoded"], ["", "application/octet-stream"],
    ];
    const results: unknown[] = [];
    for (const [b, ct] of bads) {
      for (const path of ["/settle", "/verify"]) {
        const r = await post(path, b, sign("POST", path, b), ct);
        const t = await r.text();
        results.push([path, ct, b.slice(0, 40), r.status]);
        expect(t).not.toMatch(/\bat [\w.<>]+ \(|node_modules|Error:/);
      }
    }
    console.log("4a statuses", JSON.stringify(results));
    // SAFE: every malformed or unsupported body is a 4xx (or a 200 failure response), never a 500
    expect(results.filter((x: any) => x[3] >= 500)).toEqual([]);
    expect(({} as any).polluted).toBeUndefined();
    expect(JSON.stringify(events)).not.toMatch(/x-turnspike-signature|[0-9a-f]{64}/);
  });

  it("4b nonce replay after a facilitator restart within the skew window is refused (in-memory nonce cache)", async () => {
    const F1 = await createFacilitatorServer({ backend: A.mw, secrets: [FS], onEvent: () => {} });
    const h = facilitatorAuthHeaders(FS, "GET", "/supported", "");
    expect((await fetch(`${F1.url}/supported`, { headers: h })).status).toBe(200);
    await F1.close();
    const F2 = await createFacilitatorServer({ backend: A.mw, secrets: [FS], onEvent: () => {} });
    closers.push(() => F2.close());
    expect((await fetch(`${F2.url}/supported`, { headers: h })).status).toBe(401); // expected FAIL: documented limitation
  });
});

/* ------------------------------------------------------------------ 5. DoS */
describe("5 DoS", () => {
  it("5a spoofed X-Forwarded-For does not get a fresh challenge bucket; unique query strings share the bucket", async () => {
    const S = await startSeller({ guard: { burst: 3, refillPerSecond: 0.001 } });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await fetch(`${S.base}/v1/report?u=${i}`, { headers: { "x-forwarded-for": `10.0.0.${i}`, "x-real-ip": `10.1.0.${i}` } })).status);
    expect(codes).toEqual([402, 402, 402, 429, 429, 429]);
    expect(S.mw.store.db.prepare("SELECT COUNT(*) c FROM payments").get()).toEqual({ c: 3 });
  });

  it("5b unpaid-row cap filled by many client keys: new challenges 503, but a legitimate holder of a challenge still pays and is delivered", async () => {
    let k = 0;
    const S = await startSeller({ guard: { maxUnpaidPerRoute: 5, clientKey: () => String(++k) } });
    const legit = await payDirect(`${S.base}/v1/report?legit=1`); // paid: no longer unpaid
    for (let i = 0; i < 10; i++) await fetch(`${S.base}/v1/report?flood=${i}`);
    const blocked = await fetch(`${S.base}/v1/report?late=1`);
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(S.mw.store.db.prepare("SELECT COUNT(*) c FROM payments").get()).toEqual({ c: 5 }); // the legit (paid, not yet presented) row counts as live unpaid
    expect((await present(`${S.base}/v1/report?legit=1`, legit.header)).status).toBe(200);
    expect((await fetch(`${S.base}/v1/other`)).status).toBe(402);
  });

  it("5c reaper never deletes a row paid on chain whose proof was never presented", async () => {
    const S = await startSeller({ challengeTtlSeconds: 15, paymentGraceSeconds: 1 });
    const unpaid = await rawChallenge(`${S.base}/v1/report?rp=1`);
    const paid = await payDirect(`${S.base}/v1/report?rp=2`); // paid, never presented
    await provider.send("evm_increaseTime", [120]); await mine(2); await syncClock();
    await S.mw.reconcile({ lookbackBlocks: 500 });
    S.mw.reap();
    expect(S.mw.store.get(unpaid.body.requestId)).toBeUndefined();
    expect(S.mw.store.get(paid.acc.extra.requestId.toLowerCase())).toBeDefined();
  });
});

/* ------------------------------------------------------------------ 6. owner controls */
describe("6 owner controls under x402", () => {
  const o = () => vault.connect(ownerNM) as any;
  const restore = async () => {
    await (await o().setPolicy(agentW.address, 50_000n, 1_000_000n)).wait();
    await (await o().setMerchant(merchant, true)).wait();
    await (await o().setPaused(false)).wait();
  };
  const cases: [string, () => Promise<unknown>, string][] = [
    ["per-call cap", async () => (await o().setPolicy(agentW.address, 500n, 1_000_000n)).wait(), "over_per_call_cap"],
    ["daily cap", async () => { const spent: bigint = await vault.spentToday(ownerW.address); return (await o().setPolicy(agentW.address, 50_000n, spent + 500n)).wait(); }, "over_daily_cap"],
    ["merchant allowlist", async () => (await o().setMerchant(merchant, false)).wait(), "merchant_not_allowed"],
    ["pause", async () => (await o().setPaused(true)).wait(), "paused"],
    ["revoke", async () => (await o().revokeAgent()).wait(), "not_authorized_agent"],
  ];
  for (const [name, apply, code] of cases) {
    it(`6 ${name}: refused before broadcast, nothing charged`, async () => {
      await apply();
      try {
        const nonce = await provider.getTransactionCount(agentW.address, "pending");
        const from = await head();
        const r = await mkAgent([{ origin: A.base, merchant }]).pay(`${A.base}/v1/report?oc=${encodeURIComponent(name)}`);
        expect(r.ok).toBe(false);
        if (!r.ok) expect([r.error, r.paid, r.maybePaid]).toEqual([code, false, false]);
        expect(await provider.getTransactionCount(agentW.address, "pending")).toBe(nonce);
        expect(await paidLogs(from)).toHaveLength(0);
      } finally { await restore(); }
    });
  }

  it("6 downgrade: turnspike/1-paid proof over x402 on the same resource replays once (no second handler run); on another resource refused", async () => {
    const c = await rawChallenge(`${A.base}/v1/report?dg=1`);
    const tx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, c.body.requestId, 1000n); await tx.wait();
    const t1 = await fetch(`${A.base}/v1/report?dg=1`, { headers: { "x-payment": b64json({ requestId: c.body.requestId, txHash: tx.hash, sig: c.body.sig }) } });
    expect(t1.status).toBe(200);
    const calls = A.calls.n;
    const asX = b64json({ x402Version: 2, resource: c.required.resource, accepted: c.required.accepts[0], payload: { requestId: c.body.requestId, txHash: tx.hash, sig: c.body.sig } });
    const x1 = await present(`${A.base}/v1/report?dg=1`, asX);
    expect(x1.status).toBe(200); expect(x1.headers.get("x-turnspike-replay")).toBe("1");
    expect((await present(`${A.base}/v1/report?dg=2`, asX)).status).toBe(402);
    expect((await present(`${A.base}/v1/other`, asX)).status).toBe(402);
    expect(A.calls.n).toBe(calls);
  });
});

/* ------------------------------------------------------------------ 7. log redaction */
describe("7 log redaction", () => {
  it("no sig, PAYMENT-SIGNATURE, private key or body in any emitted event", async () => {
    const S = await startSeller();
    const agentEvents: unknown[] = [], clientEvents: unknown[] = [];
    const a = mkAgent([{ origin: S.base, merchant }], { onEvent: (e: unknown) => agentEvents.push(e), clientEvent: (e: unknown) => clientEvents.push(e) });
    const r = await a.pay(`${S.base}/v1/report?log=1`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const header = (await a.proofStore.get(r.purchaseKey))!.header!;
    const p = unb64json<any>(header);
    await present(`${S.base}/v1/report?log=1`, header); // a replay also logs
    const all = JSON.stringify([S.events, agentEvents, clientEvents]);
    expect(S.events.length).toBeGreaterThan(0);
    for (const secret of [header, header.slice(0, 40), p.payload.sig, p.accepted.extra.sig, agentW.privateKey, agentW.privateKey.slice(2), SECRET, "SECRET-BODY-MARKER"]) {
      expect(all.includes(secret)).toBe(false);
    }
  });
});

void callContext;
