import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { ContractFactory, HDNodeWallet, Interface, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { turnspike, Store, type TurnspikeConfig, type TurnspikeMiddleware } from "@turnspike-qie/middleware";
import { TurnspikeClient, MemoryJournal, type Network as TsNetwork } from "@turnspike-qie/client";
import {
  x402Seller, createX402Fetch, MemoryProofStore, LocalFacilitatorClient, RemoteFacilitatorClient, createFacilitatorServer, facilitatorAuthHeaders,
  SCHEME, b64json, unb64json, ErrorCodes,
} from "../src";

// Local Hardhat chain only (31337), the REAL TurnpikeAllowance and the repo's labelled MockERC20 test double.
const PORT = 8661;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN = 31337;
const ROOT = resolve(__dirname, "../../..");
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
const SECRET = "s".repeat(40);
const art = (p: string) => JSON.parse(readFileSync(join(ROOT, "artifacts/contracts", p), "utf8"));
const PAID = new Interface(["event Paid(address indexed owner, address indexed agent, address indexed merchant, bytes32 requestId, uint256 amount)"]);

let node: ChildProcess;
let provider: JsonRpcProvider;
let token: ethers.Contract, vault: ethers.Contract, otherToken: string;
let ownerW: HDNodeWallet, agentW: HDNodeWallet;
let merchant: string, merchant2: string;
let tsNet: TsNetwork;
let chainOffset = 0;
const clock = () => Math.floor(Date.now() / 1000) + chainOffset;
const syncClock = async () => { chainOffset = (await provider.getBlock("latest"))!.timestamp - Math.floor(Date.now() / 1000); };
const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const mine = (n = 1) => provider.send("hardhat_mine", ["0x" + n.toString(16)]);
const closers: (() => unknown)[] = [];

async function paidLogs(fromBlock: number) {
  const logs = await provider.getLogs({ address: vault.target as string, topics: [PAID.getEvent("Paid")!.topicHash], fromBlock });
  return logs.map((l) => ({ tx: l.transactionHash.toLowerCase(), ...PAID.parseLog({ topics: [...l.topics], data: l.data })!.args.toObject() }));
}
const head = () => provider.getBlockNumber().then((h) => h + 1);

interface Seller { base: string; mw: TurnspikeMiddleware; calls: { n: number }; server: Server }
async function startSeller(over: Partial<TurnspikeConfig> = {}, extra?: (app: express.Express) => void, sellerOpts: Parameters<typeof x402Seller>[1] = {}): Promise<Seller> {
  const dir = mkdtempSync(join(tmpdir(), "x402t-"));
  const mw = turnspike({
    rpcUrls: [RPC], chainId: CHAIN, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: [SECRET],
    dbPath: join(dir, "s.sqlite"), confirmations: 1, retryAfterSeconds: 1, prices: { "/report": 1000, "/other": 1000 }, x402: true,
    rateLimitPerMinute: 100_000, paymentGraceSeconds: 10 ** 9, clock, onEvent: () => {}, ...over,
  });
  const calls = { n: 0 };
  const app = express();
  extra?.(app);
  app.use("/v1", x402Seller(mw, sellerOpts));
  app.get("/v1/report", (q, r) => r.json({ route: "report", query: q.query, n: ++calls.n }));
  app.get("/v1/other", (_q, r) => r.json({ route: "other", n: ++calls.n }));
  const server: Server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  closers.push(() => { server.closeAllConnections?.(); server.close(); mw.close(); });
  return { base, mw, calls, server };
}

function mkAgent(payees: { origin: string; merchant: string }[], over: Record<string, unknown> = {}, fetchOver: Record<string, unknown> = {}) {
  const journal = new MemoryJournal();
  const client = new TurnspikeClient({ signer: agentW, owner: ownerW.address, network: tsNet, policy: { payees, maxPriceBase: 10_000n }, journal, confirmations: 1, txTimeoutMs: 20_000, ...over } as any);
  const proofStore = new MemoryProofStore();
  const pay = createX402Fetch({ client, journal, owner: ownerW.address, agent: agentW.address, network: { chainId: CHAIN, token: tsNet.token }, proofStore, retry: { attempts: 6, baseDelayMs: 300, maxDelayMs: 2000, totalMs: 30_000 }, ...fetchOver });
  return { pay, client, journal, proofStore };
}
const sentHeader = async (a: ReturnType<typeof mkAgent>, key: string) => (await a.proofStore.get(key))!.header!;
const present = (url: string, header: string, extra: Record<string, string> = {}) => fetch(url, { headers: { "payment-signature": header, ...extra } });
const prOf = (r: Response) => { const h = r.headers.get("payment-response"); return h ? unb64json<any>(h) : null; };
async function rawChallenge(url: string) {
  const r = await fetch(url);
  return { status: r.status, body: await r.json(), required: unb64json<any>(r.headers.get("payment-required")!) };
}
/** Pays a raw challenge directly from the agent key (bypassing the client), returns the PAYMENT-SIGNATURE for it. */
async function payDirect(url: string, opts: { wait?: boolean } = {}) {
  const c = await rawChallenge(url);
  const acc = c.required.accepts[0];
  const tx = await (vault.connect(agentW) as any).pay(ownerW.address, acc.payTo, acc.extra.requestId, BigInt(acc.amount));
  if (opts.wait !== false) await tx.wait();
  return { header: b64json({ x402Version: 2, resource: c.required.resource, accepted: acc, payload: { requestId: acc.extra.requestId, txHash: tx.hash, sig: acc.extra.sig } }), acc, txHash: tx.hash as string, challenge: c };
}

let A: Seller;

beforeAll(async () => {
  process.env.TURNSPIKE_LOG = "off";
  node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: ROOT, shell: true, stdio: "ignore" });
  provider = new JsonRpcProvider(RPC, CHAIN, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; i < 120; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const deployer = new NonceManager(w(0));
  const mock = art("test-helpers/MockERC20.sol/MockERC20.json");
  token = (await (await new ContractFactory(mock.abi, mock.bytecode, deployer).deploy()).waitForDeployment()) as any;
  otherToken = await (await (await new ContractFactory(mock.abi, mock.bytecode, deployer).deploy()).waitForDeployment()).getAddress();
  const va = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  vault = (await (await new ContractFactory(va.abi, va.bytecode, deployer).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment()) as any;
  ownerW = w(4); agentW = w(1); merchant = w(2).address; merchant2 = w(3).address;
  const o = new NonceManager(ownerW);
  await (await (token.connect(deployer) as any).mint(ownerW.address, 10_000_000n)).wait();
  await (await (token.connect(o) as any).approve(vault.target, 10n ** 12n)).wait();
  await (await (vault.connect(o) as any).deposit(4_000_000n)).wait();
  await (await (vault.connect(o) as any).setPolicy(agentW.address, 50_000n, 1_000_000n)).wait();
  await (await (vault.connect(o) as any).setMerchant(merchant, true)).wait();
  await (await (vault.connect(o) as any).setMerchant(merchant2, true)).wait();
  tsNet = { name: "local", chainId: CHAIN, contract: vault.target as string, token: token.target as string, decimals: 6, rpcUrls: [RPC], explorer: "http://explorer.local" };
  await syncClock();
  A = await startSeller();
}, 180_000);

afterAll(() => {
  for (const c of closers) { try { c(); } catch { /* ignore */ } }
  spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  provider?.destroy();
});

describe("interop (official @x402 SDK on both sides, real TurnpikeAllowance)", () => {
  it("unpaid request: 402 with the turnspike/1 JSON body AND a PAYMENT-REQUIRED header built from the same signed row", async () => {
    const c = await rawChallenge(`${A.base}/v1/report?q=1`);
    expect(c.status).toBe(402);
    expect(c.body).toMatchObject({ protocol: "turnspike/1", priceBase: "1000", resourceId: "/report?q=1" });
    const acc = c.required.accepts[0];
    expect(c.required.x402Version).toBe(2);
    expect(acc).toMatchObject({ scheme: SCHEME, network: "eip155:31337", amount: "1000", payTo: merchant, maxTimeoutSeconds: 300 });
    expect(acc.extra).toMatchObject({ requestId: c.body.requestId, sig: c.body.sig, resourceId: "/report?q=1", assetTransferMethod: "vault-pay", paymentFlow: "upfront", contract: vault.target });
    expect(A.mw.store.get(c.body.requestId)!.state).toBe("ISSUED"); // one row, shared by both views
  });

  it("happy path: exactly one Paid event; PAYMENT-RESPONSE.transaction is that event's transaction; payer is the owner", async () => {
    const a = mkAgent([{ origin: A.base, merchant }]);
    const from = await head(); const calls = A.calls.n;
    const r = await a.pay(`${A.base}/v1/report?x=1`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("paid");
    expect(r.response.status).toBe(200);
    expect(await r.response.json()).toMatchObject({ route: "report" });
    const logs = await paidLogs(from);
    expect(logs).toHaveLength(1);
    const pr = prOf(r.response);
    expect(pr).toMatchObject({ success: true, network: "eip155:31337" });
    expect(pr.transaction.toLowerCase()).toBe(logs[0].tx);
    expect(pr.payer.toLowerCase()).toBe(ownerW.address.toLowerCase());
    expect(logs[0].amount).toBe(1000n);
    expect(A.calls.n).toBe(calls + 1);
    expect((await a.journal.get(r.purchaseKey))!.state).toBe("delivered");
  });

  it("turnspike/1 still works unchanged on the same route", async () => {
    const c = await rawChallenge(`${A.base}/v1/report?t1=1`);
    const tx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, c.body.requestId, 1000n);
    await tx.wait();
    const r = await fetch(`${A.base}/v1/report?t1=1`, { headers: { "x-payment": b64json({ requestId: c.body.requestId, txHash: tx.hash, sig: c.body.sig }) } });
    expect(r.status).toBe(200);
    expect(r.headers.get("payment-response")).toBeNull();
    expect(r.headers.get("access-control-expose-headers")).toMatch(/PAYMENT-RESPONSE/);
  });

  it("a stock x402 `exact` client is refused and pays nothing", async () => {
    const stock = new x402Client();
    stock.register("eip155:*" as any, new ExactEvmScheme(privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`) as any));
    const from = await head();
    let outcome = "";
    try { const r = await wrapFetchWithPayment(fetch, stock)(`${A.base}/v1/report?stock=1`); outcome = `HTTP ${r.status}`; } catch (e: any) { outcome = `threw ${e.message}`; }
    expect(outcome).toMatch(/threw/);
    expect(await paidLogs(from)).toHaveLength(0);
  });

  it("x402 v1 payloads are rejected (400) on either header; both headers at once are rejected (400)", async () => {
    const v1 = b64json({ x402Version: 1, scheme: "exact", network: "base-sepolia", payload: { signature: "0x" } });
    expect((await fetch(`${A.base}/v1/report`, { headers: { "x-payment": v1 } })).status).toBe(400);
    const r2 = await fetch(`${A.base}/v1/report`, { headers: { "payment-signature": v1 } });
    expect(r2.status).toBe(400); expect((await r2.json()).error).toBe("unsupported_x402_version");
    const both = await fetch(`${A.base}/v1/report`, { headers: { "payment-signature": v1, "x-payment": v1 } });
    expect(both.status).toBe(400); expect((await both.json()).error).toBe("ambiguous_payment_headers");
    expect((await fetch(`${A.base}/v1/report`, { headers: { "payment-signature": "!!!" } })).status).toBe(400);
  });
});

describe("mismatches", () => {
  it("server side: tampered accepted (merchant, network, token, contract, amount, timeout, extra) never settles or runs the handler", async () => {
    const { header } = await payDirect(`${A.base}/v1/report?mm=1`);
    const p = unb64json<any>(header);
    const from = await head(); const calls = A.calls.n;
    const variants: Record<string, (x: any) => void> = {
      merchant: (x) => (x.accepted.payTo = merchant2),
      network: (x) => (x.accepted.network = "eip155:1990"),
      token: (x) => (x.accepted.asset = otherToken),
      contract: (x) => (x.accepted.extra.contract = otherToken),
      amount: (x) => (x.accepted.amount = "999"),
      timeout: (x) => (x.accepted.maxTimeoutSeconds = 9999),
      extraResource: (x) => (x.accepted.extra.resourceId = "/report?mm=2"),
      extraUnknownKey: (x) => (x.accepted.extra.foo = "bar"),
      proofSigSwap: (x) => (x.payload.sig = "0".repeat(64)),
      proofOtherRequest: (x) => (x.accepted.extra.requestId = "0x" + "ab".repeat(32)),
    };
    for (const [name, mut] of Object.entries(variants)) {
      const v = structuredClone(p); mut(v);
      const r = await present(`${A.base}/v1/report?mm=1`, b64json(v));
      expect([name, r.status >= 400]).toEqual([name, true]);
      expect(r.headers.get("x-turnspike-replay")).toBeNull();
    }
    expect(A.calls.n).toBe(calls);
    expect(await paidLogs(from)).toHaveLength(0);
    expect((await present(`${A.base}/v1/report?mm=1`, header)).status).toBe(200); // the genuine proof still works
  });

  it("facilitator direct: mismatched requirements fail with specific codes, empty transaction and a payer field", async () => {
    const { header } = await payDirect(`${A.base}/v1/report?fd=1`);
    const p = unb64json<any>(header);
    const fac = new LocalFacilitatorClient(A.mw);
    const req = { ...p.accepted, extra: { resourceId: p.accepted.extra.resourceId, protocol: "turnspike/1", contract: p.accepted.extra.contract, assetTransferMethod: "vault-pay", paymentFlow: "upfront" } };
    const cases: [string, any, any, string][] = [
      ["merchant", { ...p, accepted: { ...p.accepted, payTo: merchant2 } }, { ...req, payTo: merchant2 }, ErrorCodes.recipientMismatch],
      ["network", p, { ...req, network: "eip155:1990" }, ErrorCodes.invalidNetwork],
      ["token", { ...p, accepted: { ...p.accepted, asset: otherToken } }, { ...req, asset: otherToken }, ErrorCodes.assetMismatch],
      ["contract", p, { ...req, extra: { ...req.extra, contract: otherToken } }, ErrorCodes.contractMismatch],
      ["amount", p, { ...req, amount: "2000" }, ErrorCodes.amountMismatch],
      ["resource", p, { ...req, extra: { ...req.extra, resourceId: "/other" } }, ErrorCodes.extraMismatch],
      ["wrong resource, consistent", { ...p, accepted: { ...p.accepted, extra: { ...p.accepted.extra, resourceId: "/other" } } }, { ...req, extra: { ...req.extra, resourceId: "/other" } }, ErrorCodes.wrongResource],
      ["forged sig", { ...p, accepted: { ...p.accepted, extra: { ...p.accepted.extra, sig: "0".repeat(64) } }, payload: { ...p.payload, sig: "0".repeat(64) } }, req, ErrorCodes.signature],
    ];
    for (const [name, payload, requirements, code] of cases) {
      const s = await fac.settle(payload, requirements);
      expect([name, s.success, s.errorReason, s.transaction]).toEqual([name, false, code, ""]);
      expect(typeof s.payer).toBe("string");
    }
    // verify is read-only: the row is untouched (ISSUED) after a valid verify
    const rid = p.payload.requestId.toLowerCase();
    const before = A.mw.store.get(rid)!.state;
    const v = await fac.verify(p, req);
    expect(v.isValid).toBe(true);
    expect(v.payer!.toLowerCase()).toBe(ownerW.address.toLowerCase());
    expect(A.mw.store.get(rid)!.state).toBe(before);
    expect(A.mw.store.db.prepare("SELECT COUNT(*) c FROM events WHERE requestId=?").get(rid)).toEqual({ c: 1 });
  });

  it("client side: a 402 naming another network, token, contract or merchant is refused before paying", async () => {
    const bad = express();
    let variant: (a: any) => void = () => {};
    bad.get("/x", (_q, r) => {
      const acc = { scheme: SCHEME, network: "eip155:31337", amount: "1000", asset: tsNet.token, payTo: merchant, maxTimeoutSeconds: 300,
        extra: { resourceId: "/x", protocol: "turnspike/1", contract: tsNet.contract, assetTransferMethod: "vault-pay", paymentFlow: "upfront", requestId: ethers.id("x" + Math.random()), sig: "ab".repeat(32), expiresAt: clock() + 300, paymentDeadline: clock() + 360 } };
      variant(acc);
      r.status(402).setHeader("PAYMENT-REQUIRED", b64json({ x402Version: 2, resource: { url: `http://127.0.0.1:${(s.address() as any).port}/x` }, accepts: [acc] })).json({});
    });
    const s: Server = await new Promise((res) => { const l = bad.listen(0, "127.0.0.1", () => res(l)); });
    closers.push(() => s.close());
    const base = `http://127.0.0.1:${(s.address() as any).port}`;
    const from = await head();
    const cases: [string, (a: any) => void, RegExp][] = [
      ["network", (a) => (a.network = "eip155:1990"), /payment_not_created|wrong_network/],
      ["token", (a) => (a.asset = otherToken), /payment_not_created|wrong_network/],
      ["contract", (a) => (a.extra.contract = otherToken), /wrong_network/],
      ["merchant", (a) => (a.payTo = w(9).address), /untrusted_destination/],
      ["amount above ceiling", (a) => (a.amount = "999999"), /price_above_max|payment_not_created/],
      ["expired", (a) => { a.extra.expiresAt = clock() + 5; }, /challenge_expired/],
      ["tampered extra", (a) => (a.extra.paymentFlow = "authorization"), /payment_not_created|invalid_challenge/],
    ];
    for (const [name, mut, re] of cases) {
      variant = mut;
      const r = await mkAgent([{ origin: base, merchant }]).pay(`${base}/x`);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect([name, r.error]).toEqual([name, expect.stringMatching(re)]);
      expect([name, r.paid, r.maybePaid]).toEqual([name, false, false]);
    }
    expect(await paidLogs(from)).toHaveLength(0);
  });

  it("expired: a payment mined after the deadline is refused, recorded PAID_LATE and listed by paidUndelivered()", async () => {
    const S = await startSeller({ challengeTtlSeconds: 2, paymentGraceSeconds: 0 });
    const c = await rawChallenge(`${S.base}/v1/report?late=1`);
    await provider.send("evm_increaseTime", [60]); await mine(1);
    const acc = c.required.accepts[0];
    const tx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, acc.extra.requestId, 1000n);
    await tx.wait();
    const hdr = b64json({ x402Version: 2, resource: c.required.resource, accepted: acc, payload: { requestId: acc.extra.requestId, txHash: tx.hash, sig: acc.extra.sig } });
    const r = await present(`${S.base}/v1/report?late=1`, hdr);
    expect(r.status).toBe(402);
    const pr = prOf(r);
    expect(pr).toMatchObject({ success: false, errorReason: ErrorCodes.paidTooLate, transaction: "" });
    expect(pr.payer.toLowerCase()).toBe(ownerW.address.toLowerCase());
    const row = S.mw.store.get(acc.extra.requestId.toLowerCase())!;
    expect(row).toMatchObject({ state: "REJECTED", disposition: "PAID_LATE", txHash: tx.hash.toLowerCase() });
    expect(S.mw.paidUndelivered()).toEqual([expect.objectContaining({ kind: "PAID_LATE", requestId: row.requestId, txHash: tx.hash.toLowerCase() })]);
    expect(S.calls.n).toBe(0);
    await syncClock();
  });
});

describe("replay", () => {
  it("cross-resource: a proof for /report?a=1 unlocks neither /report?a=2 nor /other", async () => {
    const a = mkAgent([{ origin: A.base, merchant }]);
    const r = await a.pay(`${A.base}/v1/report?a=1`);
    expect(r.ok).toBe(true);
    const header = await sentHeader(a, r.purchaseKey);
    const calls = A.calls.n;
    expect((await present(`${A.base}/v1/report?a=2`, header)).status).toBe(402);
    expect((await present(`${A.base}/v1/other`, header)).status).toBe(402);
    expect(A.calls.n).toBe(calls);
    const again = await present(`${A.base}/v1/report?a=1`, header);
    expect(again.status).toBe(200); expect(again.headers.get("x-turnspike-replay")).toBe("1");
  });

  it("cross-merchant: a proof for merchant A is refused by merchant B even with a shared store and secret", async () => {
    const dir = mkdtempSync(join(tmpdir(), "x402shared-"));
    const shared = new Store(join(dir, "shared.sqlite"));
    closers.push(() => shared.close());
    const SA = await startSeller({ store: shared });
    const SB = await startSeller({ store: shared, merchant: merchant2 });
    const { header, acc } = await payDirect(`${SA.base}/v1/report?cm=1`);
    const r = await present(`${SB.base}/v1/report?cm=1`, header);
    expect(r.status).toBe(402); // the accepted payTo is A: no requirement of B matches
    const p = unb64json<any>(header);
    const direct = await new LocalFacilitatorClient(SB.mw).settle({ ...p, accepted: { ...acc, payTo: merchant2 } }, { ...acc, payTo: merchant2, extra: { resourceId: acc.extra.resourceId, protocol: "turnspike/1", contract: acc.extra.contract, assetTransferMethod: "vault-pay", paymentFlow: "upfront" } } as any);
    expect(direct).toMatchObject({ success: false, errorReason: ErrorCodes.wrongMerchant, transaction: "" });
    expect(SB.calls.n).toBe(0);
    expect((await present(`${SA.base}/v1/report?cm=1`, header)).status).toBe(200);
  });

  it("cross-protocol: an x402 proof presented as X-PAYMENT replays the same delivery once; on another resource it is 403", async () => {
    const a = mkAgent([{ origin: A.base, merchant }]);
    const from = await head();
    const r = await a.pay(`${A.base}/v1/report?xp=1`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = await r.response.text();
    const proof = unb64json<any>(await sentHeader(a, r.purchaseKey)).payload;
    const calls = A.calls.n;
    const t1 = await fetch(`${A.base}/v1/report?xp=1`, { headers: { "x-payment": b64json(proof) } });
    expect(t1.status).toBe(200); expect(t1.headers.get("x-turnspike-replay")).toBe("1"); expect(await t1.text()).toBe(body);
    const t2 = await fetch(`${A.base}/v1/other`, { headers: { "x-payment": b64json(proof) } });
    expect(t2.status).toBe(403);
    expect(A.calls.n).toBe(calls);
    expect(await paidLogs(from)).toHaveLength(1);
    // and a turnspike/1 proof presented over x402 for another resource is refused
    const c = await rawChallenge(`${A.base}/v1/other`);
    const tx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, c.body.requestId, 1000n); await tx.wait();
    const asX402 = b64json({ x402Version: 2, resource: c.required.resource, accepted: c.required.accepts[0], payload: { requestId: c.body.requestId, txHash: tx.hash, sig: c.body.sig } });
    expect((await present(`${A.base}/v1/report?xp=1`, asX402)).status).toBe(402);
  });

  it("after the replay window a leaked header gets 410 and the stored body is purged", async () => {
    const S = await startSeller({ replayWindowSeconds: 1 });
    const { header } = await payDirect(`${S.base}/v1/report?win=1`);
    expect((await present(`${S.base}/v1/report?win=1`, header)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2300));
    const late = await present(`${S.base}/v1/report?win=1`, header);
    expect(late.status).toBe(410);
    const rid = unb64json<any>(header).payload.requestId.toLowerCase();
    expect(S.mw.store.get(rid)!.responseBody).toBeNull();
    expect(S.calls.n).toBe(1);
  });
});

describe("issuance guard", () => {
  it("per-client token bucket, unpaid cap per route, query limits", async () => {
    const S = await startSeller({ guard: { burst: 3, refillPerSecond: 0.001 } });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${S.base}/v1/report?i=${i}`)).status);
    expect(codes).toEqual([402, 402, 402, 429]);
    let k = 0;
    const C = await startSeller({ guard: { maxUnpaidPerRoute: 2, clientKey: () => String(++k) } });
    const c2: number[] = [];
    for (let i = 0; i < 3; i++) c2.push((await fetch(`${C.base}/v1/report?i=${i}`)).status);
    expect(c2).toEqual([402, 402, 503]);
    expect((await fetch(`${C.base}/v1/other`)).status).toBe(402); // another route is not capped
    const Q = await startSeller({ guard: { maxQueryLength: 20, maxQueryParams: 2 } });
    expect((await fetch(`${Q.base}/v1/report?x=${"a".repeat(40)}`)).status).toBe(414);
    expect((await fetch(`${Q.base}/v1/report?a=1&b=2&c=3`)).status).toBe(400);
    expect(Q.mw.store.db.prepare("SELECT COUNT(*) c FROM payments").get()).toEqual({ c: 0 });
  });

  it("reaper deletes unpaid ISSUED rows only after deadline + grace AND a reconcile past it; paid rows are kept", async () => {
    const S = await startSeller({ challengeTtlSeconds: 15, paymentGraceSeconds: 1 });
    const unpaid = await rawChallenge(`${S.base}/v1/report?r=1`);
    const { header } = await payDirect(`${S.base}/v1/report?r=2`);
    const pr = await present(`${S.base}/v1/report?r=2`, header);
    expect([pr.status, prOf(pr)?.errorReason]).toEqual([200, undefined]);
    await provider.send("evm_increaseTime", [60]); await mine(2); await syncClock();
    expect(S.mw.reap()).toBe(0); // not reconciled yet
    await S.mw.reconcile({ lookbackBlocks: 200 });
    expect(S.mw.reap()).toBe(1);
    expect(S.mw.store.get(unpaid.body.requestId)).toBeUndefined();
    expect(S.mw.store.get(unb64json<any>(header).payload.requestId.toLowerCase())!.state).toBe("DELIVERED");
  });
});

describe("standalone facilitator", () => {
  it("HMAC auth: missing, bad and replayed requests are refused; a signed client settles end to end", async () => {
    const FSECRET = "f".repeat(40);
    const F = await createFacilitatorServer({ backend: A.mw, secrets: [FSECRET], onEvent: () => {} });
    closers.push(() => F.close());
    expect((await fetch(`${F.url}/supported`)).status).toBe(401);
    const bad = facilitatorAuthHeaders("x".repeat(40), "GET", "/supported", "");
    expect((await fetch(`${F.url}/supported`, { headers: bad })).status).toBe(401);
    const good = facilitatorAuthHeaders(FSECRET, "GET", "/supported", "");
    const ok = await fetch(`${F.url}/supported`, { headers: good });
    expect(ok.status).toBe(200);
    expect((await ok.json()).kinds[0]).toMatchObject({ scheme: SCHEME, network: "eip155:31337" });
    expect((await fetch(`${F.url}/supported`, { headers: good })).status).toBe(401); // replayed nonce
    const stale = facilitatorAuthHeaders(FSECRET, "GET", "/supported", "");
    stale["x-turnspike-timestamp"] = String(Math.floor(Date.now() / 1000) - 3600);
    expect((await fetch(`${F.url}/supported`, { headers: stale })).status).toBe(401);
    const garbage = JSON.stringify({ hello: 1 });
    const g = await fetch(`${F.url}/settle`, { method: "POST", body: garbage, headers: { "content-type": "application/json", ...facilitatorAuthHeaders(FSECRET, "POST", "/settle", garbage) } });
    expect(g.status).toBe(400);
    const gb = await g.json();
    expect(JSON.stringify(gb)).not.toMatch(/stack|at /);
    // a seller using the authenticated remote facilitator
    const S = await startSeller({ store: A.mw.store }, undefined, { facilitator: new RemoteFacilitatorClient({ url: F.url, secret: FSECRET }) });
    const from = await head();
    const r = await mkAgent([{ origin: S.base, merchant }]).pay(`${S.base}/v1/report?remote=1`);
    expect(r.ok).toBe(true);
    expect(await paidLogs(from)).toHaveLength(1);
  });
});

describe("uncertain outcomes", () => {
  it("settlement_pending (non-terminal, with hash, network and payer), then the same proof succeeds", async () => {
    await provider.send("evm_setAutomine", [false]);
    let hdr = "", txHash = "";
    try {
      const p = await payDirect(`${A.base}/v1/report?pend=1`, { wait: false });
      hdr = p.header; txHash = p.txHash;
      const early = await present(`${A.base}/v1/report?pend=1`, hdr);
      expect(early.status).toBe(402);
      const pr = prOf(early);
      expect(pr).toMatchObject({ success: false, errorReason: "settlement_pending", network: "eip155:31337" });
      expect(pr.transaction.toLowerCase()).toBe(txHash.toLowerCase());
      expect(pr.payer.toLowerCase()).toBe(ownerW.address.toLowerCase());
    } finally {
      await provider.send("evm_setAutomine", [true]);
      await mine(1);
    }
    const late = await present(`${A.base}/v1/report?pend=1`, hdr);
    expect(late.status).toBe(200);
    expect(prOf(late).transaction.toLowerCase()).toBe(txHash.toLowerCase());
  });

  it("naive retry without a key after a dropped PAYMENT-RESPONSE: exactly one Paid event, handler ran once", async () => {
    let drops = 2; // the paid request and the wrapper's first re-presentation both lose their response
    const S = await startSeller({}, (app) => app.use((req, res, next) => {
      if (drops > 0 && req.header("payment-signature")) {
        drops--;
        const end = res.end.bind(res);
        (res as any).end = (...args: any[]) => { req.socket.destroy(); return res; void end; };
      }
      next();
    }));
    const a = mkAgent([{ origin: S.base, merchant }], {}, { retry: { attempts: 1, baseDelayMs: 100, maxDelayMs: 100, totalMs: 5000 } });
    const from = await head();
    const url = `${S.base}/v1/report?drop=1`;
    const first = await a.pay(url);
    expect(first.ok).toBe(false);
    if (!first.ok) { expect(first.paid).toBe(true); expect(first.error).toBe("redeem_timeout"); }
    expect(S.calls.n).toBe(1); // the seller delivered and stored; only the response was lost
    const second = await a.pay(url); // naive retry: same request, no key given
    expect(second.ok).toBe(true);
    if (second.ok) { expect(second.resumed).toBe(true); expect(second.response.headers.get("x-turnspike-replay")).toBe("1"); }
    expect(await paidLogs(from)).toHaveLength(1);
    expect(S.calls.n).toBe(1);
  });

  it("seller killed after settle, before delivery (separate process), restarted: the same proof delivers, no second charge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "x402crash-"));
    const port = 8671;
    const env = { ...process.env, TURNSPIKE_LOG: "off", RPC, CHAIN_ID: String(CHAIN), VAULT: vault.target as string, TOKEN: token.target as string, MERCHANT: merchant, HMAC_SECRET: SECRET, DB: join(dir, "c.sqlite"), PORT: String(port), CLOCK_OFFSET: String(chainOffset) };
    const tsx = join(__dirname, "../node_modules/tsx/dist/cli.mjs");
    const start = (crash: boolean) => new Promise<ChildProcess>((res, rej) => {
      const p = spawn(process.execPath, [tsx, join(__dirname, "fixture-seller.ts")], { env: { ...env, CRASH: crash ? "1" : "0" }, cwd: join(__dirname, "..") });
      p.stdout!.on("data", (d) => String(d).includes("ready") && res(p));
      p.stderr!.on("data", () => {});
      p.on("error", rej);
      setTimeout(() => rej(new Error("seller start timeout")), 30_000);
    });
    const base = `http://127.0.0.1:${port}`;
    const p1 = await start(true);
    const exited = new Promise((r) => p1.on("exit", r));
    const a = mkAgent([{ origin: base, merchant }], {}, { retry: { attempts: 12, baseDelayMs: 500, maxDelayMs: 2000, totalMs: 40_000 } });
    const from = await head();
    const pending = a.pay(`${base}/v1/report`);
    await exited; // died inside the handler: paid and settled, nothing delivered
    const db = new Store(join(dir, "c.sqlite"));
    const row = db.db.prepare("SELECT * FROM payments WHERE txHash IS NOT NULL").get() as any;
    expect(row.state).toBe("DELIVERING");
    db.close();
    const p2 = await start(false);
    closers.push(() => p2.kill());
    const r = await pending;
    expect(r.ok).toBe(true);
    if (r.ok) expect((await r.response.json()).ok).toBe(true);
    expect(await paidLogs(from)).toHaveLength(1);
  }, 90_000);
});
