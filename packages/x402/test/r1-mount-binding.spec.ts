// R1: one middleware instance mounted under two prefixes. The resourceId is relative to the mount, so /a/report and
// /b/report get the same resourceId. The stored challenge row records the mount prefix it was issued under, and an x402
// presentation is accepted only under that prefix, with or without `resource` in the PAYMENT-SIGNATURE.
// The turnspike/1 X-PAYMENT header is NOT mount-bound: it behaves as on origin/main (see the last test here and
// packages/middleware/test/mount-legacy.test.ts, which runs the same scenarios against origin/main's middleware).
// Local Hardhat only, the real contract, the real middleware through x402Seller.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { startNode, stopNode } from "../../../scripts/test-util/hardhat-node";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { turnspike, type TurnspikeMiddleware } from "@turnspike-qie/middleware";
import { x402Seller, b64json, unb64json } from "../src";

const PORT = 8751;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN = 31337;
const ROOT = resolve(__dirname, "../../..");
const PHRASE = "test test test test test test test test test test test junk";
const PRICE = 1000n;
const art = (p: string) => JSON.parse(readFileSync(join(ROOT, "artifacts/contracts", p), "utf8"));

let node: ChildProcess;
let provider: JsonRpcProvider;
let token: ethers.Contract, vault: ethers.Contract;
let owner: HDNodeWallet, agent: HDNodeWallet;
let merchant: string;
let mw: TurnspikeMiddleware;
let base = "";
let server: Server;
const calls = { a: 0, b: 0 };
const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);

beforeAll(async () => {
  process.env.TURNSPIKE_LOG = "off";
  node = startNode(PORT, ROOT);
  provider = new JsonRpcProvider(RPC, CHAIN, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 200 } as any);
  for (let i = 0; i < 120; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const deployer = new NonceManager(w(0));
  const mock = art("test-helpers/MockERC20.sol/MockERC20.json");
  token = (await (await new ContractFactory(mock.abi, mock.bytecode, deployer).deploy()).waitForDeployment()) as any;
  const va = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  vault = (await (await new ContractFactory(va.abi, va.bytecode, deployer).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment()) as any;
  owner = w(4); agent = w(1); merchant = w(2).address;
  await (await (token.connect(deployer) as any).mint(owner.address, 1_000_000n)).wait();
  await (await (token.connect(owner) as any).approve(vault.target, 1_000_000n)).wait();
  await (await (vault.connect(owner) as any).deposit(1_000_000n)).wait();
  await (await (vault.connect(owner) as any).setPolicy(agent.address, 50_000n, 1_000_000n)).wait();
  await (await (vault.connect(owner) as any).setMerchant(merchant, true)).wait();
  const chainOffset = (await provider.getBlock("latest"))!.timestamp - Math.floor(Date.now() / 1000);
  mw = turnspike({
    rpcUrls: [RPC], chainId: CHAIN, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: ["r1".repeat(20)],
    dbPath: join(mkdtempSync(join(tmpdir(), "r1-")), "s.sqlite"), confirmations: 1, retryAfterSeconds: 1, prices: { "/report": Number(PRICE) }, x402: true,
    rateLimitPerMinute: 100_000, paymentGraceSeconds: 600, clock: () => Math.floor(Date.now() / 1000) + chainOffset,
  });
  const app = express();
  const h = x402Seller(mw); // ONE handler over ONE middleware instance, mounted under two prefixes
  app.use(["/a", "/b"], h);
  app.get("/a/report", (_q, r) => r.json({ mount: "a", n: ++calls.a }));
  app.get("/b/report", (_q, r) => r.json({ mount: "b", n: ++calls.b }));
  server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
}, 180_000);

afterAll(() => {
  server?.closeAllConnections?.(); server?.close(); mw?.close();
  stopNode(node);
  provider?.destroy();
});

/** A paid challenge for `path`: the accepted requirement, the resource and the mined transaction. */
async function paidChallenge(path: string) {
  const res = await fetch(`${base}${path}`);
  expect(res.status).toBe(402);
  const pr = unb64json<any>(res.headers.get("payment-required")!);
  const acc = pr.accepts[0];
  const tx = await (vault.connect(agent) as any).pay(owner.address, merchant, acc.extra.requestId, PRICE);
  await tx.wait();
  return { acc, resource: pr.resource, txHash: tx.hash as string };
}
const sig = (p: { acc: any; resource: any; txHash: string }, withResource: boolean) =>
  b64json({ x402Version: 2, ...(withResource ? { resource: p.resource } : {}), accepted: p.acc, payload: { requestId: p.acc.extra.requestId, txHash: p.txHash, sig: p.acc.extra.sig } });
const present = (path: string, header: string) => fetch(`${base}${path}`, { headers: { "payment-signature": header } });

describe("R1: x402 proofs are bound to the mount prefix", () => {
  it("both mounts derive the same resourceId (the precondition of the defect); the row records its mount", async () => {
    const ra = await (await fetch(`${base}/a/report`)).json();
    const rb = await (await fetch(`${base}/b/report`)).json();
    expect(ra.resourceId).toBe(rb.resourceId); // turnspike/1 body unchanged: the resourceId stays mount-relative
    expect(mw.store.get(ra.requestId.toLowerCase())!.mount).toBe("/a");
    expect(mw.store.get(rb.requestId.toLowerCase())!.mount).toBe("/b");
  });

  it("a proof for /a/report without `resource` cannot unlock /b/report; the handler never runs and the proof still works under /a", async () => {
    const p = await paidChallenge("/a/report");
    const before = calls.b;
    const cross = await present("/b/report", sig(p, false));
    expect(cross.status).toBe(402);
    expect(calls.b).toBe(before);
    const row = mw.store.get(p.acc.extra.requestId.toLowerCase())!;
    expect(row.state === "DELIVERED" || row.state === "PAID_CONFIRMED").toBe(false); // the cross-mount attempt settled nothing
    const own = await present("/a/report", sig(p, false));
    expect(own.status).toBe(200);
    expect((await own.json()).mount).toBe("a");
    // after delivery under /a, replaying at /b is still refused
    const again = await present("/b/report", sig(p, false));
    expect(again.status).toBe(402);
    expect(calls.b).toBe(before);
  });

  it("a proof for /a/report with `resource` cannot unlock /b/report either", async () => {
    const p = await paidChallenge("/a/report");
    const before = calls.b;
    const cross = await present("/b/report", sig(p, true));
    expect(cross.status).toBe(402);
    expect(calls.b).toBe(before);
    const own = await present("/a/report", sig(p, true));
    expect(own.status).toBe(200);
  });

  it("the reverse direction: a proof for /b/report cannot unlock /a/report", async () => {
    const p = await paidChallenge("/b/report");
    const before = calls.a;
    expect((await present("/a/report", sig(p, false))).status).toBe(402);
    expect(calls.a).toBe(before);
    expect((await present("/b/report", sig(p, false))).status).toBe(200);
  });

  it("turnspike/1 X-PAYMENT is not mount-bound (unchanged from origin/main), even with x402 enabled on the instance", async () => {
    const p = await paidChallenge("/a/report");
    const before = calls.b;
    const xp = b64json({ requestId: p.acc.extra.requestId, txHash: p.txHash, sig: p.acc.extra.sig });
    const r = await fetch(`${base}/b/report`, { headers: { "x-payment": xp } });
    expect(r.status).toBe(200);
    expect((await r.json()).mount).toBe("b");
    expect(calls.b).toBe(before + 1);
  });
});
