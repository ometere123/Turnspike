// The built Worker in workerd against a local chain. Real transactions, real receipts, real storage on disk; test tokens only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { ADMIN, CHAIN, SECRET, kill, makeGateway, require, root, sleep, startChain, startRpc } from "./support.mjs";

let c, a, b, g;
const OTHER = "0x" + "ab".repeat(32);
const paid = async (path = "/v1/block-summary", amount = 1000n) => { const ch = await g.challenge(path); return { ch, tx: await c.pay(ch.requestId, amount) }; };
const redeem = (p, path = "/v1/block-summary", over) => g.get(path, g.proof(p.ch, p.tx, over));
const status = async (id) => (await g.get(`/v1/payments/${id}`)).json();

before(async () => {
  c = await startChain(8971);
  a = await startRpc(8972, c.url);
  b = await startRpc(8973, c.url);
  g = await makeGateway(c, [a, b], 8974).start();
}, { timeout: 120_000 });
after(() => { g?.close(); a?.server.close(); b?.server.close(); a?.server.closeAllConnections?.(); b?.server.closeAllConnections?.(); kill(c?.node); c?.provider.destroy(); });
beforeEach(() => { for (const r of [a, b]) Object.assign(r, { mode: "ok", hook: null, hold: null, calls: [] }); });

describe("protocol", () => {
  it("CF-01 the challenge is turnspike/1: same request id and signature as the Express gateway", async () => {
    const { computeRequestId } = require(join(root, "packages/middleware/dist/index.js"));
    const ch = await g.challenge("/v1/address/" + c.merchant);
    assert.equal(ch.protocol, "turnspike/1");
    assert.equal(ch.resourceId, "/address/" + c.merchant);
    assert.equal(ch.paymentDeadline - ch.expiresAt, 1_000_000_000);
    // The nonce is private to the ledger; read it from the operator's export and recompute both with the published package's code.
    const row = (await (await g.admin("/export")).json()).rows.find((r) => r.requestId === ch.requestId);
    assert.equal(computeRequestId(row).toLowerCase(), ch.requestId);
    const canonical = [ch.requestId, row.nonce, row.merchant.toLowerCase(), row.resourceId, row.priceBase, row.chainId, row.contract.toLowerCase(), row.expiresAt].join("|");
    assert.equal(createHmac("sha256", SECRET).update(canonical).digest("hex"), ch.sig);
  });

  it("CF-02 402, pay on chain, 200; the same proof replays the stored bytes and never charges or runs again", async () => {
    const before = await c.balance();
    const p = await paid();
    const first = await redeem(p);
    assert.equal(first.status, 200);
    const body = await first.text();
    assert.equal(JSON.parse(body).chainId, CHAIN);
    await c.mine(3);
    const again = await redeem(p);
    assert.equal(again.headers.get("x-turnspike-replay"), "1");
    assert.equal(await again.text(), body); // three blocks later the live answer would differ
    assert.equal(before - (await c.balance()), 1000n);
    assert.deepEqual((({ state, txHash }) => ({ state, txHash }))(await status(p.ch.requestId)), { state: "DELIVERED", txHash: p.tx });
  });

  it("CF-03 the published client SDK buys from this gateway unchanged: pays once, replays under the same key, refuses a high price", async () => {
    const { TurnspikeClient, MemoryJournal } = require(join(root, "packages/client/dist/index.js"));
    const make = (max) => new TurnspikeClient({
      signer: c.agent, owner: c.ownerAddress, confirmations: 1, journal: new MemoryJournal(),
      network: { name: "local", chainId: CHAIN, contract: c.vault.target, token: c.token.target, decimals: 6, rpcUrls: [c.url], explorer: "http://localhost" },
      policy: { payees: [{ origin: g.url, merchant: c.merchant }], maxPriceBase: max },
    });
    const before = await c.balance();
    const client = make(5000n);
    const r = await client.fetch(`${g.url}/v1/qusdc-activity/${c.ownerAddress}?blocks=500`, {}, { idempotencyKey: "k" });
    assert.ok(r.ok && r.kind === "paid", JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? String(v) : v)));
    assert.ok((await r.response.json()).incoming.count >= 1);
    const again = await client.fetch(`${g.url}/v1/qusdc-activity/${c.ownerAddress}?blocks=500`, {}, { idempotencyKey: "k" });
    assert.ok(again.ok && again.replayed);
    assert.equal(before - (await c.balance()), 2000n);
    const no = await make(500n).fetch(`${g.url}/v1/block-summary`);
    assert.equal(no.error, "price_above_max");
  });

  it("CF-04 invalid input is refused before any price; unknown routes and other methods are never charged", async () => {
    assert.equal((await g.get("/v1/address/0x12")).status, 400);
    assert.equal((await g.get(`/v1/qusdc-activity/${c.merchant}?blocks=99999999`)).status, 400);
    assert.equal((await g.get("/v1/nothing")).status, 404);
    assert.equal((await fetch(g.url + "/v1/block-summary", { method: "POST" })).status, 405);
  });
});

describe("proofs that must not work", () => {
  it("CF-05 bad signature, malformed, oversized, extra field, unknown request", async () => {
    const p = await paid();
    for (const [over, reason] of [[{ sig: "0".repeat(64) }, "bad_signature"], [{ sig: "zz" }, "malformed_proof"], [{ extra: 1 }, "malformed_proof"], [{ requestId: OTHER }, "unknown_request"]]) {
      const r = await redeem(p, undefined, over);
      assert.equal(r.status, 402); assert.equal((await r.json()).reason, reason);
    }
    assert.equal((await (await g.get("/v1/block-summary", { "x-payment": "A".repeat(3000) })).json()).reason, "malformed_proof");
    assert.equal((await redeem(p)).status, 200); // none of that used the payment up
  });

  it("CF-06 a proof for one resource is refused on another; a stored response is never shown without the signature", async () => {
    const p = await paid();
    assert.equal((await redeem(p)).status, 200);
    assert.equal((await redeem(p, "/v1/address/" + c.merchant)).status, 403);
    const r = await redeem(p, undefined, { sig: "1".repeat(64) });
    assert.equal(r.status, 402); assert.ok(!(await r.text()).includes("blockNumber"));
  });

  it("CF-07 wrong merchant, wrong amount, another vault, a reverted payment and an unrelated transaction are refused, and the right one still works", async () => {
    const wrong = async (pay, reason) => {
      const ch = await g.challenge();
      const r = await g.get("/v1/block-summary", g.proof(ch, await pay(ch)));
      assert.equal(r.status, 402, reason); assert.equal((await r.json()).reason, reason);
      return ch;
    };
    await wrong((ch) => c.pay(ch.requestId, 1000n, { to: c.merchant2 }), "wrong_merchant");
    const low = await wrong(async () => (await (await c.stranger.sendTransaction({ to: c.merchant, value: 1n })).wait()).hash, "no_matching_paid_log");
    await wrong((ch) => c.pay(ch.requestId, 1000n, { on: c.other }), "no_matching_paid_log");
    await wrong((ch) => c.pay(ch.requestId, 999n), "amount_below_price");
    const ok = await g.get("/v1/block-summary", g.proof(low, await c.pay(low.requestId)));
    assert.equal(ok.status, 200);
  });

  it("CF-08 one transaction backs one request; a different transaction for a paid request is a conflict", async () => {
    const p = await paid();
    assert.equal((await redeem(p)).status, 200);
    assert.equal((await g.get("/v1/block-summary", g.proof(p.ch, OTHER))).status, 409);
  });

  it("CF-09 the contract itself refuses an unlisted merchant, an over-cap payment, a reused id, a paused account and a revoked agent", async () => {
    const v = c.vault.connect(c.agent), id = (n) => "0x" + String(n).padStart(64, "0");
    const refused = (p, name) => assert.rejects(p, (e) => e.revert?.name === name || String(e.message).includes(name));
    await refused(v.pay.staticCall(c.ownerAddress, await c.stranger.getAddress(), id(1), 1000n), "MerchantNotAllowed");
    await refused(v.pay.staticCall(c.ownerAddress, c.merchant, id(2), 100_001n), "CapExceeded");
    const p = await paid();
    await refused(v.pay.staticCall(c.ownerAddress, c.merchant, p.ch.requestId, 1000n), "RequestAlreadyUsed");
    await (await c.vault.setPaused(true)).wait();
    await refused(v.pay.staticCall(c.ownerAddress, c.merchant, id(3), 1000n), "Paused");
    await (await c.vault.setPaused(false)).wait();
    await (await c.vault.revokeAgent()).wait();
    await refused(v.pay.staticCall(c.ownerAddress, c.merchant, id(4), 1000n), "NotOwnerAgent");
    await (await c.vault.setPolicy(await c.agent.getAddress(), 100_000n, 1_000_000n)).wait();
    assert.equal((await redeem(p)).status, 200); // a payment made before the pause is still honoured
  });
});

describe("concurrency", () => {
  it("CF-10 twelve simultaneous redemptions of one proof: the handler runs once and every answer is the same bytes", async () => {
    const p = await paid();
    let runs = 0;
    a.hold = b.hold = async (q) => { if (q.method === "eth_getBlockByNumber" && q.params[0] === "latest") { runs++; await sleep(300); } }; // only the handler asks for "latest"
    const rs = await Promise.all(Array.from({ length: 12 }, () => redeem(p)));
    const ok = [];
    for (const r of rs) { assert.ok([200, 202].includes(r.status), String(r.status)); if (r.status === 200) ok.push(await r.text()); }
    for (let i = 0; i < 12; i++) { const r = await redeem(p); assert.equal(r.status, 200); ok.push(await r.text()); }
    assert.equal(runs, 1);
    assert.equal(new Set(ok).size, 1);
    const rows = (await (await g.admin("/export")).json()).rows.filter((r) => r.requestId === p.ch.requestId);
    assert.equal(rows.length, 1);
  });

  it("CF-11 two requests presented at once with one transaction: exactly one can ever use it", async () => {
    const p = await paid();
    const q = await g.challenge();
    const [x, y] = await Promise.all([redeem(p), g.get("/v1/block-summary", g.proof(q, p.tx))]);
    assert.equal(x.status, 200);
    assert.equal(y.status, 402);
  });

  it("CF-12 sixty simultaneous challenges are sixty distinct, stored requests", async () => {
    const chs = await Promise.all(Array.from({ length: 60 }, () => g.challenge()));
    assert.equal(new Set(chs.map((x) => x.requestId)).size, 60);
    for (const x of chs.slice(0, 5)) assert.equal((await status(x.requestId)).state, "ISSUED");
  });
});

describe("chain trouble", () => {
  it("CF-13 an unmined transaction is pending, not refused, and then succeeds", async () => {
    const ch = await g.challenge();
    const r = await g.get("/v1/block-summary", g.proof(ch, OTHER));
    assert.equal(r.status, 202); assert.equal((await r.json()).why, "no_receipt");
    assert.equal((await g.get("/v1/block-summary", g.proof(ch, await c.pay(ch.requestId)))).status, 200);
  });

  it("CF-14 first RPC down, erroring, unreadable or on another chain: the second answers", async () => {
    for (const mode of ["down", "error", "garbage", "wrongchain"]) {
      const p = await paid();
      a.mode = mode;
      assert.equal((await redeem(p)).status, 200, mode);
      a.mode = "ok";
    }
  });

  it("CF-15 every RPC down or on another chain: 503, nothing marked paid or refused, and the proof works afterwards", async () => {
    for (const mode of ["down", "wrongchain"]) {
      const p = await paid();
      a.mode = b.mode = mode;
      const r = await redeem(p);
      assert.equal(r.status, 503); assert.equal((await r.json()).error, "rpc_unavailable");
      assert.ok(["ISSUED", "PAID_PENDING"].includes((await status(p.ch.requestId)).state));
      a.mode = b.mode = "ok";
      assert.equal((await redeem(p)).status, 200);
    }
  });

  it("CF-16 a hanging RPC times out and fails over", { timeout: 60_000 }, async () => {
    const g2 = await makeGateway(c, [a, b], 8981, { LEASE_SECONDS: "40" }).start();
    try {
      const ch = await g2.challenge();
      const tx = await c.pay(ch.requestId);
      a.mode = "hang";
      assert.equal((await g2.get("/v1/block-summary", g2.proof(ch, tx))).status, 200);
    } finally { g2.close(); }
  });

  it("CF-17 a lagging head, a replaced block and a removed log never deliver", async () => {
    const p = await paid();
    const real = async (h) => Number(BigInt(h));
    a.hook = async (q, r) => (q.method === "eth_blockNumber" ? "0x" + ((await real(r)) - 5).toString(16) : r);
    assert.equal((await (await redeem(p)).json()).why, "behind");
    a.hook = (q, r) => (q.method === "eth_getBlockByNumber" ? { ...r, hash: OTHER } : r);
    assert.equal((await (await redeem(p)).json()).why, "reorg");
    a.hook = (q, r) => (q.method === "eth_getTransactionReceipt" ? { ...r, status: "0x0", blockHash: OTHER } : r);
    assert.equal((await (await redeem(p)).json()).why, "reorg"); // even a "reverted" receipt proves nothing off the canonical chain
    a.hook = (q, r) => (q.method === "eth_getTransactionReceipt" ? { ...r, logs: r.logs.map((l) => ({ ...l, removed: true })) } : r);
    assert.equal((await (await redeem(p)).json()).reason, "no_matching_paid_log");
    a.hook = null;
    assert.equal((await redeem(p)).status, 200);
  });

  it("CF-18 a payment mined after its deadline is recorded, refused, counted and never deliverable", async () => {
    const g2 = await makeGateway(c, [a, b], 8975, { PAYMENT_GRACE_SECONDS: "0", CHALLENGE_TTL_SECONDS: "30" }).start();
    try {
      const ch = await g2.challenge();
      const head = await c.provider.getBlock("latest");
      await c.provider.send("evm_setNextBlockTimestamp", [Math.max(head.timestamp, ch.expiresAt) + 600]);
      const tx = await c.pay(ch.requestId);
      const r = await g2.get("/v1/block-summary", g2.proof(ch, tx));
      assert.equal(r.status, 402); assert.equal((await r.json()).reason, "paid_too_late");
      assert.equal((await (await g2.get(`/v1/payments/${ch.requestId}`)).json()).state, "REJECTED");
      assert.equal((await (await g2.get("/v1/stats")).json()).paidUndelivered24h, 1);
      assert.equal((await (await g2.get("/v1/block-summary", g2.proof(ch, tx))).json()).reason, "rejected");
    } finally { g2.close(); }
  });
});

describe("crash, outage and recovery", () => {
  it("CF-19 killed mid-delivery: the lease is held, then lapses, and the same proof delivers once without a second charge", { timeout: 60_000 }, async () => {
    const p = await paid();
    const before = await c.balance();
    let reached;
    const inHandler = new Promise((r) => { reached = r; });
    const verified = { n: 0 };
    a.hold = b.hold = async (q) => { if (q.method === "eth_getBlockByNumber" && q.params[0] === "latest") { verified.n++; reached(); return "drop"; } };
    const lost = redeem(p).catch(() => "gone");
    await inHandler;
    g.crash();
    assert.notEqual((await lost)?.status, 200);
    a.hold = b.hold = null;
    await g.start();
    assert.equal((await status(p.ch.requestId)).state, "DELIVERING");
    const early = await redeem(p);
    assert.equal(early.status, 202); assert.equal((await early.json()).why, "delivering");
    await sleep(12_500);
    assert.equal((await redeem(p)).status, 200);
    assert.equal((await redeem(p)).headers.get("x-turnspike-replay"), "1");
    assert.equal(await c.balance(), before);
  });

  it("CF-20 killed after storing the response but before sending it: the stored response is served after restart", async () => {
    const p = await paid();
    const body = await (await redeem(p)).text();
    await g.restart();
    const r = await redeem(p);
    assert.equal(r.headers.get("x-turnspike-replay"), "1"); assert.equal(await r.text(), body);
  });

  it("CF-21 paid while the gateway was down and no proof presented: reconcile finds it, and the proof still redeems", async () => {
    const ch = await g.challenge();
    g.crash();
    const tx = await c.pay(ch.requestId);
    await c.mine(2);
    await g.start();
    const r = await g.reconcile();
    assert.equal(r.recovered, 1);
    assert.deepEqual((({ state, txHash }) => ({ state, txHash }))(await status(ch.requestId)), { state: "PAID_CONFIRMED", txHash: tx });
    assert.equal((await g.get("/v1/block-summary", g.proof(ch, tx))).status, 200);
    assert.equal((await g.reconcile()).recovered, 0); // running it again changes nothing
  });

  it("CF-22 an RPC failure during reconcile does not move the mark: the next run finds the payment", async () => {
    const ch = await g.challenge();
    const tx = await c.pay(ch.requestId);
    await c.mine(1);
    a.hook = b.hook = (q, r) => (q.method === "eth_getTransactionReceipt" ? null : r); // logs are visible, receipts are not yet
    assert.equal((await g.reconcile()).undecided, 1);
    a.hook = b.hook = null;
    assert.equal((await g.reconcile()).recovered, 1);
    assert.equal((await g.get("/v1/block-summary", g.proof(ch, tx))).status, 200);
  });

  it("CF-23 a failing handler leaves the payment redeemable; the same proof delivers later", async () => {
    const p = await paid();
    a.hold = b.hold = null;
    let fail = true;
    a.hook = b.hook = (q, r) => (fail && q.method === "eth_getBlockByNumber" && q.params[0] === "latest" ? null : r);
    const r = await redeem(p);
    assert.equal(r.status, 503); assert.equal((await r.json()).error, "delivery_failed");
    assert.equal((await status(p.ch.requestId)).state, "PAID_CONFIRMED");
    fail = false;
    assert.equal((await redeem(p)).status, 200);
  });

  it("CF-24 lost database: a paid request with no record is PAID_UNRECORDED and 503, never 'unpaid'; the operator sees it counted", async () => {
    const p = await paid();
    await c.mine(1);
    const g2 = await makeGateway(c, [a, b], 8976).start(); // a new, empty ledger for the same merchant
    try {
      assert.equal((await (await g2.get(`/v1/payments/${p.ch.requestId}`)).json()).state, "PAID_UNRECORDED");
      const r = await g2.get("/v1/block-summary", g2.proof(p.ch, p.tx));
      assert.equal(r.status, 503); assert.equal((await r.json()).error, "payment_unrecorded");
      await g2.reconcile();
      const s = await (await g2.get("/v1/stats")).json();
      assert.ok(s.paidUnrecorded >= 1); assert.equal(s.delivered, 0);
      assert.equal((await (await g2.get(`/v1/payments/${p.ch.requestId}`)).json()).txHash, p.tx);
      a.mode = b.mode = "down"; // cannot ask the chain: still not "unpaid"
      assert.equal((await g2.get(`/v1/payments/${"0x" + "cd".repeat(32)}`)).status, 503);
    } finally { g2.close(); }
  });

  it("CF-25 backup and restore: export, total loss, import. Delivered responses replay, paid ones redeem, tampered or foreign rows are refused whole", async () => {
    const done = await paid(), open = await paid();
    const body = await (await redeem(done)).text();
    const rows = [];
    for (let after = "", more = true; more;) { const page = await (await g.admin("/export?after=" + after)).json(); rows.push(...page.rows); more = !!page.next; after = page.next ?? ""; }
    const g2 = await makeGateway(c, [a, b], 8977).start();
    const send = (rs) => g2.admin("/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: rs }) });
    try {
      const i = rows.findIndex((r) => r.requestId === done.ch.requestId);
      for (const bad of [{ priceBase: "1" }, { merchant: c.merchant2 }, { state: "FREE" }, { response: null }]) {
        const r = await send([rows[0], { ...rows[i], ...bad }]);
        assert.equal(r.status, 409);
      }
      assert.equal((await (await g2.admin("/export")).json()).rows.length, 0); // all or nothing
      assert.deepEqual(await (await send(rows)).json(), { imported: rows.length, same: 0, advanced: 0, kept: 0 });
      assert.deepEqual(await (await send(rows)).json(), { imported: 0, same: rows.length, advanced: 0, kept: 0 });
      const replay = await g2.get("/v1/block-summary", g2.proof(done.ch, done.tx));
      assert.equal(replay.headers.get("x-turnspike-replay"), "1"); assert.equal(await replay.text(), body);
      assert.equal((await g2.get("/v1/block-summary", g2.proof(open.ch, open.tx))).status, 200);
    } finally { g2.close(); }
  });

  it("CF-26 a row from the earlier SQLite gateway imports, and its proof redeems here when its HMAC secret is the previous secret", async () => {
    const { turnspike } = require(join(root, "packages/middleware/dist/index.js"));
    const express = require("express");
    const old = "old-gateway-secret-".repeat(3);
    const mw = turnspike({ rpcUrls: [c.url], chainId: CHAIN, contract: c.vault.target, token: c.token.target, merchant: c.merchant, hmacSecrets: [old], dbPath: join(mkdtempSync(join(tmpdir(), "old-")), "o.sqlite"), confirmations: 1, paymentGraceSeconds: 10 ** 9, onEvent: () => {}, prices: { "/block-summary": { resourceId: "block-summary", priceBase: 1000 } } });
    const app = express(); app.use("/v1", mw); app.get("/v1/block-summary", (_q, r) => r.json({ old: true }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const base = `http://127.0.0.1:${srv.address().port}/v1/block-summary`;
    const ch = await (await fetch(base)).json();
    const tx = await c.pay(ch.requestId);
    const delivered = await (await fetch(base, { headers: g.proof(ch, tx) })).text();
    const copy = join(mkdtempSync(join(tmpdir(), "old-")), "backup.sqlite");
    await mw.store.db.backup(copy);
    const out = spawnSync(process.execPath, [join(root, "apps/gateway-cf/scripts/export-sqlite.mjs"), copy], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const { rows: [row] } = JSON.parse(out.stdout);
    srv.close(); mw.close();
    const res = await g.admin("/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: [row] }) });
    assert.equal((await res.json()).imported, 1);
    assert.equal((await (await g.get("/v1/block-summary", g.proof(ch, tx))).json()).reason, "bad_signature"); // without the old secret, the record is kept but not redeemable
    await g.restart({ HMAC_SECRET_PREVIOUS: old });
    const again = await g.get("/v1/block-summary", g.proof(ch, tx));
    assert.equal(again.status, 200); assert.equal(await again.text(), delivered);
  });
});

describe("limits and operations", () => {
  it("CF-27 payments disabled: no quote is ever issued, and what was paid earlier stays redeemable", async () => {
    const p = await paid();
    await g.restart({ PAYMENTS_ENABLED: "false" });
    const r = await g.get("/v1/block-summary");
    assert.equal(r.status, 503); assert.equal((await r.json()).error, "payments_disabled");
    assert.equal((await redeem(p)).status, 200);
    await g.restart({ PAYMENTS_ENABLED: "true" });
  });

  it("CF-28 a caller is rate limited and the daily quote budget holds, without touching paid requests", async () => {
    const g2 = await makeGateway(c, [a, b], 8978, { CHALLENGES_PER_DAY: "3", RATE_LIMIT_PER_MINUTE: "100" }).start();
    const g3 = await makeGateway(c, [a, b], 8979, { RATE_LIMIT_PER_MINUTE: "2" }).start();
    try {
      const chs = [await g2.challenge(), await g2.challenge(), await g2.challenge()];
      const no = await g2.get("/v1/block-summary");
      assert.equal(no.status, 503); assert.equal((await no.json()).error, "challenge_budget_exhausted");
      await g2.restart();
      assert.equal((await g2.get("/v1/block-summary")).status, 503); // the budget survives a restart
      assert.equal((await g2.get("/v1/block-summary", g2.proof(chs[0], await c.pay(chs[0].requestId)))).status, 200);
      await g3.challenge(); await g3.challenge();
      assert.equal((await g3.get("/v1/block-summary")).status, 429);
    } finally { g2.close(); g3.close(); }
  });

  it("CF-29 health, readiness, configuration, statistics and history are honest", async () => {
    assert.deepEqual(await (await g.get("/healthz")).json(), { ok: true });
    assert.equal((await (await g.get("/readyz")).json()).ok, true);
    a.mode = b.mode = "down";
    const r = await g.get("/readyz");
    assert.equal(r.status, 503); assert.equal((await r.json()).rpc, false);
    a.mode = b.mode = "ok";
    assert.equal((await (await g.get("/v1/config")).json()).contract, c.vault.target);
    const h = await (await g.get("/v1/history?limit=5")).json();
    assert.ok(h.payments.length > 0 && h.payments.every((p) => p.txHash && !("sig" in p) && !("nonce" in p)));
  });

  it("CF-30 admin is absent without the token; CORS answers only listed origins; errors reveal nothing", async () => {
    assert.equal((await g.get("/admin/export")).status, 404);
    assert.equal((await g.get("/admin/export", { authorization: "Bearer " + ADMIN + "x" })).status, 404);
    assert.equal((await g.get("/healthz", { origin: "https://evil.example" })).headers.get("access-control-allow-origin"), null);
    assert.equal((await g.get("/healthz", { origin: "https://turnspike-qie.vercel.app" })).headers.get("access-control-allow-origin"), "https://turnspike-qie.vercel.app");
    const g2 = await makeGateway(c, [a, b], 8980, { CONTRACT: "nope" }).start();
    try { const r = await g2.get("/healthz"); assert.equal(r.status, 500); assert.deepEqual(await r.json(), { error: "misconfigured" }); } finally { g2.close(); }
  });
});
