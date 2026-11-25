// The built Worker in workerd, a local chain, the real contract, a labelled mock token.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { after, before, it } from "node:test";
import { Miniflare } from "miniflare";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { kill, startChain } from "../../gateway-cf/test/support.mjs";

let c, mf, url, api, hits = 0, code = 402;
const rpcPort = 8991;
before(async () => {
  c = await startChain(rpcPort);
  api = createServer((q, r) => {
    if (q.url === "/evil") { hits++; return r.end("x"); }
    if (q.url === "/redirect") { r.writeHead(302, { location: "/evil" }); return r.end(); }
    r.writeHead(code, { "content-type": "application/json" });
    r.end(JSON.stringify({ error: "payment_required", requestId: "0x" + "11".repeat(32), sig: "22".repeat(32), priceBase: "1000", token: c.token.target, contract: c.vault.target, merchant: c.merchant, chainId: 31337, resourceId: "x", expiresAt: Math.floor(Date.now() / 1000) + 300 }));
  });
  await new Promise((r) => api.listen(8992, "127.0.0.1", r));
  mf = new Miniflare({ modules: [{ type: "ESModule", path: "index.js", contents: readFileSync(new URL("../dist/index.js", import.meta.url), "utf8") }], compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"],
    bindings: { GATEWAY: "http://127.0.0.1:8992", MERCHANT: c.merchant, RPC_URLS: `http://127.0.0.1:9,${c.url}`, CHAIN_ID: "31337", CONTRACT: c.vault.target, TOKEN: c.token.target } });
  url = new URL("/mcp", await mf.ready);
}, { timeout: 120_000 });
after(async () => { await mf?.dispose(); api?.close(); kill(c?.node); c?.provider.destroy(); });

for (const modern of [false, true]) it(`read-only tools work over HTTP (${modern ? "2026-07-28" : "2025"} protocol)`, { timeout: 60_000 }, async () => {
  const s = new Client({ name: "t", version: "1" }, modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
  await s.connect(new StreamableHTTPClientTransport(url));
  const call = async (name, args) => { const r = await s.callTool({ name, arguments: args }); return { e: !!r.isError, text: r.content[0].text }; };
  assert.deepEqual((await s.listTools()).tools.map((t) => t.name).sort(), ["turnspike_account", "turnspike_probe", "turnspike_verify"]);
  assert.equal(JSON.parse((await call("turnspike_account", { owner: c.ownerAddress })).text).perCallCap, "0.1"); // the first RPC is down
  const p = await call("turnspike_probe", { url: "http://127.0.0.1:8992/v1/data" });
  assert.equal(JSON.parse(p.text).price, "0.001", p.text);
  assert.ok(!p.text.includes("22".repeat(32)));
  const tx = await c.pay("0x" + (modern ? "aa" : "bb").repeat(32));
  assert.equal(JSON.parse((await call("turnspike_verify", { tx_hash: tx })).text).isTurnspikePayment, true);
  for (const u of ["https://example.com/", "http://127.0.0.1:8991/", "http://169.254.169.254/", "http://127.0.0.1:8992/redirect"]) assert.equal((await call("turnspike_probe", { url: u })).e, true, u);
  assert.equal(hits, 0);
  const pay = await s.callTool({ name: "turnspike_pay", arguments: { url: "http://127.0.0.1:8992/v1/data", purchase_key: "abcdefgh" } }).catch(() => ({ isError: true }));
  assert.equal(pay.isError, true);
  await s.close();
});

it("large bodies, batches and unknown paths are refused; health says payments are off", async () => {
  const post = (body) => mf.dispatchFetch(url, { method: "POST", body, headers: { "content-type": "application/json", accept: "application/json, text/event-stream" } });
  assert.equal((await post("[" + "1".repeat(9000) + "]")).status, 413);
  assert.equal((await post("[]")).status, 400);
  assert.equal((await post("{")).status, 400);
  assert.equal((await mf.dispatchFetch(new URL("/x", url))).status, 404);
  assert.deepEqual(await (await mf.dispatchFetch(new URL("/healthz", url))).json(), { ok: true, payments: false });
});

it("the Worker bundle contains no signer", () => {
  const b = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
  for (const s of ["fromEncryptedJson", "TurnspikeClient", "class Payer", "KEYSTORE_PASSWORD"]) assert.ok(!b.includes(s), s);
});
