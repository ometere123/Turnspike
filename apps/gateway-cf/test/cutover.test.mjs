// The whole Fly to Cloudflare cutover and its rollback, rehearsed: the real Express gateway on its own SQLite file, the built Worker
// in workerd, one local chain, test tokens. Two copies, as in production: one early, one at the switch.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { CHAIN, SECRET, kill, makeGateway, require, root, sleep, startChain, startRpc } from "./support.mjs";

const OLD = "old-express-secret-".repeat(3), PORT = 8983, EX = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "cutover-")), db = join(dir, "fly.sqlite"), out = join(dir, "gw");
let c, rpc, g, ex;

const startExpress = async () => {
  ex = spawn(process.execPath, [join(out, "apps/gateway/src/server.js")], {
    cwd: root, detached: process.platform !== "win32", stdio: "ignore",
    env: { ...process.env, NODE_PATH: join(root, "node_modules"), PORT: String(PORT), RPC_URL_1: rpc.url, CHAIN_ID: String(CHAIN), QUSDC_ADDRESS: c.token.target, ALLOWANCE_ADDRESS: c.vault.target, MERCHANT_ADDRESS: c.merchant, HMAC_SECRET: OLD, DB_PATH: db, CONFIRMATIONS: "1", RECONCILE: "false", DEMO_ENABLED: "false", TURNSPIKE_LOG: "off" },
  });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(EX + "/healthz")).ok) return; } catch { /* not yet */ } await sleep(300); }
  throw new Error("express gateway did not start");
};
const quote = async (base = EX) => { const r = await fetch(base + "/v1/block-summary"); assert.equal(r.status, 402); return r.json(); };
const buy = async (ch) => ({ ch, tx: await c.pay(ch.requestId) });
const redeem = (base, p) => fetch(base + "/v1/block-summary", { headers: g.proof(p.ch, p.tx) });
const copy = async (name) => {
  const Database = require("better-sqlite3"), file = join(dir, name);
  const d = new Database(db, { readonly: true }); await d.backup(file); d.close();
  const r = spawnSync(process.execPath, [join(root, "apps/gateway-cf/scripts/export-sqlite.mjs"), file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).rows;
};
const send = async (rows) => { const r = await g.admin("/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }) }); return { status: r.status, body: await r.json() }; };
const state = async (p) => (await (await g.get(`/v1/payments/${p.ch.requestId}`)).json()).state;
const stats = async () => (await g.get("/v1/stats")).json();

before(async () => {
  const t = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json", "--outDir", out], { cwd: root, encoding: "utf8" });
  assert.equal(t.status, 0, t.stdout);
  c = await startChain(8981);
  rpc = await startRpc(8982, c.url);
  await startExpress();
  g = await makeGateway(c, [rpc], 8984, { PAYMENTS_ENABLED: "false", HMAC_SECRET: SECRET }).start();
}, { timeout: 180_000 });
after(() => { kill(ex); g?.close(); rpc?.server.close(); rpc?.server.closeAllConnections?.(); kill(c?.node); c?.provider.destroy(); });

it("CUT-01 the cutover loses no payment, charges nobody twice, and rolls back", { timeout: 180_000 }, async () => {
  // Before: one delivered, one paid and not yet collected, one open quote that will be paid after the first copy.
  const done = await buy(await quote());
  const body = await (await redeem(EX, done)).text();
  const uncollected = await buy(await quote());
  const openQuote = await quote();
  assert.deepEqual((await send(await copy("first.sqlite"))).body, { imported: 3, same: 0, advanced: 0, kept: 0 });

  // Between the copies the old gateway keeps selling.
  const between = await buy(openQuote);
  const betweenBody = await (await redeem(EX, between)).text();
  const fresh = await buy(await quote());
  const freshBody = await (await redeem(EX, fresh)).text();
  await g.reconcile();
  assert.equal(await state(fresh), "PAID_UNRECORDED"); // unknown here, and never called unpaid
  assert.equal((await stats()).paidUnrecorded, 1);
  assert.equal((await g.get("/v1/block-summary")).status, 503); // still closed: no quote is issued

  // The switch: the old gateway stops, and a second copy knows more than the first.
  kill(ex);
  await sleep(500);
  const second = await copy("second.sqlite");
  const r2 = await send(second);
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(r2.body.imported, 1); assert.equal(r2.body.advanced, 1); // the fresh one, and the quote paid in between
  assert.equal((await send(second)).body.advanced, 0); // repeating it changes nothing
  assert.equal((await g.reconcile()).complete, true);
  assert.equal((await stats()).paidUnrecorded, 0);

  // Old proofs need the old secret; then every one is honoured here, byte for byte, without another charge.
  assert.equal((await (await redeem(g.url, done)).json()).reason, "bad_signature");
  await g.restart({ HMAC_SECRET_PREVIOUS: OLD });
  const balance = await c.balance();
  for (const [p, want] of [[done, body], [between, betweenBody], [fresh, freshBody]]) {
    const r = await redeem(g.url, p);
    assert.equal(r.status, 200); assert.equal(await r.text(), want);
  }
  assert.equal((await redeem(g.url, uncollected)).status, 200);
  assert.equal(await c.balance(), balance);

  // Open for business.
  await g.restart({ PAYMENTS_ENABLED: "true" });
  const sold = await buy(await quote(g.url));
  const soldBody = await (await redeem(g.url, sold)).text();
  assert.equal((await stats()).delivered, 5);

  // Roll back: the Worker stops selling and keeps what it sold; the old gateway resumes.
  await g.restart({ PAYMENTS_ENABLED: "false" });
  await startExpress();
  assert.equal((await g.get("/v1/block-summary")).status, 503);
  assert.equal(await (await redeem(g.url, sold)).text(), soldBody);
  assert.equal(await (await redeem(EX, done)).text(), body);
  assert.notEqual((await redeem(EX, sold)).status, 200); // the old gateway never issued it: collect it from the Worker
  const last = await buy(await quote());
  assert.equal((await redeem(EX, last)).status, 200);
});

it("CUT-02 a later copy never moves a record back, to another transaction, or over a refusal", { timeout: 60_000 }, async () => {
  const delivered = (await copy("third.sqlite")).find((r) => r.state === "DELIVERED");
  const before = await stats();
  await send([delivered]); // the sale made after the rollback may not be here yet
  assert.equal((await send([{ ...delivered, state: "ISSUED", txHash: null, response: null }])).body.kept, 1);
  for (const bad of [{ txHash: "0x" + "cd".repeat(32) }, { state: "REJECTED", response: null }]) assert.equal((await send([{ ...delivered, ...bad }])).status, 409);
  assert.ok((await stats()).delivered >= before.delivered);
});
