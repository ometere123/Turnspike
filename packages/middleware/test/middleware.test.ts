import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, id, ethers } from "ethers";
import { turnspike, Store } from "../src";
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
// Earlier tests move the local chain clock forward; challenge expiry follows chain time so deadlines are meaningful.
let chainOffset = 0;
const syncClock = async () => { chainOffset = (await provider.getBlock("latest"))!.timestamp - Math.floor(Date.now() / 1000); };
const clock = () => Math.floor(Date.now() / 1000) + chainOffset;
function makeApp(over: Partial<Parameters<typeof turnspike>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tp-"));
  const mw = turnspike({
    rpcUrls: [RPC], chainId: 31337, contract: "", token: "", merchant, hmacSecrets: [SECRET], dbPath: join(dir, "t.sqlite"),
    confirmations: 1, retryAfterSeconds: 1, prices: { "/a": 1000, "/b": 1000 }, clock, paymentGraceSeconds: 10 ** 9, ...over, // deadline tests override the grace
  } as any);
  const app = express();
  app.use("/paid", mw);
  app.get("/paid/a", (_q, r) => r.json({ resource: "a", n: ++counter }));
  app.get("/paid/b", (_q, r) => r.json({ resource: "b", n: ++counter }));
  return { app, mw, dir };
}
const cfg = () => ({ contract: vault.target as string, token: token.target as string });

beforeAll(async () => {
  process.env.TURNSPIKE_LOG = "off";
  node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: join(__dirname, "../../.."), shell: true, stdio: "ignore" });
  provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true });
  for (let i = 0; i < 60; i++) {
    try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  owner = new NonceManager(wallet(0)); agent = new NonceManager(wallet(1));
  ownerAddr = await owner.getAddress(); merchant = wallet(2).address; merchant2 = wallet(3).address;
  await deployAll();
}, 60_000);

afterAll(() => { spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); provider.destroy(); });

async function challenge(app: express.Express, path = "/paid/a") {
  const r = await request(app).get(path);
  expect(r.status).toBe(402);
  return r.body;
}

describe("gateway middleware", () => {
  beforeEach(syncClock);
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
    const r2 = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
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
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r.status).toBe(402); expect(r.body.reason).toBe("no_matching_paid_log");
    mw.close();
  });

  it("TEST-M04 proof for resource X is refused on Y", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app, "/paid/a");
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const r = await request(app).get("/paid/b").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r.status).toBe(403); expect(r.body.error).toBe("wrong_resource");
    const ok = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(ok.status).toBe(200);
    mw.close();
  });

  it("TEST-M05 amount below price is rejected", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app);
    const txHash = await pay(vault, merchant, c.requestId, 999n);
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r.status).toBe(402); expect(r.body.reason).toBe("amount_below_price");
    mw.close();
  });

  it("TEST-M06 payment to the wrong merchant is rejected", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app);
    const txHash = await pay(vault, merchant2, c.requestId, 1000n);
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r.status).toBe(402); expect(r.body.reason).toBe("wrong_merchant");
    mw.close();
  });

  it("TEST-M07 state machine and unique constraints", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app);
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    const path = mw.store.db.prepare("SELECT toState FROM events WHERE requestId=? ORDER BY id").all(c.requestId).map((r: any) => r.toState);
    expect(path).toEqual(["ISSUED", "PAID_PENDING", "PAID_CONFIRMED", "DELIVERING", "DELIVERED"]);
    // the same txHash cannot back a second request
    const c2 = await challenge(app);
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c2.requestId, txHash, sig: c2.sig }));
    expect(r.status).toBe(402); // that tx's Paid log carries a different requestId
    expect(() => mw.store.db.prepare("UPDATE payments SET txHash=? WHERE requestId=?").run(txHash, c2.requestId)).toThrow(/UNIQUE/);
    expect(mw.store.transition(c.requestId, ["ISSUED"], "EXPIRED")).toBe(false); // illegal transition refused
    mw.close();
  });

  it("TEST-M07b an expired challenge with no payment never delivers (pending, not 410)", async () => {
    const { app, mw } = makeApp({ ...cfg(), challengeTtlSeconds: 1 });
    const c = await challenge(app);
    await new Promise((r) => setTimeout(r, 2100));
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash: id("x"), sig: c.sig }));
    expect(r.status).toBe(202);
    expect(r.body.why).toBe("no_receipt");
    mw.close();
  });

  it("TEST-M09 real process crash after PAID_CONFIRMED, restart, retry delivers without a new charge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tp9-"));
    const env = { ...process.env, TURNSPIKE_LOG: "off", RPC, CHAIN_ID: "31337", VAULT: vault.target as string, TOKEN: token.target as string, MERCHANT: merchant, HMAC_SECRET: SECRET, DB: join(dir, "c.sqlite") };
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
    await fetch("http://127.0.0.1:8611/paid/a", { headers: { "x-payment": b64({ requestId: c.requestId, txHash, sig: c.sig }) } }).catch(() => {});
    await exited; // process really died inside the handler
    const db = new Store(join(dir, "c.sqlite"));
    expect(db.get(c.requestId)!.state).toBe("DELIVERING"); // paid, handler was running, lease held, nothing stored
    expect(db.get(c.requestId)!.responseBody).toBeNull();
    db.close();
    const p2 = await start(8612, false);
    const early = await fetch("http://127.0.0.1:8612/paid/a", { headers: { "x-payment": b64({ requestId: c.requestId, txHash, sig: c.sig }) } });
    expect(early.status).toBe(202); // the dead process's lease has not lapsed yet: no duplicate handler run
    expect((await early.json()).why).toBe("delivering");
    await new Promise((r) => setTimeout(r, 2600)); // lease is 2 s in the fixture (the minimum)
    const r = await fetch("http://127.0.0.1:8612/paid/a", { headers: { "x-payment": b64({ requestId: c.requestId, txHash, sig: c.sig }) } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.deliveredBy).toBe(p2.pid);
    expect(await vault.isUsed(merchant, c.requestId)).toBe(true); // paid exactly once
    const again = await (await fetch("http://127.0.0.1:8612/paid/a", { headers: { "x-payment": b64({ requestId: c.requestId, txHash, sig: c.sig }) } })).json();
    expect(again).toEqual(body);
    p2.kill();
  }, 60_000);

  it("TEST-M10 unknown tx and under-confirmed payment are pending, then succeed", async () => {
    const { app, mw } = makeApp({ ...cfg(), confirmations: 3 });
    const c = await challenge(app);
    const none = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash: id("nonexistent"), sig: c.sig }));
    expect(none.status).toBe(202); expect(none.body).toMatchObject({ status: "pending", why: "no_receipt" });
    expect(mw.store.get(c.requestId)!.state).toBe("PAID_PENDING");
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const under = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(under.status).toBe(202); expect(under.body.why).toBe("confirmations"); expect(under.body.retryAfter).toBeGreaterThan(0);
    await mine(2);
    const ok = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
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
    const r = await request(f.app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r.status).toBe(200);
    f.mw.close();
    const dead = makeApp({ ...cfg(), rpcUrls: ["http://127.0.0.1:1"] });
    const c2 = await challenge(dead.app);
    const r2 = await request(dead.app).get("/paid/a").set("X-Payment", b64({ requestId: c2.requestId, txHash: id("q"), sig: c2.sig }));
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
    const h = { "X-Payment": b64({ requestId: c.requestId, txHash, sig: c.sig }) };
    expect((await request(m2.app).get("/paid/c").set(h)).status).toBe(503);
    expect(m2.mw.store.get(c.requestId)!.state).toBe("PAID_CONFIRMED");
    expect((await request(m2.app).get("/paid/c").set(h)).status).toBe(200);
    expect(m2.mw.store.get(c.requestId)!.state).toBe("DELIVERED");
    m2.mw.close();
  });

  it("TEST-SEC-A proof needs a valid sig; replay never leaks the stored body to a caller without it", async () => {
    const { app, mw } = makeApp(cfg());
    const c = await challenge(app);
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const ok = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(ok.status).toBe(200);
    const attempts: [string, object | string, number, string][] = [
      ["no sig", { requestId: c.requestId, txHash }, 402, "malformed_proof"],
      ["wrong sig", { requestId: c.requestId, txHash, sig: "0".repeat(64) }, 402, "bad_signature"],
      ["extra field", { requestId: c.requestId, txHash, sig: c.sig, owner: "0x1" }, 402, "malformed_proof"],
      ["wrong tx with right sig", { requestId: c.requestId, txHash: id("other"), sig: c.sig }, 409, ""],
    ];
    for (const [name, p, status, reason] of attempts) {
      const r = await request(app).get("/paid/a").set("X-Payment", b64(p as object));
      expect([name, r.status]).toEqual([name, status]);
      if (reason) expect(r.body.reason).toBe(reason);
      expect(JSON.stringify(r.body)).not.toContain('"resource"'); // none of these ever reveal the stored response
    }
    expect((await request(app).get("/paid/a").set("X-Payment", "!!!not-base64-json")).status).toBe(402);
    expect((await request(app).get("/paid/a").set("X-Payment", "A".repeat(3000))).status).toBe(402);
    const again = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(again.body).toEqual(ok.body); // the real holder still replays fine
    mw.close();
  });

  it("TEST-SEC-B a payment mined before expiry is honoured when the proof arrives after expiry (gateway outage recovery)", async () => {
    const { app, mw } = makeApp({ ...cfg(), challengeTtlSeconds: 1 });
    const c = await challenge(app);
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    await new Promise((r) => setTimeout(r, 2300)); // challenge has now expired in wall-clock terms
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r.status).toBe(200);
    expect(mw.store.get(c.requestId)!.state).toBe("DELIVERED");
    mw.close();
  });

  it("TEST-SEC-C a payment mined far after expiry is refused, recorded and counted as paid-but-undelivered", async () => {
    const { app, mw } = makeApp({ ...cfg(), challengeTtlSeconds: 1, paymentGraceSeconds: 0 });
    const c = await challenge(app);
    await provider.send("evm_increaseTime", [30]);
    await mine(1);
    const txHash = await pay(vault, merchant, c.requestId, 1000n); // block time is now well past expiresAt
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r.status).toBe(402); expect(r.body.reason).toBe("paid_too_late");
    const row = mw.store.get(c.requestId)!;
    expect(row.state).toBe("REJECTED"); expect(row.txHash).toBe(txHash.toLowerCase());
    expect(mw.store.stats([]).paidUndelivered24h).toBe(1);
    mw.close();
  });

  it("TEST-SEC-D payer binding: owner and agent allowlists", async () => {
    const wrongOwner = makeApp({ ...cfg(), allowedOwners: [merchant2] });
    const c1 = await challenge(wrongOwner.app);
    const tx1 = await pay(vault, merchant, c1.requestId, 1000n);
    const r1 = await request(wrongOwner.app).get("/paid/a").set("X-Payment", b64({ requestId: c1.requestId, txHash: tx1, sig: c1.sig }));
    expect(r1.body.reason).toBe("owner_not_permitted");
    expect(wrongOwner.mw.store.get(c1.requestId)!.state).toBe("PAID_PENDING"); // not poisoned: stays open
    wrongOwner.mw.close();
    const wrongAgent = makeApp({ ...cfg(), allowedAgents: [merchant2] });
    const c2 = await challenge(wrongAgent.app);
    const tx2 = await pay(vault, merchant, c2.requestId, 1000n);
    expect((await request(wrongAgent.app).get("/paid/a").set("X-Payment", b64({ requestId: c2.requestId, txHash: tx2, sig: c2.sig }))).body.reason).toBe("agent_not_permitted");
    wrongAgent.mw.close();
    const right = makeApp({ ...cfg(), allowedOwners: [ownerAddr.toLowerCase()], allowedAgents: [await agent.getAddress()] });
    const c3 = await challenge(right.app);
    const tx3 = await pay(vault, merchant, c3.requestId, 1000n);
    expect((await request(right.app).get("/paid/a").set("X-Payment", b64({ requestId: c3.requestId, txHash: tx3, sig: c3.sig }))).status).toBe(200);
    expect(right.mw.store.get(c3.requestId)).toMatchObject({ payer: ownerAddr, agent: await agent.getAddress() });
    right.mw.close();
  });

  it("TEST-SEC-E concurrent redemption of one proof runs the handler once", async () => {
    const m = makeApp({ ...cfg(), prices: { "/slow": 1000 } });
    let runs = 0;
    m.app.get("/paid/slow", async (_q, r) => { runs++; await new Promise((x) => setTimeout(x, 300)); r.json({ slow: runs }); });
    const c = await challenge(m.app, "/paid/slow");
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const hdr = b64({ requestId: c.requestId, txHash, sig: c.sig });
    const results = await Promise.all(Array.from({ length: 8 }, () => request(m.app).get("/paid/slow").set("X-Payment", hdr)));
    expect(results.every((r) => r.status === 200 || r.status === 202)).toBe(true);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(runs).toBe(1);
    const after = await request(m.app).get("/paid/slow").set("X-Payment", hdr);
    expect(after.status).toBe(200); expect(after.body).toEqual({ slow: 1 }); expect(runs).toBe(1);
    m.mw.close();
  });

  it("TEST-SEC-F the response is persisted before it is sent: a storage failure sends nothing and the proof can retry", async () => {
    const m = makeApp({ ...cfg(), deliveryLeaseSeconds: 2 });
    const c = await challenge(m.app);
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const hdr = b64({ requestId: c.requestId, txHash, sig: c.sig });
    const real = m.mw.store.completeDelivery.bind(m.mw.store);
    (m.mw.store as any).completeDelivery = () => { throw Object.assign(new Error("disk full"), { code: "SQLITE_FULL" }); };
    const r = await request(m.app).get("/paid/a").set("X-Payment", hdr);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain('"resource"'); // the client never saw the handler output
    (m.mw.store as any).completeDelivery = real;
    await new Promise((x) => setTimeout(x, 3300)); // lease granularity is whole seconds
    const retry = await request(m.app).get("/paid/a").set("X-Payment", hdr);
    expect(retry.status).toBe(200);
    expect(m.mw.store.get(c.requestId)!.state).toBe("DELIVERED");
    m.mw.close();
  });

  it("TEST-SEC-G storage unavailable -> 503, never a fabricated response", async () => {
    const m = makeApp(cfg());
    const c = await challenge(m.app);
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    m.mw.store.db.close();
    const r = await request(m.app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r.status).toBe(503); expect(r.body.error).toBe("storage_unavailable");
  });

  it("TEST-SEC-H a reorg that drops the payment never delivers; the replacement payment does", async () => {
    const { app, mw } = makeApp(cfg());
    const snap = await provider.send("evm_snapshot", []);
    const c = await challenge(app);
    const tx1 = await pay(vault, merchant, c.requestId, 1000n);
    await provider.send("evm_revert", [snap]); // the chain forgets that payment
    await new Promise((r) => setTimeout(r, 400)); // let the provider's 250 ms result cache expire so the nonce is re-read from the reverted chain
    (agent as NonceManager).reset();
    const gone = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash: tx1, sig: c.sig }));
    expect(gone.status).toBe(202); expect(gone.body.why).toBe("no_receipt");
    expect(mw.store.get(c.requestId)!.state).toBe("PAID_PENDING");
    const tx2 = await pay(vault, merchant, c.requestId, 1000n); // the same request id is payable again on the new fork
    const ok = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash: tx2, sig: c.sig }));
    expect(ok.status).toBe(200);
    mw.close();
  });

  it("TEST-SEC-I a handler that throws leaves the payment retryable, then delivers once", async () => {
    const m = makeApp({ ...cfg(), prices: { "/boom": 1000 } });
    let calls = 0;
    m.app.get("/paid/boom", (_q, r) => { if (++calls === 1) throw new Error("handler bug"); r.json({ ok: calls }); });
    m.app.use((_e: any, _q: any, r: any, _n: any) => r.status(500).json({ error: "internal" }));
    const c = await challenge(m.app, "/paid/boom");
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const hdr = b64({ requestId: c.requestId, txHash, sig: c.sig });
    expect((await request(m.app).get("/paid/boom").set("X-Payment", hdr)).status).toBe(500);
    expect(m.mw.store.get(c.requestId)!.state).toBe("PAID_CONFIRMED");
    const r2 = await request(m.app).get("/paid/boom").set("X-Payment", hdr);
    expect(r2.status).toBe(200); expect(r2.body).toEqual({ ok: 2 });
    m.mw.close();
  });

  it("TEST-SEC-J retention: unpaid rows are purged only after the deadline, a reconcile past it, and retention; paid rows never", async () => {
    const { app, mw } = makeApp({ ...cfg(), challengeTtlSeconds: 5, paymentGraceSeconds: 5, retentionSeconds: 0 });
    const unpaid = await challenge(app);
    const paid = await challenge(app);
    const txHash = await pay(vault, merchant, paid.requestId, 1000n);
    await request(app).get("/paid/a").set("X-Payment", b64({ requestId: paid.requestId, txHash, sig: paid.sig }));
    mw.store.db.prepare("UPDATE payments SET createdAt = createdAt - 10").run();
    expect(mw.purge()).toBe(0); // never reconciled: nothing can be deleted
    await provider.send("evm_increaseTime", [30]); await mine(2); // chain time passes the payment deadline
    await mw.reconcile({ lookbackBlocks: 500 });
    expect(mw.purge()).toBe(1);
    expect(mw.store.get(unpaid.requestId)).toBeUndefined();
    expect(mw.store.get(paid.requestId)!.state).toBe("DELIVERED");
    mw.close();
  });

  it("TEST-REC-1 a payment the gateway never saw a proof for is found by reconcile, kept, and still redeemable", async () => {
    const { app, mw } = makeApp({ ...cfg(), retentionSeconds: 0 });
    const c = await challenge(app);
    const txHash = await pay(vault, merchant, c.requestId, 1000n); // the agent paid, then lost contact with the gateway
    await mine(1);
    const r = await mw.reconcile({ lookbackBlocks: 500 });
    expect(r.recovered).toBe(1);
    expect(mw.store.get(c.requestId)).toMatchObject({ state: "PAID_CONFIRMED", txHash: txHash.toLowerCase() });
    mw.store.db.prepare("UPDATE payments SET createdAt = createdAt - 999999").run();
    mw.purge();
    expect(mw.store.get(c.requestId)).toBeDefined(); // paid rows are never purged
    const ok = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(ok.status).toBe(200);
    mw.close();
  });

  it("TEST-BAK-1 online backup, total loss, restore: delivered responses replay, payments made since are recovered, and the limit of both is explicit", async () => {
    const first = makeApp(cfg());
    const proof = (c: any, txHash: string) => b64({ requestId: c.requestId, txHash, sig: c.sig });
    // Before the backup: one delivered purchase, and one challenge whose payment has not happened yet.
    const done = await challenge(first.app);
    const doneTx = await pay(vault, merchant, done.requestId, 1000n);
    const delivered = await request(first.app).get("/paid/a").set("X-Payment", proof(done, doneTx));
    expect(delivered.status).toBe(200);
    const open = await challenge(first.app);

    const backup = join(first.dir, "backup.sqlite");
    await first.mw.store.db.backup(backup); // the same online backup call as docs/OPERATIONS.md, with the service running

    // After the backup: the open challenge is paid and delivered, and a brand new challenge is issued and paid.
    const openTx = await pay(vault, merchant, open.requestId, 1000n);
    expect((await request(first.app).get("/paid/a").set("X-Payment", proof(open, openTx))).status).toBe(200);
    const late = await challenge(first.app);
    const lateTx = await pay(vault, merchant, late.requestId, 1000n);
    await mine(1);
    first.mw.close(); // the original database is now treated as lost

    const second = makeApp({ ...cfg(), dbPath: backup });
    const check = second.mw.store.db.pragma("integrity_check") as { integrity_check: string }[];
    expect(check[0].integrity_check).toBe("ok");

    // 1. What was delivered before the backup replays byte for byte; the handler does not run again.
    const runs = counter;
    const replay = await request(second.app).get("/paid/a").set("X-Payment", proof(done, doneTx));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(delivered.body);
    expect(counter).toBe(runs);

    // 2. A payment made after the backup for a challenge the backup knows is found on chain and delivered without a second charge.
    const balance = (await vault.account(ownerAddr)).balance;
    expect((await second.mw.reconcile({ lookbackBlocks: 500 })).recovered).toBe(1);
    expect(second.mw.store.get(open.requestId)).toMatchObject({ state: "PAID_CONFIRMED", txHash: openTx.toLowerCase() });
    expect((await request(second.app).get("/paid/a").set("X-Payment", proof(open, openTx))).status).toBe(200);
    expect(counter).toBe(runs + 1); // its stored response was lost with the database, so the handler ran again: handlers must be idempotent
    expect((await vault.account(ownerAddr)).balance).toBe(balance);

    // 3. The limit: a challenge issued after the backup is unknown to the restored database. It is refused, not delivered, and the
    //    payment stays on chain for the operator to settle by hand. This is the data-loss window of a backup.
    const lost = await request(second.app).get("/paid/a").set("X-Payment", proof(late, lateTx));
    expect(lost.status).toBe(402);
    expect(lost.body.reason).toBe("unknown_request");
    expect(await vault.isUsed(merchant, late.requestId)).toBe(true);
    second.mw.close();
  });

  it("TEST-EXP-1 payment deadline is expiry + grace on chain time; redeeming an in-time payment has no deadline", async () => {
    const { app, mw } = makeApp({ ...cfg(), challengeTtlSeconds: 5, paymentGraceSeconds: 60 });
    const c = await challenge(app);
    expect(c.paymentDeadline).toBe(c.expiresAt + 60);
    expect(c.protocol).toBe("turnspike/1");
    await provider.send("evm_increaseTime", [30]); await mine(1); // past expiry, inside grace
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    await provider.send("evm_increaseTime", [3600]); await mine(1); // the proof arrives an hour later
    const r = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c.requestId, txHash, sig: c.sig }));
    expect(r.status).toBe(200);
    const c2 = await challenge(app);
    await provider.send("evm_increaseTime", [120]); await mine(1); // past expiry + grace
    const late = await pay(vault, merchant, c2.requestId, 1000n);
    const r2 = await request(app).get("/paid/a").set("X-Payment", b64({ requestId: c2.requestId, txHash: late, sig: c2.sig }));
    expect(r2.body.reason).toBe("paid_too_late");
    mw.close();
  });

  it("TEST-LEASE-1 a handler slower than the lease keeps it by renewal; a second redemption meanwhile never runs it again", async () => {
    const m = makeApp({ ...cfg(), deliveryLeaseSeconds: 2, prices: { "/slow": 1000 } });
    let runs = 0;
    m.app.get("/paid/slow", async (_q, r) => { runs++; await new Promise((x) => setTimeout(x, 5000)); r.json({ runs }); });
    const c = await challenge(m.app, "/paid/slow");
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const hdr = b64({ requestId: c.requestId, txHash, sig: c.sig });
    const first = request(m.app).get("/paid/slow").set("X-Payment", hdr).then((r) => r);
    await new Promise((x) => setTimeout(x, 3500)); // longer than the 2 s lease
    const second = await request(m.app).get("/paid/slow").set("X-Payment", hdr);
    expect(second.status).toBe(202);
    expect((await first).status).toBe(200);
    expect(runs).toBe(1);
    m.mw.close();
  }, 20_000);

  it("TEST-LEASE-2 fencing: a stale lease holder cannot complete, renew or release", async () => {
    const m = makeApp(cfg());
    const c = await challenge(m.app);
    m.mw.store.transition(c.requestId, ["ISSUED"], "PAID_CONFIRMED", { txHash: id("fence" + Date.now()) });
    const stale = m.mw.store.claimDelivery(c.requestId, 1)!;
    m.mw.store.db.prepare("UPDATE payments SET leaseUntil = 0 WHERE requestId=?").run(c.requestId); // the lease lapsed
    const fresh = m.mw.store.claimDelivery(c.requestId, 30)!;
    expect(fresh).not.toBe(stale);
    const resp = { status: 200, type: "text/plain", body: Buffer.from("x"), headers: {} };
    expect(m.mw.store.renewLease(c.requestId, stale, 30)).toBe(false);
    expect(m.mw.store.releaseDelivery(c.requestId, stale, "x")).toBe(false);
    expect(m.mw.store.completeDelivery(c.requestId, stale, resp)).toBe(false);
    expect(m.mw.store.completeDelivery(c.requestId, fresh, resp)).toBe(true);
    m.mw.close();
  });

  it("TEST-RESP-1 binary bodies, types and kept headers replay byte-exact; cookies are not stored; oversize is refused and retryable", async () => {
    const m = makeApp({ ...cfg(), maxResponseBytes: 4096, prices: { "/bin": 1000, "/big": 1000 } });
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    m.app.get("/paid/bin", (_q, r) => { r.setHeader("cache-control", "private, max-age=60"); r.setHeader("set-cookie", "s=1"); r.type("application/octet-stream").send(bytes); });
    let big = 10_000;
    m.app.get("/paid/big", (_q, r) => { r.write(Buffer.alloc(big)); r.end(); });
    const c = await challenge(m.app, "/paid/bin");
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const hdr = b64({ requestId: c.requestId, txHash, sig: c.sig });
    const parse = (res: any, cb: any) => { const d: Buffer[] = []; res.on("data", (x: Buffer) => d.push(x)); res.on("end", () => cb(null, Buffer.concat(d))); };
    const r1 = await request(m.app).get("/paid/bin").set("X-Payment", hdr).buffer(true).parse(parse);
    const r2 = await request(m.app).get("/paid/bin").set("X-Payment", hdr).buffer(true).parse(parse);
    expect(Buffer.compare(r1.body, bytes)).toBe(0);
    expect(Buffer.compare(r2.body, bytes)).toBe(0);
    expect(r2.headers["content-type"]).toBe("application/octet-stream");
    expect(r2.headers["cache-control"]).toBe("private, max-age=60");
    expect(r2.headers["set-cookie"]).toBeUndefined();
    expect(r2.headers["x-turnspike-replay"]).toBe("1");
    const c2 = await challenge(m.app, "/paid/big");
    const tx2 = await pay(vault, merchant, c2.requestId, 1000n);
    const h2 = b64({ requestId: c2.requestId, txHash: tx2, sig: c2.sig });
    expect((await request(m.app).get("/paid/big").set("X-Payment", h2)).status).toBe(500);
    expect(m.mw.store.get(c2.requestId)!.state).toBe("PAID_CONFIRMED");
    big = 100;
    expect((await request(m.app).get("/paid/big").set("X-Payment", h2)).status).toBe(200);
    m.mw.close();
  });

  it("TEST-BIND-1 invalid input is refused before any challenge; the query is part of the paid resource", async () => {
    const m = makeApp({ ...cfg(), prices: { "/q": { priceBase: 1000, validate: (req) => (/^[0-9]+$/.test(String(req.query.n ?? "")) ? null : "n_must_be_digits") } } });
    m.app.get("/paid/q", (q, r) => r.json({ n: q.query.n }));
    const bad = await request(m.app).get("/paid/q?n=abc");
    expect(bad.status).toBe(400); expect(bad.body).toEqual({ error: "invalid_request", reason: "n_must_be_digits" });
    expect(m.mw.store.db.prepare("SELECT COUNT(*) c FROM payments").get()).toEqual({ c: 0 });
    const c = await challenge(m.app, "/paid/q?n=1&z=2");
    expect(c.resourceId).toBe("/q?n=1&z=2");
    expect((await challenge(m.app, "/paid/q?z=2&n=1")).resourceId).toBe("/q?n=1&z=2"); // order-independent
    const txHash = await pay(vault, merchant, c.requestId, 1000n);
    const hdr = b64({ requestId: c.requestId, txHash, sig: c.sig });
    expect((await request(m.app).get("/paid/q?n=2&z=2").set("X-Payment", hdr)).status).toBe(403);
    expect((await request(m.app).get("/paid/q?n=1&z=2").set("X-Payment", hdr)).body).toEqual({ n: "1" });
    m.mw.close();
  });

  it("TEST-S01 HMAC secret rotation: previous secret still verifies, unknown does not", () => {
    const f = { nonce: id("n"), merchant: "0x" + "11".repeat(20), resourceId: "/a", priceBase: "1000", chainId: 1, contract: "0x" + "22".repeat(20), expiresAt: 9 };
    const rid = computeRequestId({ ...f, merchant: ethers.getAddress(f.merchant), contract: ethers.getAddress(f.contract) });
    const sig = sign("old".repeat(15), rid, f);
    expect(verifySig(["new".repeat(15), "old".repeat(15)], rid, f, sig)).toBe(true);
    expect(verifySig(["new".repeat(15)], rid, f, sig)).toBe(false);
  });
});
