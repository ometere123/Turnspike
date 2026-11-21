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

const PORT = 8701;
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

function raw(url: string, headers: Record<string, string>): Promise<{ status: number; body: string; pr?: string }> {
  const u = new URL(url);
  return new Promise((res, rej) => {
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET", headers }, (s) => {
      let b = ""; s.on("data", (d) => (b += d)); s.on("end", () => res({ status: s.statusCode!, body: b, pr: s.headers["payment-required"] as string }));
    });
    r.on("error", rej); r.end();
  });
}

describe("FINAL probes: Host / X-Forwarded-* with trust proxy OFF", () => {
  it("X-Forwarded-* are not reflected in resource.url when trust proxy is off", async () => {
    const S = await startSeller();
    const r = await raw(`${S.base}/v1/report?xf=1`, { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" });
    expect(r.status).toBe(402);
    const url = unb64json<any>(r.pr!).resource.url as string;
    expect(url.startsWith("http://127.0.0.1")).toBe(true);
  });

  it("a paid proof cannot be redirected to another path or query by spoofing Host / X-Forwarded-* / resource.url", async () => {
    const S = await startSeller();
    const paidUrl = `${S.base}/v1/report?victim=1`;
    const acc = unb64json<any>((await fetch(paidUrl)).headers.get("payment-required")!).accepts[0];
    const tx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, acc.extra.requestId, 1000n); await tx.wait();
    const hdr = (resUrl: string) => b64json({ x402Version: 2, resource: { url: resUrl }, accepted: acc, payload: { requestId: acc.extra.requestId, txHash: tx.hash, sig: acc.extra.sig } });
    const spoof = { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" };
    const otherQ = await raw(`${S.base}/v1/report?attacker=1`, { ...spoof, "payment-signature": hdr("https://evil.example/v1/report?attacker=1") });
    expect(otherQ.status).not.toBe(200);
    const otherQ2 = await raw(`${S.base}/v1/report?attacker=1`, { ...spoof, "payment-signature": hdr("https://evil.example/v1/report?victim=1") });
    expect(otherQ2.status).not.toBe(200);
    expect(S.calls.n).toBe(0);
    // the genuine holder still gets delivery, once
    const ok = await raw(paidUrl, { ...spoof, "payment-signature": hdr("https://whatever.example/v1/report?victim=1") });
    expect(ok.status).toBe(200);
    expect(S.calls.n).toBe(1);
  });
});
