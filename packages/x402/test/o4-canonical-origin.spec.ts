// O4: fail-closed canonical resource URL, request side. Local Hardhat chain only (31337); the sellers run in production
// mode (`production: true`) with an explicitly configured public origin. Covers Host poisoning, forged X-Forwarded-* with
// trust proxy on and off, a reverse proxy with a base path, wrong path / query, dynamic resources, cross-resource proof
// replay, a legitimate end-to-end payment, and turnspike/1 unchanged.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http, { type Server } from "node:http";
import express from "express";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { turnspike, type TurnspikeConfig, type TurnspikeMiddleware, type X402Options } from "@turnspike-qie/middleware";
import { TurnspikeClient, MemoryJournal, type Network as TsNetwork } from "@turnspike-qie/client";
import { x402Seller, createX402Fetch, MemoryProofStore, b64json, unb64json, ErrorCodes } from "../src";

const PORT = 8741;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN = 31337;
const ROOT = resolve(__dirname, "../../..");
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
const SECRET = "o".repeat(40);
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
const agentNonce = () => provider.getTransactionCount(agentW.address, "latest");

interface Seller { base: string; port: number; mw: TurnspikeMiddleware; calls: { n: number; paths: string[] } }

/**
 * Starts a seller. The listening port is known before the middleware is built, so `x402` may be a function of it
 * (publicOrigin = the address the agent really uses).
 */
async function startSeller(x402: (port: number) => X402Options | boolean, o: { trustProxy?: boolean; over?: Partial<TurnspikeConfig> } = {}): Promise<Seller> {
  const app = express();
  if (o.trustProxy) app.set("trust proxy", true);
  const server: Server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
  const port = (server.address() as any).port as number;
  const mw = turnspike({
    rpcUrls: [RPC], chainId: CHAIN, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: [SECRET],
    dbPath: join(mkdtempSync(join(tmpdir(), "o4-")), "s.sqlite"), confirmations: 1, retryAfterSeconds: 1,
    prices: { "/report": 1000, "/item/:id": 1000 }, x402: x402(port), paymentGraceSeconds: 10 ** 9, clock, onEvent: () => {}, ...o.over,
  });
  const calls = { n: 0, paths: [] as string[] };
  app.use("/v1", x402Seller(mw));
  app.get("/v1/report", (q, r) => { calls.n++; calls.paths.push(q.originalUrl); r.json({ route: "report", query: q.query }); });
  app.get("/v1/item/:id", (q, r) => { calls.n++; calls.paths.push(q.originalUrl); r.json({ route: "item", id: q.params.id }); });
  closers.push(() => { server.closeAllConnections?.(); server.close(); mw.close(); });
  return { base: `http://127.0.0.1:${port}`, port, mw, calls };
}
const prod = (origin: (port: number) => string, extra: Partial<X402Options> = {}) => (port: number): X402Options => ({ production: true, publicOrigin: origin(port), ...extra });

/** Raw HTTP request, so Host and any header can be set exactly. */
function raw(url: string, headers: Record<string, string> = {}, path?: string): Promise<{ status: number; body: any; pr?: string }> {
  const u = new URL(url);
  return new Promise((res, rej) => {
    const r = http.request({ host: u.hostname, port: u.port, path: path ?? u.pathname + u.search, method: "GET", headers }, (s) => {
      let b = ""; s.on("data", (d) => (b += d));
      s.on("end", () => { let body: any = b; try { body = JSON.parse(b); } catch { /* text */ } res({ status: s.statusCode!, body, pr: s.headers["payment-required"] as string }); });
    });
    r.on("error", rej); r.end();
  });
}
const required = (pr: string | undefined) => unb64json<any>(pr!);

/** Unpaid request, then pays the challenge on chain directly. Returns the accepted requirement and the tx hash. */
async function payFor(url: string, headers: Record<string, string> = {}) {
  const c = await raw(url, headers);
  expect(c.status).toBe(402);
  const pr = required(c.pr);
  const acc = pr.accepts[0];
  const tx = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, acc.extra.requestId, BigInt(acc.amount));
  await tx.wait();
  return { pr, acc, tx: tx.hash as string, challenge: c.body };
}
const sigHeader = (acc: any, tx: string, resourceUrl: string | null | undefined) =>
  b64json({ x402Version: 2, ...(resourceUrl === undefined ? {} : { resource: resourceUrl === null ? null : { url: resourceUrl } }), accepted: acc, payload: { requestId: acc.extra.requestId, txHash: tx, sig: acc.extra.sig } });

function mkClient(journal: MemoryJournal, payees: { origin: string; merchant: string }[]) {
  return new TurnspikeClient({ signer: agentW, owner: ownerW.address, network: tsNet, policy: { payees, maxPriceBase: 10_000n }, journal, confirmations: 1, txTimeoutMs: 20_000 } as any);
}
function mkPay(origin: string) {
  const journal = new MemoryJournal();
  const client = mkClient(journal, [{ origin, merchant }]);
  return createX402Fetch({ client, journal, owner: ownerW.address, agent: agentW.address, network: { chainId: CHAIN, token: tsNet.token }, proofStore: new MemoryProofStore(), retry: { attempts: 4, baseDelayMs: 300, maxDelayMs: 1000, totalMs: 20_000 } });
}

/** Reverse proxy: public http://localhost:P/api/... -> seller /..., with an internal Host and no X-Forwarded-* headers. */
async function startProxy(target: string, prefix: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  const t = new URL(target);
  const server = http.createServer((req, res) => {
    if (!req.url!.startsWith(prefix + "/")) { res.statusCode = 404; return void res.end(); }
    const up = http.request({ host: t.hostname, port: t.port, path: req.url!.slice(prefix.length), method: req.method, headers: { ...req.headers, host: "backend.internal:8080", ...extraHeaders } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res);
    });
    up.on("error", () => { res.statusCode = 502; res.end(); });
    req.pipe(up);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  closers.push(() => { server.closeAllConnections?.(); server.close(); });
  return `http://localhost:${(server.address() as any).port}`;
}

beforeAll(async () => {
  process.env.TURNSPIKE_LOG = "off";
  node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: ROOT, shell: true, stdio: "ignore" });
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
  chainOffset = (await provider.getBlock("latest"))!.timestamp - Math.floor(Date.now() / 1000);
}, 180_000);

afterAll(() => {
  for (const c of closers) { try { c(); } catch { /* ignore */ } }
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  else node.kill("SIGKILL");
  provider?.destroy();
});

describe("O4 legitimate payment with a correct public origin (production mode)", () => {
  it("createX402Fetch pays once, the handler runs once, and resource.url is the configured origin", async () => {
    const S = await startSeller(prod((p) => `http://127.0.0.1:${p}`));
    expect(S.mw.info.resourceUrlMode).toBe("origin");
    expect(S.mw.info.production).toBe(true);
    const url = `${S.base}/v1/report?legit=1`;
    expect(required((await raw(url)).pr).resource.url).toBe(url);
    const pay = mkPay(S.base);
    const n0 = await agentNonce();
    const r = await pay(url);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("paid");
    expect(r.response.status).toBe(200);
    expect(await r.response.json()).toMatchObject({ route: "report", query: { legit: "1" } });
    expect(await agentNonce()).toBe(n0 + 1);
    expect(S.calls.n).toBe(1);
  });
});

describe("O4 Host-header poisoning", () => {
  it("Host never changes the advertised resource.url, and a proof bound to the poisoned host is refused", async () => {
    const S = await startSeller(prod(() => "https://api.example.com"));
    const r = await raw(`${S.base}/v1/report?h=1`, { host: "evil.example" });
    expect(r.status).toBe(402);
    expect(required(r.pr).resource.url).toBe("https://api.example.com/v1/report?h=1");
    const { acc, tx } = await payFor(`${S.base}/v1/report?h=2`, { host: "evil.example" });
    const poisoned = await raw(`${S.base}/v1/report?h=2`, { host: "evil.example", "payment-signature": sigHeader(acc, tx, "http://evil.example/v1/report?h=2") });
    expect(poisoned.status).toBe(402);
    expect(poisoned.body.error).toBe(ErrorCodes.wrongResource);
    expect(S.calls.n).toBe(0);
    const ok = await raw(`${S.base}/v1/report?h=2`, { host: "evil.example", "payment-signature": sigHeader(acc, tx, "https://api.example.com/v1/report?h=2") });
    expect(ok.status).toBe(200);
    expect(S.calls.n).toBe(1);
  });
});

describe("O4 forged X-Forwarded-Host / X-Forwarded-Proto", () => {
  for (const trustProxy of [false, true]) {
    it(`trust proxy ${trustProxy ? "ON" : "OFF"}: forged headers change neither the advertised URL nor what a proof may name`, async () => {
      const S = await startSeller(prod(() => "https://api.example.com"), { trustProxy });
      const forged = { "x-forwarded-host": "evil.example", "x-forwarded-proto": "http", host: "evil.example", forwarded: "host=evil.example;proto=http" };
      const r = await raw(`${S.base}/v1/report?xf=1`, forged);
      expect(required(r.pr).resource.url).toBe("https://api.example.com/v1/report?xf=1");
      const { acc, tx } = await payFor(`${S.base}/v1/report?xf=2`, forged);
      // the URL the forged headers describe is exactly what the request "looks like" to Express with trust proxy on
      for (const u of ["http://evil.example/v1/report?xf=2", "https://evil.example/v1/report?xf=2", "http://api.example.com/v1/report?xf=2", "https://api.example.com:8443/v1/report?xf=2"]) {
        const f = await raw(`${S.base}/v1/report?xf=2`, { ...forged, "payment-signature": sigHeader(acc, tx, u) });
        expect(f.status, u).toBe(402);
        expect(f.body.error, u).toBe(ErrorCodes.wrongResource);
      }
      expect(S.calls.n).toBe(0);
      // normalisation: case and the default port do not matter
      const ok = await raw(`${S.base}/v1/report?xf=2`, { ...forged, "payment-signature": sigHeader(acc, tx, "HTTPS://API.EXAMPLE.COM:443/v1/report?xf=2") });
      expect(ok.status).toBe(200);
      expect(S.calls.n).toBe(1);
    });
  }
});

describe("O4 reverse proxy with a base path", () => {
  it("public URL is advertised, the agent pays through the proxy and the handler runs once", async () => {
    // the proxy needs the seller's address and the seller the proxy's: start the proxy against a late-bound target
    const app = express();
    app.set("trust proxy", true); // ignored by O4: only the configured origin is trusted
    const server: Server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
    const sellerBase = `http://127.0.0.1:${(server.address() as any).port}`;
    const P = await startProxy(sellerBase, "/api", { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" });
    const mw = turnspike({
      rpcUrls: [RPC], chainId: CHAIN, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: [SECRET],
      dbPath: join(mkdtempSync(join(tmpdir(), "o4p-")), "s.sqlite"), confirmations: 1, retryAfterSeconds: 1, prices: { "/report": 1000 },
      x402: { production: true, publicOrigin: P, basePath: "/api" }, paymentGraceSeconds: 10 ** 9, clock, onEvent: () => {},
    });
    let n = 0;
    app.use("/v1", x402Seller(mw));
    app.get("/v1/report", (q, r) => { n++; r.json({ route: "report", query: q.query }); });
    closers.push(() => { server.closeAllConnections?.(); server.close(); mw.close(); });

    const url = `${P}/api/v1/report?px=1`;
    const c = await fetch(url);
    expect(c.status).toBe(402);
    expect(required(c.headers.get("payment-required")!).resource.url).toBe(url);

    const pay = mkPay(P);
    const r = await pay(url);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.response.status).toBe(200);
    expect(n).toBe(1);

    // the app-internal URL (no base path) is not the canonical one
    const { acc, tx } = await (async () => {
      const c2 = await fetch(`${P}/api/v1/report?px=2`);
      const acc = required(c2.headers.get("payment-required")!).accepts[0];
      const t = await (vault.connect(agentW) as any).pay(ownerW.address, merchant, acc.extra.requestId, 1000n); await t.wait();
      return { acc, tx: t.hash as string };
    })();
    const internal = await fetch(`${P}/api/v1/report?px=2`, { headers: { "payment-signature": sigHeader(acc, tx, `${P}/v1/report?px=2`) } });
    expect(internal.status).toBe(402);
    expect((await internal.json()).error).toBe(ErrorCodes.wrongResource);
    expect((await fetch(`${P}/api/v1/report?px=2`, { headers: { "payment-signature": sigHeader(acc, tx, `${P}/api/v1/report?px=2`) } })).status).toBe(200);
    expect(n).toBe(2);
  });
});

describe("O4 wrong path, wrong query, dynamic resources", () => {
  it("a proof for one path, query or dynamic id never unlocks another", async () => {
    const O = "https://api.example.com";
    const S = await startSeller(prod(() => O));
    const { acc, tx } = await payFor(`${S.base}/v1/item/1?v=1`);
    const tries: [string, string][] = [
      ["/v1/item/2?v=1", "/v1/item/2?v=1"], // another dynamic id, resource.url forged to match it
      ["/v1/item/2?v=1", "/v1/item/1?v=1"], // another dynamic id, resource.url of the paid one
      ["/v1/item/1?v=2", "/v1/item/1?v=2"], // another query value
      ["/v1/item/1?v=1&x=1", "/v1/item/1?v=1&x=1"], // an extra query parameter
      ["/v1/item/1", "/v1/item/1"], // no query
      ["/v1/item/1?v=1", "/v1/item/1?v=2"], // right request, resource.url names another query
      ["/v1/item/1?v=1", "/v1/item/1/?v=1"], // trailing slash
      ["/v1/item/1?v=1", "/v1/item/1?v=1&v=1"],
    ];
    for (const [path, named] of tries) {
      const r = await raw(`${S.base}${path}`, { "payment-signature": sigHeader(acc, tx, O + named) });
      expect(r.status, `${path} naming ${named}`).toBeGreaterThanOrEqual(400);
      expect([ErrorCodes.wrongResource, "wrong_resource"]).toContain(r.body.error);
    }
    expect(S.calls.n).toBe(0);
    const ok = await raw(`${S.base}/v1/item/1?v=1`, { "payment-signature": sigHeader(acc, tx, `${O}/v1/item/1?v=1`) });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ route: "item", id: "1" });
    expect(S.calls.paths).toEqual(["/v1/item/1?v=1"]);
  });
  it("non-canonical request targets are refused before a challenge is written", async () => {
    const S = await startSeller(prod(() => "https://api.example.com"));
    const refused: string[] = [];
    for (const p of ["/v1/./report", "/v1/x/../report", "/v1/report%2F..", "/v1/item/%2e%2e", "/v1/item/a%5Cb", "/v1/report?a=%zz", "/v1/report?a=\"x\""]) {
      const r = await raw(`${S.base}/`, {}, p);
      expect(r.pr, p).toBeUndefined();
      expect(r.status, p).not.toBe(200);
      if (r.status === 400 && r.body.reason === "non_canonical_url") refused.push(p);
    }
    // unpriced (unrouted) dot-segment paths are 404 without a challenge; priced ones are refused as non-canonical
    expect(refused).toEqual(["/v1/item/%2e%2e", "/v1/item/a%5Cb", "/v1/report?a=%zz", "/v1/report?a=\"x\""]);
  });
});

describe("O4 cross-resource proof replay", () => {
  it("a delivered proof replays only on its own resource; elsewhere it is refused, whatever resource.url says", async () => {
    const O = "https://api.example.com";
    const S = await startSeller(prod(() => O));
    const { acc, tx } = await payFor(`${S.base}/v1/report?r=1`);
    const own = sigHeader(acc, tx, `${O}/v1/report?r=1`);
    expect((await raw(`${S.base}/v1/report?r=1`, { "payment-signature": own })).status).toBe(200);
    for (const [path, named] of [["/v1/item/9", "/v1/report?r=1"], ["/v1/item/9", "/v1/item/9"], ["/v1/report?r=2", "/v1/report?r=1"], ["/v1/report?r=2", "/v1/report?r=2"], ["/v1/report?r=2", null]] as const) {
      const r = await raw(`${S.base}${path}`, { "payment-signature": sigHeader(acc, tx, named === null ? undefined : O + named) });
      expect(r.status, `${path} ${named}`).toBeGreaterThanOrEqual(400);
    }
    // replay on the same resource returns the stored response, the handler ran once
    expect((await raw(`${S.base}/v1/report?r=1`, { "payment-signature": own })).status).toBe(200);
    expect(S.calls.n).toBe(1);
  });
  it("two sellers with different public origins: a proof for one is refused by the other", async () => {
    const A = await startSeller(prod(() => "https://a.example.com"));
    const B = await startSeller(prod(() => "https://b.example.com"));
    const { acc, tx } = await payFor(`${A.base}/v1/report?x=1`);
    for (const u of ["https://a.example.com/v1/report?x=1", "https://b.example.com/v1/report?x=1"]) {
      const r = await raw(`${B.base}/v1/report?x=1`, { "payment-signature": sigHeader(acc, tx, u) });
      expect(r.status, u).toBeGreaterThanOrEqual(400);
    }
    expect(B.calls.n).toBe(0);
  });
});

describe("O4 legacy turnspike/1", () => {
  it("X-PAYMENT on an x402 production seller is unchanged", async () => {
    const S = await startSeller(prod(() => "https://api.example.com"));
    const { challenge, tx } = await payFor(`${S.base}/v1/report?t1=1`, { host: "evil.example" });
    const proof = { requestId: challenge.requestId, txHash: tx, sig: challenge.sig };
    const r = await raw(`${S.base}/v1/report?t1=1`, { "x-payment": b64json(proof), host: "evil.example" });
    expect(r.status).toBe(200);
    expect(S.calls.n).toBe(1);
  });
  it("x402 off: starts under NODE_ENV=production without any origin and issues the plain turnspike/1 402", async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = express();
      const mw = turnspike({
        rpcUrls: [RPC], chainId: CHAIN, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: [SECRET],
        dbPath: join(mkdtempSync(join(tmpdir(), "o4t1-")), "s.sqlite"), confirmations: 1, prices: { "/report": 1000 }, clock, onEvent: () => {},
      });
      app.use("/v1", mw);
      app.get("/v1/report", (_q, r) => r.json({ ok: true }));
      const server: Server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
      closers.push(() => { server.closeAllConnections?.(); server.close(); mw.close(); });
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
            const r = await raw(`${base}/v1/report?a=1`, { host: "evil.example" });
      expect(r.status).toBe(402);
      expect(r.pr).toBeUndefined();
      expect(r.body).toMatchObject({ error: "payment_required", protocol: "turnspike/1", resourceId: "/report?a=1" });
      expect(mw.resourcePolicy).toBeNull();
    } finally { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; }
  });
});
