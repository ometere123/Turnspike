// Release-candidate conditions: proxy recovery (wrong_resource), resource:null, S7 clock skew on chain time, and
// conformance of real headers with the official @x402/core schemas. Local Hardhat chain only (31337).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { startNode, stopNode } from "../../../scripts/test-util/hardhat-node";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http, { type Server } from "node:http";
import express from "express";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { z } from "zod";
import { PaymentRequiredV2Schema, PaymentPayloadV2Schema } from "@x402/core/schemas";
import type { SettleResponse } from "@x402/core/types";
import { turnspike, type TurnspikeConfig, type TurnspikeMiddleware } from "@turnspike-qie/middleware";
import { TurnspikeClient, MemoryJournal, type JournalRecord, type Network as TsNetwork } from "@turnspike-qie/client";
import { x402Seller, createX402Fetch, MemoryProofStore, b64json, unb64json, paymentPayloadSchema, ErrorCodes } from "../src";

const PORT = 8691;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN = 31337;
const ROOT = resolve(__dirname, "../../..");
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
const SECRET = "r".repeat(40);
const art = (p: string) => JSON.parse(readFileSync(join(ROOT, "artifacts/contracts", p), "utf8"));

let node: ChildProcess;
let provider: JsonRpcProvider;
let token: ethers.Contract, vault: ethers.Contract;
let ownerW: HDNodeWallet, agentW: HDNodeWallet;
let merchant: string;
let tsNet: TsNetwork;
let chainOffset = 0;
const clock = () => Math.floor(Date.now() / 1000) + chainOffset;
const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const closers: (() => unknown)[] = [];
const chainNow = async () => (await provider.getBlock("latest"))!.timestamp;
const agentNonce = () => provider.getTransactionCount(agentW.address, "latest");

interface Seller { base: string; mw: TurnspikeMiddleware; calls: { n: number } }
async function startSeller(over: Partial<TurnspikeConfig> = {}, trustProxy = false): Promise<Seller> {
  const dir = mkdtempSync(join(tmpdir(), "x402rc-"));
  const mw = turnspike({
    rpcUrls: [RPC], chainId: CHAIN, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: [SECRET],
    dbPath: join(dir, "s.sqlite"), confirmations: 1, retryAfterSeconds: 1, prices: { "/report": 1000 }, x402: true,
    paymentGraceSeconds: 10 ** 9, clock, onEvent: () => {}, ...over,
  });
  const calls = { n: 0 };
  const app = express();
  if (trustProxy) app.set("trust proxy", true);
  app.use("/v1", x402Seller(mw));
  app.get("/v1/report", (q, r) => r.json({ route: "report", query: q.query, n: ++calls.n }));
  const server: Server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
  closers.push(() => { server.closeAllConnections?.(); server.close(); mw.close(); });
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, mw, calls };
}

/**
 * A TLS-terminating-proxy stand-in: the agent talks to the proxy (its own host and port), the proxy forwards to the
 * seller over plain http with a different Host header and no X-Forwarded-* headers. The seller therefore derives a
 * resource URL whose origin differs from the one the agent used.
 */
async function startProxy(target: string): Promise<string> {
  const t = new URL(target);
  const server = http.createServer((req, res) => {
    const up = http.request({ host: t.hostname, port: t.port, path: req.url, method: req.method, headers: { ...req.headers, host: "backend.internal:8080" } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { res.statusCode = 502; res.end(); });
    req.pipe(up);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => { server.closeAllConnections?.(); server.close(); });
  return `http://localhost:${(server.address() as any).port}`;
}

function mkClient(journal: MemoryJournal, payees: { origin: string; merchant: string }[], over: Record<string, unknown> = {}) {
  return new TurnspikeClient({ signer: agentW, owner: ownerW.address, network: tsNet, policy: { payees, maxPriceBase: 10_000n }, journal, confirmations: 1, txTimeoutMs: 20_000, ...over } as any);
}
function mkPay(client: TurnspikeClient, journal: MemoryJournal, extra: Record<string, unknown> = {}) {
  const proofStore = new MemoryProofStore();
  const pay = createX402Fetch({ client, journal, owner: ownerW.address, agent: agentW.address, network: { chainId: CHAIN, token: tsNet.token }, proofStore, retry: { attempts: 4, baseDelayMs: 300, maxDelayMs: 1000, totalMs: 20_000 }, ...extra });
  return { pay, proofStore };
}

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
  ownerW = w(4); agentW = w(1); merchant = w(2).address;
  const o = new NonceManager(ownerW);
  await (await (token.connect(deployer) as any).mint(ownerW.address, 10_000_000n)).wait();
  await (await (token.connect(o) as any).approve(vault.target, 10n ** 12n)).wait();
  await (await (vault.connect(o) as any).deposit(4_000_000n)).wait();
  await (await (vault.connect(o) as any).setPolicy(agentW.address, 50_000n, 1_000_000n)).wait();
  await (await (vault.connect(o) as any).setMerchant(merchant, true)).wait();
  tsNet = { name: "local", chainId: CHAIN, contract: vault.target as string, token: token.target as string, decimals: 6, rpcUrls: [RPC], explorer: "http://explorer.local" };
  chainOffset = (await chainNow()) - Math.floor(Date.now() / 1000);
}, 180_000);

afterAll(() => {
  for (const c of closers) { try { c(); } catch { /* ignore */ } }
  stopNode(node);
  provider?.destroy();
});

describe("RC-1 recovery behind a TLS-terminating proxy (no resourceUrl, no trust proxy)", () => {
  it("a payment recovered from the journal alone (ctx.url fallback) is delivered, one charge", async () => {
    const S = await startSeller();
    const P = await startProxy(S.base);
    const url = `${P}/v1/report?px=1`;
    // the seller names a resource on the origin it sees, not the one the agent used
    const c402 = await fetch(url);
    expect(c402.status).toBe(402);
    const required = unb64json<any>(c402.headers.get("payment-required")!);
    expect(new URL(required.resource.url).origin).toBe("http://backend.internal:8080");
    const challenge = await c402.json();

    // pay through the client only: the journal holds the challenge, the proof store holds nothing (crash before x402 kept it)
    const journal = new MemoryJournal();
    const client = mkClient(journal, [{ origin: P, merchant }]);
    const key = "rc1-proxy";
    const paid = await client.payChallenge(challenge, { url, method: "GET", purchaseKey: key });
    expect(paid.ok).toBe(true);
    const n0 = await agentNonce();

    const { pay, proofStore } = mkPay(client, journal);
    const r = await pay(url, {}, { purchaseKey: key });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("paid");
    expect(r.response.status).toBe(200);
    expect(await agentNonce()).toBe(n0); // no second payment
    expect(S.calls.n).toBe(1);
    // the fallback header omits `resource` instead of guessing it
    const sent = unb64json<any>((await proofStore.get(key))!.header!);
    expect("resource" in sent).toBe(false);
  });

  it("seller side: resource.url with another origin but the same path is accepted; another path is wrong_resource", async () => {
    const S = await startSeller();
    const P = await startProxy(S.base);
    const url = `${P}/v1/report?px=2`;
    const c402 = await fetch(url);
    const acc = unb64json<any>(c402.headers.get("payment-required")!).accepts[0];
    const tx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, acc.extra.requestId, 1000n); await tx.wait();
    const mk = (resourceUrl: string) => b64json({ x402Version: 2, resource: { url: resourceUrl }, accepted: acc, payload: { requestId: acc.extra.requestId, txHash: tx.hash, sig: acc.extra.sig } });
    const wrongPath = await fetch(url, { headers: { "payment-signature": mk("https://api.example.com/v1/other") } });
    expect(wrongPath.status).toBe(402);
    expect((await wrongPath.json()).error).toBe(ErrorCodes.wrongResource);
    const ok = await fetch(url, { headers: { "payment-signature": mk("https://api.example.com/v1/report?px=2") } });
    expect(ok.status).toBe(200);
  });

  it("when the seller knows its public origin (x402.resourceUrl) the origin is compared; trust proxy alone does not make it known (O4)", async () => {
    const S = await startSeller({ x402: { resourceUrl: (req) => `https://api.example.com${req.originalUrl}` } } as any);
    const url = `${S.base}/v1/report?ru=1`;
    const c402 = await fetch(url);
    const required = unb64json<any>(c402.headers.get("payment-required")!);
    expect(required.resource.url).toBe("https://api.example.com/v1/report?ru=1");
    const acc = required.accepts[0];
    const tx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, acc.extra.requestId, 1000n); await tx.wait();
    const mk = (resourceUrl: string) => b64json({ x402Version: 2, resource: { url: resourceUrl }, accepted: acc, payload: { requestId: acc.extra.requestId, txHash: tx.hash, sig: acc.extra.sig } });
    const foreign = await fetch(url, { headers: { "payment-signature": mk("https://evil.example/v1/report?ru=1") } });
    expect(foreign.status).toBe(402);
    expect((await foreign.json()).error).toBe(ErrorCodes.wrongResource);
    expect((await fetch(url, { headers: { "payment-signature": mk("https://api.example.com/v1/report?ru=1") } })).status).toBe(200);

    const T = await startSeller({}, true);
    const turl = `${T.base}/v1/report?tp=1`;
    const tacc = unb64json<any>((await fetch(turl, { headers: { "x-forwarded-proto": "https" } })).headers.get("payment-required")!).accepts[0];
    const ttx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, tacc.extra.requestId, 1000n); await ttx.wait();
    const tmk = (u: string) => b64json({ x402Version: 2, resource: { url: u }, accepted: tacc, payload: { requestId: tacc.extra.requestId, txHash: ttx.hash, sig: tacc.extra.sig } });
    // O4: trust proxy alone does not make the request origin trusted (dev fallback: path and query only), so the binding
    // that remains is path + query + resourceId: another path or query is refused.
    expect(T.mw.info.resourceUrlMode).toBe("dev");
    const tf = await fetch(turl, { headers: { "payment-signature": tmk("https://evil.example/v1/report?tp=2"), "x-forwarded-proto": "https" } });
    expect(tf.status).toBe(402);
    expect((await tf.json()).error).toBe(ErrorCodes.wrongResource);
  });
});

describe("RC-2 resource: null", () => {
  it("is accepted by the package schema (as by core) and treated as absent end to end", async () => {
    const S = await startSeller();
    const url = `${S.base}/v1/report?nul=1`;
    const acc = unb64json<any>((await fetch(url)).headers.get("payment-required")!).accepts[0];
    const tx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, acc.extra.requestId, 1000n); await tx.wait();
    const p = { x402Version: 2, resource: null, accepted: acc, payload: { requestId: acc.extra.requestId, txHash: tx.hash, sig: acc.extra.sig } };
    expect(PaymentPayloadV2Schema.safeParse(p).success).toBe(true);
    expect(paymentPayloadSchema.safeParse(p).success).toBe(true);
    const r = await fetch(url, { headers: { "payment-signature": b64json(p) } });
    expect(r.status).toBe(200);
  });
});

describe("RC-4 S7 clock skew: the deadline is judged on chain time", () => {
  const behind = () => Date.now() + chainOffset * 1000 - 30_000; // agent clock 30 s behind chain time

  it("agent clock 30 s behind: a deadline 15 s ahead of chain time is refused before sending (local view would pay)", async () => {
    const j = new MemoryJournal();
    const S = await startSeller();
    const t = await chainNow();
    const ch = { protocol: "turnspike/1", requestId: "0x" + "ab".repeat(32), sig: "cd".repeat(32), priceBase: "1000", token: token.target as string, contract: vault.target as string, merchant, chainId: CHAIN, resourceId: "/report", expiresAt: t + 300, paymentDeadline: t + 15 };
    // judged on the agent's clock alone, 45 s would remain: more than the 17.2 s margin (one block + one confirmation + 10 s)
    await j.put({ key: "skew", url: `${S.base}/v1/report`, method: "GET", state: "challenged", challenge: ch as any, owner: ownerW.address, agent: agentW.address, updatedAt: 0 } as JournalRecord);
    const n0 = await agentNonce();
    const r = await mkClient(j, [{ origin: S.base, merchant }], { nowMs: behind }).resume("skew");
    expect(!r.ok && r.error).toBe("challenge_expired");
    expect(!r.ok && r.paid).toBe(false);
    expect(await agentNonce()).toBe(n0);
  });

  it("clockSkewSeconds is added to the margin when chain time cannot be read (local clock only)", async () => {
    const S = await startSeller();
    const t = await chainNow();
    const ch = { protocol: "turnspike/1", requestId: "0x" + "ac".repeat(32), sig: "cd".repeat(32), priceBase: "1000", token: token.target as string, contract: vault.target as string, merchant, chainId: CHAIN, resourceId: "/report", expiresAt: t + 300, paymentDeadline: t + 25 };
    const rec = { key: "skew2", url: `${S.base}/v1/report`, method: "GET", state: "challenged", challenge: ch as any, owner: ownerW.address, agent: agentW.address, updatedAt: 0 } as JournalRecord;
    class NoBlocks extends JsonRpcProvider { override async getBlock(): Promise<any> { throw new Error("getBlock unavailable"); } }
    const p2 = new NoBlocks(RPC, CHAIN, { staticNetwork: true, cacheTimeout: -1 });
    closers.push(() => p2.destroy());
    const signer = agentW.connect(p2);
    const local = () => Date.now() + chainOffset * 1000;
    // margin without skew 17.2 s fits 25 s; with the default 15 s skew (32.2 s) it does not
    const j1 = new MemoryJournal(); await j1.put(structuredClone(rec));
    const r1 = await mkClient(j1, [{ origin: S.base, merchant }], { signer, nowMs: local }).resume("skew2");
    expect(!r1.ok && r1.error).toBe("challenge_expired");
    const j2 = new MemoryJournal(); await j2.put(structuredClone(rec));
    const r2 = await mkClient(j2, [{ origin: S.base, merchant }], { signer, nowMs: local, clockSkewSeconds: 0 }).resume("skew2");
    expect(!r2.ok && r2.error).not.toBe("challenge_expired"); // passes the deadline check (fails later: the challenge is fake)
  });

  it("agent clock 30 s behind with a reachable deadline: pays and delivers normally", async () => {
    const S = await startSeller();
    const journal = new MemoryJournal();
    const { pay } = mkPay(mkClient(journal, [{ origin: S.base, merchant }], { nowMs: behind }), journal);
    const r = await pay(`${S.base}/v1/report?skew=ok`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe("RC-5 official @x402/core schema conformance of real headers (end to end)", () => {
  it("PAYMENT-REQUIRED, PAYMENT-SIGNATURE and PAYMENT-RESPONSE of a real paid run conform", async () => {
    const S = await startSeller();
    const seen = { required: [] as string[], signature: [] as string[], response: [] as string[] };
    const spy: typeof fetch = async (input: any, init?: any) => {
      const req = new Request(input, init);
      const sig = req.headers.get("payment-signature"); if (sig) seen.signature.push(sig);
      const res = await fetch(req);
      const pr = res.headers.get("payment-required"); if (pr) seen.required.push(pr);
      const ps = res.headers.get("payment-response"); if (ps) seen.response.push(ps);
      return res;
    };
    const journal = new MemoryJournal();
    const { pay } = mkPay(mkClient(journal, [{ origin: S.base, merchant }]), journal, { fetch: spy });
    const r = await pay(`${S.base}/v1/report?conf=1`);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(seen.required.length).toBeGreaterThan(0);
    expect(seen.signature.length).toBeGreaterThan(0);
    expect(seen.response.length).toBeGreaterThan(0);
    for (const h of seen.required) {
      const p = PaymentRequiredV2Schema.safeParse(unb64json(h));
      expect(p.success, JSON.stringify((p as any).error?.issues)).toBe(true);
    }
    for (const h of seen.signature) {
      const p = PaymentPayloadV2Schema.safeParse(unb64json(h));
      expect(p.success, JSON.stringify((p as any).error?.issues)).toBe(true);
    }
    // @x402/core 2.31.0 exports no settle-response schema: check the SettleResponse type shape
    const settleShape = z.object({ success: z.boolean(), errorReason: z.string().optional(), errorMessage: z.string().optional(), payer: z.string().optional(), transaction: z.string(), network: z.string().regex(/^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/), amount: z.string().optional(), extensions: z.record(z.string(), z.unknown()).optional() }).strict();
    for (const h of seen.response) {
      const v = unb64json<SettleResponse>(h);
      const p = settleShape.safeParse(v);
      expect(p.success, JSON.stringify((p as any).error?.issues)).toBe(true);
      expect(v.success).toBe(true);
    }
  });
});
