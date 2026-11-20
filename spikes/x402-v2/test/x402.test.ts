import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ContractFactory, HDNodeWallet, Interface, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { Store } from "../../../packages/middleware/src/store";
import type { Network } from "../../../packages/client/src";
import { SCHEME, callCtx, caip2, unb64 } from "../src/common";
import { TurnspikeAllowanceClient } from "../src/client-scheme";
import { TurnspikeAllowanceFacilitator } from "../src/facilitator-scheme";
import { startFacilitator } from "../src/facilitator-server";
import { startResourceServer } from "../src/resource-server";

// Local Hardhat chain (31337), the REAL TurnpikeAllowance, the repo's labelled MockERC20 test double. Nothing touches mainnet.
const PORT = 8651;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN = 31337;
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
const ROOT = resolve(__dirname, "../../..");
const art = (p: string) => JSON.parse(readFileSync(join(ROOT, "artifacts/contracts", p), "utf8"));
const EVID = resolve(__dirname, "../evidence");
const evidence: Record<string, unknown> = {};

let node: ChildProcess;
let provider: JsonRpcProvider;
let token: ethers.Contract, vault: ethers.Contract;
let network: Network;
let agent: HDNodeWallet;
let merchant: string, rogue: string, otherToken: string;
const owners: Record<string, NonceManager> = {};
const store = new Store(join(mkdtempSync(join(tmpdir(), "x402s-")), "s.sqlite"));
const handler = { n: 0 };
let fac: Awaited<ReturnType<typeof startFacilitator>>;
let facilitatorImpl: TurnspikeAllowanceFacilitator;
let rs: Awaited<ReturnType<typeof startResourceServer>>;
const SECRET = "x".repeat(40);
const PAID = new Interface(["event Paid(address indexed owner, address indexed agent, address indexed merchant, bytes32 requestId, uint256 amount)"]);

const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const bal = async (k: string) => (await vault.account(await owners[k].getAddress())).balance as bigint;
async function paidLogs(fromBlock = 0) {
  const logs = await provider.getLogs({ address: vault.target as string, topics: [PAID.getEvent("Paid")!.topicHash], fromBlock });
  return logs.map((l) => ({ tx: l.transactionHash, block: l.blockNumber, ...PAID.parseLog({ topics: [...l.topics], data: l.data })!.args.toObject() }));
}

/** x402 client with the registered turnspike-allowance scheme for the given owner. Records every outgoing request. */
function mkClient(ownerKey = "main", over: Record<string, any> = {}) {
  const scheme = new TurnspikeAllowanceClient({
    signer: agent, owner: (owners[ownerKey] as any).signer.address, network,
    policy: { payees: [{ origin: rs.base, merchant }, { origin: rs.base, merchant: rogue }], maxPriceBase: 10_000n }, confirmations: 1, txTimeoutMs: 15_000, redeemTimeoutMs: 15_000, ...over,
  });
  const x = new x402Client();
  x.register(caip2(CHAIN) as any, scheme);
  x.register("eip155:1990" as any, scheme); // so a mainnet-id challenge reaches the policy check instead of being skipped by x402
  // x402Client default spend controls reject any asset it has no default-asset entry for: a non-default token must be opted in.
  x.setSpendControls({ allowedAssets: [{ network: caip2(CHAIN) as any, asset: network.token, maxAmountPerPayment: "1000000" }, { network: "eip155:1990" as any, asset: network.token, maxAmountPerPayment: "1000000" }, { network: caip2(CHAIN) as any, asset: otherToken, maxAmountPerPayment: "1000000" }] });
  const sent: { url: string; headers: Record<string, string> }[] = [];
  const spy: typeof fetch = async (input, init) => {
    const h: Record<string, string> = {};
    new Headers((init?.headers ?? (input instanceof Request ? input.headers : undefined)) as any).forEach((v, k) => (h[k] = v));
    sent.push({ url: String(input), headers: h });
    return fetch(input as any, init);
  };
  const f = wrapFetchWithPayment(spy, x);
  const pay = (url: string, init: RequestInit = {}, purchaseKey?: string) => callCtx.run({ url, init, purchaseKey }, () => f(url, init));
  return { pay, sent, scheme };
}
const rawChallenge = async (url: string) => {
  const r = await fetch(url);
  const hdr = r.headers.get("payment-required");
  return { status: r.status, hdr, required: hdr ? unb64(hdr) : null };
};

beforeAll(async () => {
  node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: ROOT, shell: true, stdio: "ignore" });
  provider = new JsonRpcProvider(RPC, CHAIN, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; i < 120; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const deployer = new NonceManager(w(0));
  const mock = art("test-helpers/MockERC20.sol/MockERC20.json");
  token = (await (await new ContractFactory(mock.abi, mock.bytecode, deployer).deploy()).waitForDeployment()) as any;
  otherToken = (await (await (await new ContractFactory(mock.abi, mock.bytecode, deployer).deploy()).waitForDeployment()).getAddress());
  const va = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  vault = (await (await new ContractFactory(va.abi, va.bytecode, deployer).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment()) as any;
  network = { name: "local", chainId: CHAIN, contract: vault.target as string, token: token.target as string, decimals: 6, rpcUrls: [RPC], explorer: "http://explorer.local" };
  agent = w(1); // plain wallet: the client pins nonces itself
  merchant = w(2).address; rogue = w(3).address;
  for (const [k, i, mode] of [["main", 4, ""], ["paused", 6, "pause"], ["revoked", 7, "revoke"], ["unlisted", 8, "nolist"]] as const) {
    const o = new NonceManager(w(i));
    owners[k] = o;
    const v = vault.connect(o) as any;
    await (await (token.connect(deployer) as any).mint(await o.getAddress(), 10_000_000n)).wait();
    await (await (token.connect(o) as any).approve(vault.target, 10n ** 12n)).wait();
    await (await v.deposit(2_000_000n)).wait();
    await (await v.setPolicy(await agent.getAddress(), 50_000n, 200_000n)).wait();
    if (mode !== "nolist") await (await v.setMerchant(merchant, true)).wait();
    if (mode === "pause") await (await v.setPaused(true)).wait();
    if (mode === "revoke") await (await v.revokeAgent()).wait();
  }
  facilitatorImpl = new TurnspikeAllowanceFacilitator({ chainId: CHAIN, contract: network.contract, token: network.token, merchants: [merchant, rogue], rpcUrls: [RPC], hmacSecrets: [SECRET], store, confirmations: 1, paymentGraceSeconds: 10 ** 9 });
  fac = await startFacilitator(facilitatorImpl, CHAIN);
  rs = await startResourceServer({
    facilitatorUrl: fac.url, store, handlerCalls: handler,
    scheme: { chainId: CHAIN, contract: network.contract, token: network.token, hmacSecrets: [SECRET], store },
    routes: [
      { path: "/report", amount: "1000", payTo: merchant }, { path: "/other", amount: "1000", payTo: merchant },
      { path: "/pricey", amount: "900000", payTo: merchant }, { path: "/rogue", amount: "1000", payTo: rogue },
      { path: "/wrongtoken", amount: "1000", payTo: merchant, asset: otherToken },
    ],
  });
}, 180_000);

afterAll(() => {
  mkdirSync(EVID, { recursive: true });
  writeFileSync(join(EVID, "phaseC_results.json"), JSON.stringify(evidence, null, 2));
  rs?.close(); fac?.close(); facilitatorImpl?.close(); store.close();
  spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  provider?.destroy();
});

describe("x402 v2 wire format of the custom scheme", () => {
  it("returns 402 + PAYMENT-REQUIRED with a spec-shaped turnspike-allowance requirement (upfront flow)", async () => {
    const c = await rawChallenge(`${rs.base}/report`);
    expect(c.status).toBe(402);
    const req = c.required;
    expect(req.x402Version).toBe(2);
    expect(req.resource.url).toContain("/report");
    const a = req.accepts[0];
    expect(a).toMatchObject({ scheme: SCHEME, network: "eip155:31337", amount: "1000", payTo: merchant, maxTimeoutSeconds: 300 });
    expect(a.asset.toLowerCase()).toBe(network.token.toLowerCase());
    expect(a.extra).toMatchObject({ paymentFlow: "upfront", assetTransferMethod: "vault-pay", protocol: "turnspike/1", resourceId: "/report" });
    expect(a.extra.requestId).toMatch(/^0x[0-9a-f]{64}$/);
    evidence.paymentRequiredExample = req;
  });
  it("facilitator /supported advertises exactly the custom scheme and no signers", async () => {
    const s = await (await fetch(`${fac.url}/supported`)).json();
    expect(s.kinds).toEqual([expect.objectContaining({ x402Version: 2, scheme: SCHEME, network: "eip155:31337" })]);
    expect(s.signers["eip155:*"]).toEqual([]);
    evidence.supported = s;
  });
});

describe("success path", () => {
  it("pays the vault once, settles without a new transaction, delivers over x402 v2 HTTP", async () => {
    const c = mkClient();
    const before = await bal("main"); const head = await provider.getBlockNumber(); const calls = handler.n;
    const r = await c.pay(`${rs.base}/report`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ route: "/report" });
    expect(handler.n).toBe(calls + 1);
    expect(before - (await bal("main"))).toBe(1000n);
    // PAYMENT-RESPONSE
    const pr = unb64(r.headers.get("payment-response")!);
    expect(pr).toMatchObject({ success: true, network: "eip155:31337" });
    // the settled transaction IS the vault Paid transaction: exactly one Paid event, no extra transaction from the facilitator
    const logs = (await paidLogs(head + 1));
    expect(logs).toHaveLength(1);
    expect(logs[0].tx.toLowerCase()).toBe(pr.transaction.toLowerCase());
    expect(logs[0].amount).toBe(1000n);
    expect(logs[0].merchant).toBe(merchant);
    const paymentSig = unb64(c.sent.at(-1)!.headers["payment-signature"]);
    expect(paymentSig).toMatchObject({ x402Version: 2, accepted: { scheme: SCHEME } });
    expect(paymentSig.payload.requestId).toBe(logs[0].requestId);
    expect(pr.payer.toLowerCase()).toBe(logs[0].owner.toLowerCase());
    evidence.success = { paymentSignature: paymentSig, paymentResponse: pr, paidEvent: { tx: logs[0].tx, block: logs[0].block, owner: logs[0].owner, agent: logs[0].agent, merchant: logs[0].merchant, requestId: logs[0].requestId, amount: String(logs[0].amount) }, ownerBalanceDelta: "-1000" };
  });
});

describe("refusals cost nothing", () => {
  const nothingPaid = async (fn: () => Promise<unknown>, match: RegExp, ownerKey = "main") => {
    const before = await bal(ownerKey); const head = await provider.getBlockNumber(); const calls = handler.n;
    await expect(fn()).rejects.toThrow(match);
    expect(await bal(ownerKey)).toBe(before);
    expect(await paidLogs(head + 1)).toHaveLength(0);
    expect(handler.n).toBe(calls);
  };
  it("wrong network (challenge names eip155:1990): refused by policy", async () => {
    // A hostile/mistaken server advertising mainnet id while this client trusts chain 31337.
    const bad = (await import("express")).default();
    bad.get("/x", (_q, r) => {
      const req = { x402Version: 2, resource: { url: "http://x/x" }, accepts: [{ scheme: SCHEME, network: "eip155:1990", amount: "1000", asset: network.token, payTo: merchant, maxTimeoutSeconds: 300, extra: { paymentFlow: "upfront", assetTransferMethod: "vault-pay", requestId: "0x" + "11".repeat(32), sig: "ab".repeat(32), expiresAt: Math.floor(Date.now() / 1000) + 300, contract: network.contract, resourceId: "/x", protocol: "turnspike/1" } }] };
      r.status(402).setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(req)).toString("base64")).json({});
    });
    const s: any = await new Promise((res) => { const l = bad.listen(0, "127.0.0.1", () => res(l)); });
    const base = `http://127.0.0.1:${s.address().port}`;
    const c = mkClient("main", { policy: { payees: [{ origin: base, merchant }], maxPriceBase: 10_000n } });
    await nothingPaid(() => c.pay(`${base}/x`), /wrong_network/);
    s.close();
  });
  it("wrong token: refused by policy", async () => nothingPaid(() => mkClient().pay(`${rs.base}/wrongtoken`), /wrong_network/));
  it("wrong merchant (not on the payee allowlist): refused", async () => {
    const c = mkClient("main", { policy: { payees: [{ origin: rs.base, merchant }], maxPriceBase: 10_000n } });
    await nothingPaid(() => c.pay(`${rs.base}/rogue`), /untrusted_destination/);
  });
  it("merchant allowlisted by the client but not by the owner on-chain: refused before sending", async () => nothingPaid(() => mkClient().pay(`${rs.base}/rogue`), /merchant_not_allowed/));
  it("price above the client ceiling: refused", async () => nothingPaid(() => mkClient().pay(`${rs.base}/pricey`), /price_above_max/));
  it("owner paused: refused", async () => nothingPaid(() => mkClient("paused").pay(`${rs.base}/report`), /paused/, "paused"));
  it("agent revoked: refused", async () => nothingPaid(() => mkClient("revoked").pay(`${rs.base}/report`), /not_authorized_agent/, "revoked"));
  it("merchant missing from this owner's on-chain allowlist: refused", async () => nothingPaid(() => mkClient("unlisted").pay(`${rs.base}/report`), /merchant_not_allowed/, "unlisted"));
  it("challenge expiring too soon: refused", async () => {
    const short = await startResourceServer({
      facilitatorUrl: fac.url, store, handlerCalls: handler, scheme: { chainId: CHAIN, contract: network.contract, token: network.token, hmacSecrets: [SECRET], store, ttlSeconds: 5 },
      routes: [{ path: "/short", amount: "1000", payTo: merchant }],
    });
    const c = mkClient("main", { policy: { payees: [{ origin: short.base, merchant }], maxPriceBase: 10_000n } });
    await nothingPaid(() => c.pay(`${short.base}/short`), /challenge_expired/);
    short.close();
  });
});

describe("server side rejects what it must", () => {
  /** Pays one real purchase and returns its PAYMENT-SIGNATURE header, to be abused afterwards. */
  async function realProof(path: string) {
    const c = mkClient();
    const r = await c.pay(`${rs.base}${path}`);
    expect(r.status).toBe(200);
    return { header: c.sent.at(-1)!.headers["payment-signature"], body: await r.text() };
  }
  const present = (url: string, header: string) => fetch(url, { headers: { "payment-signature": header } });

  it("invalid proofs: forged sig, wrong transaction, malformed", async () => {
    const { header } = await realProof("/report?case=forge");
    const p = unb64(header);
    const calls = handler.n, head = await provider.getBlockNumber();
    const forged = { ...p, payload: { ...p.payload, sig: "00".repeat(32) } };
    const other = (await paidLogs(0))[0].tx; // a different, real Paid transaction
    const wrongTx = { ...p, payload: { ...p.payload, txHash: other } };
    const garbage = { ...p, payload: { requestId: "nope" } };
    const results: Record<string, number> = {};
    for (const [name, pl] of Object.entries({ forged, wrongTx, garbage })) {
      const r = await present(`${rs.base}/report?case=forge`, Buffer.from(JSON.stringify(pl)).toString("base64"));
      const pr = r.headers.get("payment-response"); results[name] = pr ? r.status + " " + unb64(pr).errorReason : r.status + " (" + (unb64(r.headers.get("payment-required") ?? "e30=").error ?? "") + ")";
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.headers.get("x-turnspike-replay")).toBeNull();
    }
    const r = await present(`${rs.base}/report?case=forge`, "!!!not-base64-json");
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(handler.n).toBe(calls);
    expect(await paidLogs(head + 1)).toHaveLength(0);
    evidence.invalidProofStatuses = results;
  });

  it("cross-resource replay: proof for /report?a=1 does not unlock /report?a=2 or /other", async () => {
    const { header } = await realProof("/report?a=1");
    const calls = handler.n;
    const r1 = await present(`${rs.base}/report?a=2`, header);
    const r2 = await present(`${rs.base}/other`, header);
    expect(r1.status).toBe(402); expect(r2.status).toBe(402);
    expect(handler.n).toBe(calls);
    const body2 = unb64(r2.headers.get("payment-required") ?? "e30=");
    evidence.crossResource = { sameRouteOtherQuery: r1.status, otherRoute: r2.status, error: body2.error };
    // defence in depth: even if the x402 layer matched, the facilitator itself refuses a proof for another resource
    const pp = unb64(header);
    const direct = await facilitatorImpl.settle(pp, { ...pp.accepted, extra: { ...pp.accepted.extra, resourceId: "/other" } });
    expect((direct as any).errorReason).toBe("invalid_turnspike_allowance_wrong_resource");
    evidence.crossResourceFacilitatorDirect = (direct as any).errorReason;
    // and the original resource still works with the same proof (idempotent)
    const ok = await present(`${rs.base}/report?a=1`, header);
    expect(ok.status).toBe(200);
  });

  it("duplicate requests: same proof twice delivers the stored response, one Paid event, one handler run", async () => {
    const head = await provider.getBlockNumber(); const calls = handler.n;
    const { header, body } = await realProof("/report?dup=1");
    expect(handler.n).toBe(calls + 1);
    const a = await present(`${rs.base}/report?dup=1`, header); const b = await present(`${rs.base}/report?dup=1`, header);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(await a.text()).toBe(body); expect(await b.text()).toBe(body);
    expect(a.headers.get("x-turnspike-replay")).toBe("1");
    expect(handler.n).toBe(calls + 1);
    expect(await paidLogs(head + 1)).toHaveLength(1);
    const pr = unb64(b.headers.get("payment-response")!);
    expect(pr.success).toBe(true);
  });

  it("concurrent presentations of one proof: handler runs once, nothing is charged again", async () => {
    const { header } = await realProof("/report?conc=1");
    const calls = handler.n, head = await provider.getBlockNumber();
    const rs_ = await Promise.all(Array.from({ length: 8 }, () => present(`${rs.base}/report?conc=1`, header)));
    expect(rs_.every((r) => r.status === 200 || r.status === 202)).toBe(true);
    expect(rs_.some((r) => r.status === 200)).toBe(true);
    expect(handler.n).toBe(calls); // the first delivery already ran in realProof; replays only
    expect(await paidLogs(head + 1)).toHaveLength(0);
  });
});

describe("concurrency and recovery", () => {
  it("5 concurrent purchases: 5 distinct requestIds, 5 Paid events, each charged exactly once", async () => {
    const c = mkClient();
    const before = await bal("main"); const head = await provider.getBlockNumber();
    const rs_ = await Promise.all(Array.from({ length: 5 }, (_, i) => c.pay(`${rs.base}/report?par=${i}`)));
    expect(rs_.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const logs = await paidLogs(head + 1);
    expect(logs).toHaveLength(5);
    expect(new Set(logs.map((l) => l.requestId)).size).toBe(5);
    expect(before - (await bal("main"))).toBe(5000n);
  });

  it("two concurrent calls for ONE purchase key: exactly one payment", async () => {
    const a = mkClient(), b = mkClient();
    const head = await provider.getBlockNumber();
    const url = `${rs.base}/report?samekey=1`;
    const res = await Promise.allSettled([a.pay(url, {}, "k-same"), a.pay(url, {}, "k-same")]);
    const logs = await paidLogs(head + 1);
    expect(logs).toHaveLength(1);
    evidence.sameKeyConcurrent = res.map((r) => r.status === "fulfilled" ? `fulfilled ${r.value.status}` : `rejected ${String(r.reason.message).slice(0, 90)}`);
    void b;
  });

  it("facilitator commits then loses its response: re-presenting the SAME proof delivers, no second payment", async () => {
    const c = mkClient(); const head = await provider.getBlockNumber(); const calls = handler.n;
    fac.faults.dropNextSettleResponse = true;
    const r = await c.pay(`${rs.base}/report?drop=1`);
    expect(r.status).not.toBe(200); // the resource server could not learn the settlement outcome
    expect(handler.n).toBe(calls);
    const logs1 = await paidLogs(head + 1);
    expect(logs1).toHaveLength(1); // the payment happened
    const header = c.sent.at(-1)!.headers["payment-signature"];
    const again = await fetch(`${rs.base}/report?drop=1`, { headers: { "payment-signature": header } });
    expect(again.status).toBe(200);
    expect(handler.n).toBe(calls + 1);
    expect(await paidLogs(head + 1)).toHaveLength(1);
    evidence.facilitatorCrashAfterCommit = { firstStatus: r.status, retryStatus: again.status, paidEvents: 1, paymentResponse: unb64(again.headers.get("payment-response")!) };
  });

  it("proof presented while the payment is unmined: settlement_pending with the tx hash (non-terminal), then the same proof succeeds", async () => {
    const head = await provider.getBlockNumber(); const calls = handler.n;
    const ch = await rawChallenge(`${rs.base}/report?pend=1`);
    const acc = ch.required.accepts[0]; const x = acc.extra;
    await provider.send("evm_setAutomine", [false]);
    const tx = await (vault.connect(agent) as any).pay((owners.main as any).signer.address, merchant, x.requestId, 1000n); // pending in mempool
    const hdr = Buffer.from(JSON.stringify({ x402Version: 2, resource: ch.required.resource, accepted: acc, payload: { requestId: x.requestId, txHash: tx.hash, sig: x.sig } })).toString("base64");
    const early = await fetch(`${rs.base}/report?pend=1`, { headers: { "payment-signature": hdr } });
    const earlyResp = early.headers.get("payment-response") ? unb64(early.headers.get("payment-response")!) : null;
    expect(early.status).toBe(402);
    expect(handler.n).toBe(calls);
    await provider.send("evm_setAutomine", [true]);
    await provider.send("evm_mine", []);
    const late = await fetch(`${rs.base}/report?pend=1`, { headers: { "payment-signature": hdr } });
    expect(late.status).toBe(200);
    expect(await paidLogs(head + 1)).toHaveLength(1);
    // a second, different transaction can never be bound to an already settled request
    const fake = await facilitatorImpl.settle({ x402Version: 2, accepted: acc, payload: { requestId: x.requestId, txHash: "0x" + "ab".repeat(32), sig: x.sig } } as any, { ...acc, extra: { ...x, resourceId: "/report?pend=1" } });
    expect((fake as any).success).toBe(false);
    evidence.settlementPending = { earlyStatus: early.status, earlyPaymentResponse: earlyResp, lateStatus: late.status, differentTxAfterBound: (fake as any).errorReason };
  });

  it("client crash/timeout after broadcast: recovery from the journal pays once and delivers", async () => {
    const head = await provider.getBlockNumber(); const calls = handler.n;
    const key = "recover-1"; const url = `${rs.base}/report?recover=1`;
    await provider.send("evm_setAutomine", [false]);
    const c = mkClient("main", { txTimeoutMs: 1500 });
    let first: any;
    try { await c.pay(url, {}, key); } catch (e: any) { first = e; }
    expect(String(first?.message)).toMatch(/tx_timeout|payment_pending/);
    await provider.send("evm_setAutomine", [true]);
    await provider.send("evm_mine", []);
    // The next call gets a FRESH challenge from the server, but the same purchase key recovers the earlier payment.
    const r = await c.pay(url, {}, key);
    expect(r.status).toBe(200);
    expect(handler.n).toBe(calls + 1);
    const logs = await paidLogs(head + 1);
    expect(logs).toHaveLength(1);
    evidence.clientTimeoutRecovery = { firstError: String(first.message).slice(0, 160), secondStatus: r.status, paidEvents: logs.length, tx: logs[0].tx };
  });
});

describe("stock x402 clients", () => {
  it("unmodified @x402/evm ExactEvmScheme client: does not pay, refuses the unsupported scheme", async () => {
    const acct = privateKeyToAccount(("0x" + "11".repeat(32)) as `0x${string}`);
    const stock = new x402Client();
    stock.register("eip155:*" as any, new ExactEvmScheme(acct as any));
    const f = wrapFetchWithPayment(fetch, stock);
    const head = await provider.getBlockNumber(); const before = await bal("main");
    let outcome = "";
    try { const r = await f(`${rs.base}/report?stock=1`); outcome = `resolved with HTTP ${r.status}`; } catch (e: any) { outcome = `threw: ${String(e?.message).slice(0, 200)}`; }
    expect(outcome).toMatch(/threw/);
    expect(await paidLogs(head + 1)).toHaveLength(0);
    expect(await bal("main")).toBe(before);
    evidence.stockExactClient = outcome;
  });

  it("negative control: standard exact advertised for a token without EIP-3009 is refused by the stock client defaults, and the token has no transferWithAuthorization", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.get("/x", (_q, r) => {
      const req = { x402Version: 2, resource: { url: "http://x/x" }, accepts: [{ scheme: "exact", network: "eip155:31337", amount: "1000", asset: network.token, payTo: merchant, maxTimeoutSeconds: 60, extra: { name: "QUSDC", version: "1" } }] };
      r.status(402).setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(req)).toString("base64")).json({});
    });
    const seen: string[] = [];
    app.get("/x2", () => {});
    const s: any = await new Promise((res) => { const l = app.listen(0, "127.0.0.1", () => res(l)); });
    const acct = privateKeyToAccount(("0x" + "22".repeat(32)) as `0x${string}`);
    const stock = new x402Client();
    stock.register("eip155:*" as any, new ExactEvmScheme(acct as any));
    const f = wrapFetchWithPayment(async (i, init) => { const h = new Headers(init?.headers as any); if (h.get("payment-signature")) seen.push("PAYMENT-SIGNATURE sent"); return fetch(i as any, init); }, stock);
    let nerr = ""; await f(`http://127.0.0.1:${s.address().port}/x`).catch((e: any) => { nerr = String(e?.message).slice(0, 220); });
    s.close();
    // The token has no transferWithAuthorization: calling it reverts. Same on QUSDC (Phase A), where selector 0xe3ee160e is absent.
    const sel = ethers.id("transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)").slice(0, 10);
    const code = await provider.getCode(network.token);
    evidence.negativeControl = { stockClientError: nerr, stockClientSignedAuthorization: seen.length > 0, tokenHasEip3009Selector: code.includes(sel.slice(2)) };
    expect(code.includes(sel.slice(2))).toBe(false);
  });
});
