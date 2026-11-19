import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, id, ethers } from "ethers";
import { turnpike, Store } from "../src";
import { computeRequestId, sign, verifySig } from "../src/challenge";

// Local Hardhat node + real contracts. The ERC-20 is the labelled MockERC20 test double (local chain only).
const PORT = 8599;
const RPC = `http://127.0.0.1:${PORT}`;
const SECRET = "x".repeat(40);
const art = (p: string) => JSON.parse(readFileSync(join(__dirname, "../../../artifacts/contracts", p), "utf8"));
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
let node: ChildProcess;
let provider: JsonRpcProvider;
let owner: NonceManager, agent: NonceManager, merchant: string, merchant2: string;
let token: ethers.Contract, vault: ethers.Contract, vault2: ethers.Contract;
let ownerAddr: string;

const wallet = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");
const mine = (n = 1) => provider.send("hardhat_mine", ["0x" + n.toString(16)]);

async function deployAll() {
  const mk = async (a: any, signer: NonceManager, ...args: any[]) => {
    const c = await new ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
    await c.waitForDeployment();
    return c as unknown as ethers.Contract;
  };
  token = await mk(art("test-helpers/MockERC20.sol/MockERC20.json"), owner);
  vault = await mk(art("TurnpikeAllowance.sol/TurnpikeAllowance.json"), owner, await token.getAddress(), 5_000_000n);
  vault2 = await mk(art("TurnpikeAllowance.sol/TurnpikeAllowance.json"), owner, await token.getAddress(), 5_000_000n);
  for (const v of [vault, vault2]) {
    await (await token.mint(ownerAddr, 100_000_000n)).wait();
    await (await (token.connect(owner) as any).approve(await v.getAddress(), 10n ** 12n)).wait();
    await (await (v.connect(owner) as any).deposit(2_000_000n)).wait();
    await (await (v.connect(owner) as any).setPolicy(await agent.getAddress(), 100_000n, 1_000_000n)).wait();
    await (await (v.connect(owner) as any).setMerchant(merchant, true)).wait();
    await (await (v.connect(owner) as any).setMerchant(merchant2, true)).wait();
  }
}

async function pay(v: ethers.Contract, to: string, requestId: string, amount: bigint) {
  const tx = await (v.connect(agent) as any).pay(ownerAddr, to, requestId, amount);
  await tx.wait();
  return tx.hash as string;
}

let counter = 0;
function makeApp(over: Partial<Parameters<typeof turnpike>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tp-"));
  const mw = turnpike({
    rpcUrls: [RPC], chainId: 31337, contract: "", token: "", merchant, hmacSecrets: [SECRET], dbPath: join(dir, "t.sqlite"),
    confirmations: 1, retryAfterSeconds: 1, prices: { "/a": 1000, "/b": 1000 }, ...over,
  } as any);
  const app = express();
  app.use("/paid", mw);
  app.get("/paid/a", (_q, r) => r.json({ resource: "a", n: ++counter }));
  app.get("/paid/b", (_q, r) => r.json({ resource: "b", n: ++counter }));
  return { app, mw, dir };
}
const cfg = () => ({ contract: vault.target as string, token: token.target as string });

beforeAll(async () => {
  process.env.TURNPIKE_LOG = "off";
  node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: join(__dirname, "../../.."), shell: true, stdio: "ignore" });
  provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true });
  for (let i = 0; i < 60; i++) {
    try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  owner = new NonceManager(wallet(0)); agent = new NonceManager(wallet(1));
  ownerAddr = await owner.getAddress(); merchant = wallet(2).address; merchant2 = wallet(3).address;
  await deployAll();
}, 60_000);

afterAll(() => { spawn("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); provider.destroy(); });

async function challenge(app: express.Express, path = "/paid/a") {
  const r = await request(app).get(path);
  expect(r.status).toBe(402);
  return r.body;
}

describe("gateway middleware", () => {
  it("TEST-M01 challenge shape, HMAC valid, TTL", async () => {
    const { app, mw } = makeApp({ ...cfg(), challengeTtlSeconds: 300 });
    const c = await challenge(app);
    expect(c).toMatchObject({ error: "payment_required", priceBase: "1000", chainId: 31337, resourceId: "/a" });
    expect(c.contract).toBe(vault.target); expect(c.token).toBe(token.target);
    const f = { nonce: mw.store.get(c.requestId)!.nonce, merchant: c.merchant, resourceId: c.resourceId, priceBase: c.priceBase, chainId: c.chainId, contract: c.contract, expiresAt: c.expiresAt };
    expect(computeRequestId(f)).toBe(c.requestId);
    expect(verifySig([SECRET], c.requestId, f, c.sig)).toBe(true);
    expect(c.expiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThan(290);
    expect(() => makeApp({ hmacSecrets: ["short"] })).toThrow();
    mw.close();
  });

  it("TEST-M02 valid proof delivers; TEST-M08 same proof twice -> same response, one row, one handler run", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app);
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const before = counter;
    const r1 = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r1.status).toBe(200);
    const r2 = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(r1.body);
    expect(counter).toBe(before + 1);
    expect(mw.store.db.prepare("SELECT COUNT(*) c FROM payments").get()).toEqual({ c: 1 });
    expect(mw.store.get(c.requestId)!.state).toBe("DELIVERED");
    // no second charge: reusing the id on-chain reverts
    await expect(pay(vault, merchant, c.requestId, 1000n)).rejects.toThrow();
    mw.close();
  });

  it("TEST-M03 log from a different contract is rejected", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app);
    const txHash = await pay(vault2, merchant, c.requestId, 1000n); // genuine Paid log, wrong contract
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    expect(r.status).toBe(402); expect(r.body.reason).toBe("no_matching_paid_log");
    mw.close();
  });

  it("TEST-M04 proof for resource X is refused on Y", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app, "/paid/a");
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const r = await request(app).get("/paid/b").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    expect(r.status).toBe(403); expect(r.body.error).toBe("wrong_resource");
    const ok = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    expect(ok.status).toBe(200);
    mw.close();
  });

  it("TEST-M05 amount below price is rejected", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app);
    const txHash = await pay(vault, merchant, c.requestId, 999n);
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    expect(r.status).toBe(402); expect(r.body.reason).toBe("amount_below_price");
    mw.close();
  });

  it("TEST-M06 payment to the wrong merchant is rejected", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app);
    const txHash = await pay(vault, merchant2, c.requestId, 1000n);
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    expect(r.status).toBe(402); expect(r.body.reason).toBe("wrong_merchant");
    mw.close();
  });

  it("TEST-M07 state machine and unique constraints", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app);
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    const path = mw.store.db.prepare("SELECT toState FROM events WHERE requestId=? ORDER BY id").all(c.requestId).map((r: any) => r.toState);
    expect(path).toEqual(["ISSUED", "PAID_PENDING", "PAID_CONFIRMED", "DELIVERED"]);
    // the same txHash cannot back a second request
    const c2 = await challenge(app);
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c2.requestId, txHash }));
    expect(r.status).toBe(402); // that tx's Paid log carries a different requestId
    expect(() => mw.store.db.prepare("UPDATE payments SET txHash=? WHERE requestId=?").run(txHash, c2.requestId)).toThrow(/UNIQUE/);
    expect(mw.store.transition(c.requestId, ["ISSUED"], "EXPIRED")).toBe(false); // illegal transition refused
    mw.close();
  });

  it("TEST-M07b expired unpaid challenge -> 410", async () => {
    const { app, mw } = makeApp({ ...cfg(), challengeTtlSeconds: 1 });
    const c = await challenge(app);
    await new Promise((r) => setTimeout(r, 2100));
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash: id("x") }));
    expect(r.status).toBe(410);
    mw.close();
  });

  it("TEST-M09 real process crash after PAID_CONFIRMED, restart, retry delivers without a new charge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tp9-"));
    const env = { ...process.env, TURNPIKE_LOG: "off", RPC, CHAIN_ID: "31337", VAULT: vault.target as string, TOKEN: token.target as string, MERCHANT: merchant, HMAC_SECRET: SECRET, DB: join(dir, "c.sqlite") };
    const start = (port: number, crash: boolean) =>
      new Promise<ChildProcess>((res, rej) => {
        const p = spawn(process.execPath, ["-r", "ts-node/register/transpile-only", join(__dirname, "fixture-server.ts")], { env: { ...env, PORT: String(port), CRASH: crash ? "1" : "0" }, cwd: join(__dirname, "../../..") });
        p.stdout!.on("data", (d) => String(d).includes("ready") && res(p));
        p.on("error", rej);
        setTimeout(() => rej(new Error("server start timeout")), 20000);
      });
    const p1 = await start(8611, true);
    const c = await (await fetch("http://127.0.0.1:8611/paid/a")).json();
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const exited = new Promise((r) => p1.on("exit", r));
    await fetch("http://127.0.0.1:8611/paid/a", { headers: { "x-payment": b64({ requestId: c.requestId, txHash }) } }).catch(() => {});
    await exited; // process really died inside the handler
    const db = new Store(join(dir, "c.sqlite"));
    expect(db.get(c.requestId)!.state).toBe("PAID_CONFIRMED"); // paid, not delivered
    db.close();
    const p2 = await start(8612, false);
    const r = await fetch("http://127.0.0.1:8612/paid/a", { headers: { "x-payment": b64({ requestId: c.requestId, txHash }) } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.deliveredBy).toBe(p2.pid);
    expect(await vault.isUsed(merchant, c.requestId)).toBe(true); // paid exactly once
    const again = await (await fetch("http://127.0.0.1:8612/paid/a", { headers: { "x-payment": b64({ requestId: c.requestId, txHash }) } })).json();
    expect(again).toEqual(body);
    p2.kill();
  }, 60_000);

  it("TEST-M10 unknown tx and under-confirmed payment are pending, then succeed", async () => {
    const { app, mw } = makeApp({ ...cfg(), confirmations: 3 });
    const c = await challenge(app);
    const none = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash: id("nonexistent") }));
    expect(none.status).toBe(202); expect(none.body).toMatchObject({ status: "pending", why: "no_receipt" });
    expect(mw.store.get(c.requestId)!.state).toBe("PAID_PENDING");
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const under = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    expect(under.status).toBe(202); expect(under.body.why).toBe("confirmations"); expect(under.body.retryAfter).toBeGreaterThan(0);
    await mine(2);
    const ok = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    expect(ok.status).toBe(200);
    mw.close();
  });

  it("TEST-M11 drop-in: free routes pass through, unmatched paths are not charged", async () => {
    const { app, mw } = makeApp(cfg());
    app.get("/paid/free", (_q, r) => r.json({ free: true }));
    expect((await request(app).get("/paid/free")).status).toBe(200);
    mw.close();
  });

  it("TEST-M12 rate limit, and RPC1 down -> RPC2 failover", async () => {
    const { app, mw } = makeApp({ ...cfg(), rateLimitPerMinute: 3 });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await request(app).get("/paid/a")).status);
    expect(codes).toEqual([402, 402, 402, 429, 429]);
    mw.close();
    const f = makeApp({ ...cfg(), rpcUrls: ["http://127.0.0.1:1", RPC] });
    const c = await challenge(f.app);
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const r = await request(f.app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash }));
    expect(r.status).toBe(200);
    f.mw.close();
    const dead = makeApp({ ...cfg(), rpcUrls: ["http://127.0.0.1:1"] });
    const c2 = await challenge(dead.app);
    const r2 = await request(dead.app).get("/paid/a").set("X-Payment", b64({ requestId: c2.requestId, txHash: id("q") }));
    expect(r2.status).toBe(503); expect(r2.body.error).toBe("rpc_unavailable");
    dead.mw.close();
  });

  it("TEST-M13 failing preflight -> 503, no challenge, no row, nothing charged", async () => {
    const { app, mw } = makeApp({ ...cfg(), prices: { "/a": { priceBase: 1000, preflight: async () => "oracle_unavailable" } } });
    const r = await request(app).get("/paid/a");
    expect(r.status).toBe(503); expect(r.body).toEqual({ error: "oracle_unavailable" });
    expect(mw.store.db.prepare("SELECT COUNT(*) c FROM payments").get()).toEqual({ c: 0 });
    mw.close();
  });

  it("TEST-M13b paid but handler fails -> stays PAID_CONFIRMED, same proof retries and delivers", async () => {
    const m2 = makeApp({ ...cfg(), prices: { "/c": 1000 } });
    let calls = 0;
    m2.app.get("/paid/c", (_q, r) => (++calls === 1 ? r.status(503).json({ error: "oracle_unavailable" }) : r.json({ price: 1 })));
    const c = await challenge(m2.app, "/paid/c");
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const h = { "X-Payment": b64({ requestId: c.requestId, txHash }) };
    expect((await request(m2.app).get("/paid/c").set(h)).status).toBe(503);
    expect(m2.mw.store.get(c.requestId)!.state).toBe("PAID_CONFIRMED");
    expect((await request(m2.app).get("/paid/c").set(h)).status).toBe(200);
    expect(m2.mw.store.get(c.requestId)!.state).toBe("DELIVERED");
    m2.mw.close();
  });

  it("TEST-S01 HMAC secret rotation: previous secret still verifies, unknown does not", () => {
    const f = { nonce: id("n"), merchant: "0x" + "11".repeat(20), resourceId: "/a", priceBase: "1000", chainId: 1, contract: "0x" + "22".repeat(20), expiresAt: 9 };
    const rid = computeRequestId({ ...f, merchant: ethers.getAddress(f.merchant), contract: ethers.getAddress(f.contract) });
    const sig = sign("old".repeat(15), rid, f);
    expect(verifySig(["new".repeat(15), "old".repeat(15)], rid, f, sig)).toBe(true);
    expect(verifySig(["new".repeat(15)], rid, f, sig)).toBe(false);
  });
});
