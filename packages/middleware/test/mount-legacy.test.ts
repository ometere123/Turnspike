// R1 legacy-compat: ONE turnspike/1 middleware instance, X-PAYMENT flow only (no x402), mounted under several prefixes.
// The expectation below is what origin/main (01c7f3b) does: the resourceId is mount-relative and turnspike/1 never checks the
// mount, so a paid challenge redeems under any prefix that serves the same priced path. This file must pass on both
// origin/main and this branch. To run it against another checkout's middleware:
//   MW_ENTRY=<abs path>/packages/middleware/src/index.ts npx vitest run packages/middleware/test/mount-legacy.test.ts
// (the other checkout needs a node_modules junction/symlink to this one; scripts/compat/turnspike1-diff.mjs shows how).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ChildProcess } from "node:child_process";
import { startNode, stopNode } from "../../../scripts/test-util/hardhat-node";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, ethers } from "ethers";

const PORT = 8598;
const RPC = `http://127.0.0.1:${PORT}`;
const art = (p: string) => JSON.parse(readFileSync(join(__dirname, "../../../artifacts/contracts", p), "utf8"));
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
let node: ChildProcess, provider: JsonRpcProvider;
let owner: NonceManager, agent: NonceManager, ownerAddr: string, merchant: string;
let token: ethers.Contract, vault: ethers.Contract;
let turnspike: any;
const wallet = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");
let chainOffset = 0;
const clock = () => Math.floor(Date.now() / 1000) + chainOffset;
const hits: Record<string, number> = {};

beforeAll(async () => {
  process.env.TURNSPIKE_LOG = "off";
  turnspike = (await import(process.env.MW_ENTRY ?? "../src")).turnspike;
  node = startNode(PORT, join(__dirname, "../../.."));
  provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true });
  for (let i = 0; i < 60; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  owner = new NonceManager(wallet(0)); agent = new NonceManager(wallet(1)); ownerAddr = await owner.getAddress(); merchant = wallet(2).address;
  const mk = async (a: any, ...args: any[]) => { const c = await new ContractFactory(a.abi, a.bytecode, owner).deploy(...args); await c.waitForDeployment(); return c as unknown as ethers.Contract; };
  token = await mk(art("test-helpers/MockERC20.sol/MockERC20.json"));
  vault = await mk(art("TurnpikeAllowance.sol/TurnpikeAllowance.json"), await token.getAddress(), 5_000_000n);
  await (await token.mint(ownerAddr, 100_000_000n)).wait();
  await (await (token.connect(owner) as any).approve(await vault.getAddress(), 10n ** 12n)).wait();
  await (await (vault.connect(owner) as any).deposit(2_000_000n)).wait();
  await (await (vault.connect(owner) as any).setPolicy(await agent.getAddress(), 100_000n, 1_000_000n)).wait();
  await (await (vault.connect(owner) as any).setMerchant(merchant, true)).wait();
  chainOffset = (await provider.getBlock("latest"))!.timestamp - Math.floor(Date.now() / 1000);
}, 60_000);
afterAll(() => { stopNode(node); provider.destroy(); });

/** One instance; mounted at /a, /b and (for the reverse-proxy cases) directly at / and under /api in a second app. */
function build() {
  const mw = turnspike({
    rpcUrls: [RPC], chainId: 31337, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: ["m".repeat(40)],
    dbPath: join(mkdtempSync(join(tmpdir(), "tp-mount-")), "t.sqlite"), confirmations: 1, retryAfterSeconds: 1, prices: { "/report": 1000 }, clock, paymentGraceSeconds: 10 ** 9,
  } as any);
  const handler = (tag: string) => (_q: express.Request, r: express.Response) => r.json({ tag, n: (hits[tag] = (hits[tag] ?? 0) + 1) });
  const ab = express(); // two prefixes on one app
  ab.use("/a", mw); ab.use("/b", mw);
  ab.get("/a/report", handler("a")); ab.get("/b/report", handler("b"));
  // reverse proxy: the public app serves under /api, the internal app serves at the root; same instance and same store
  const pub = express(); pub.use("/api", mw); pub.get("/api/report", handler("pub"));
  const internal = express(); internal.use("/", mw); internal.get("/report", handler("int"));
  return { mw, ab, pub, internal };
}
async function paid(app: express.Express, path: string, mw: any) {
  const c = await request(app).get(path);
  expect(c.status).toBe(402);
  const tx = await (vault.connect(agent) as any).pay(ownerAddr, merchant, c.body.requestId, 1000n);
  await tx.wait();
  return { c: c.body, header: b64({ requestId: c.body.requestId, txHash: tx.hash, sig: c.body.sig }), row: mw.store.get(c.body.requestId) };
}
const redeem = (app: express.Express, path: string, header: string) => request(app).get(path).set("X-Payment", header);

describe("turnspike/1 only: one middleware instance under several mount prefixes (R1 legacy compatibility)", () => {
  it("challenge under /a, paid, redeemed under /a: 200, delivered once, replay returns the stored response", async () => {
    const { mw, ab } = build();
    const p = await paid(ab, "/a/report", mw);
    expect(p.c.resourceId).toBe("/report"); // mount-relative, unchanged turnspike/1 body
    const r1 = await redeem(ab, "/a/report", p.header);
    expect(r1.status).toBe(200); expect(r1.body.tag).toBe("a");
    const r2 = await redeem(ab, "/a/report", p.header);
    expect(r2.status).toBe(200); expect(r2.body).toEqual(r1.body);
    mw.close();
  });

  it("challenge under /a, redeemed under /b: same behaviour as origin/main (accepted, runs the /b handler)", async () => {
    const { mw, ab } = build();
    const p = await paid(ab, "/a/report", mw);
    const r = await redeem(ab, "/b/report", p.header);
    expect(r.status).toBe(200); expect(r.body.tag).toBe("b");
    mw.close();
  });

  it("challenge under /b, redeemed under /a: same behaviour as origin/main (accepted, runs the /a handler)", async () => {
    const { mw, ab } = build();
    const p = await paid(ab, "/b/report", mw);
    const r = await redeem(ab, "/a/report", p.header);
    expect(r.status).toBe(200); expect(r.body.tag).toBe("a");
    mw.close();
  });

  it("reverse proxy: challenge through the public /api prefix, redeemed on the internal root mount (and the reverse): accepted", async () => {
    const { mw, pub, internal } = build();
    const p1 = await paid(pub, "/api/report", mw);
    const r1 = await redeem(internal, "/report", p1.header);
    expect(r1.status).toBe(200); expect(r1.body.tag).toBe("int");
    const p2 = await paid(internal, "/report", mw);
    const r2 = await redeem(pub, "/api/report", p2.header);
    expect(r2.status).toBe(200); expect(r2.body.tag).toBe("pub");
    mw.close();
  });
});
