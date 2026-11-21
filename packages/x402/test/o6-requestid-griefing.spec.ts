// O6: requestId griefing. Local Hardhat only, the real TurnpikeAllowance contract, the real middleware (through x402Seller)
// and the real client (through createX402Fetch). Nothing here touches QIE mainnet or the deployed vault.
//
// Claim under test: the vault's replay key is the global (merchant, requestId) pair, so a third party with their own
// owner/agent account can call pay(theirOwner, merchant, requestId, 1) first and consume a victim's pending requestId.
//
// Each test records what it observed in EVIDENCE, printed at the end (docs/x402/O6_REQUESTID_GRIEFING.md quotes it).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { startNode, stopNode } from "../../../scripts/test-util/hardhat-node";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { ContractFactory, HDNodeWallet, Interface, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { turnspike, type TurnspikeConfig, type TurnspikeMiddleware } from "@turnspike-qie/middleware";
import { TurnspikeClient, MemoryJournal, type Network as TsNetwork } from "@turnspike-qie/client";
import { x402Seller, createX402Fetch, MemoryProofStore, b64json, unb64json } from "../src";

const PORT = 8721;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN = 31337;
const ROOT = resolve(__dirname, "../../..");
const PHRASE = "test test test test test test test test test test test junk";
const SECRET = "o6".repeat(20);
const PRICE = 1000n;
const art = (p: string) => JSON.parse(readFileSync(join(ROOT, "artifacts/contracts", p), "utf8"));
const VAULT_ERR = new Interface([
  "error NotOwnerAgent()", "error Paused()", "error MerchantNotAllowed()", "error CapExceeded(uint256,uint256)",
  "error DailyCapExceeded(uint256,uint256)", "error RequestAlreadyUsed(bytes32)", "error InsufficientBalance()", "error ZeroAmount()",
]);

let node: ChildProcess;
let provider: JsonRpcProvider;
let token: ethers.Contract, vault: ethers.Contract;
let victimOwner: HDNodeWallet, victimAgent: HDNodeWallet, attacker: HDNodeWallet, attacker2Owner: HDNodeWallet, attacker2Agent: HDNodeWallet;
let merchant: string;
let tsNet: TsNetwork;
let chainOffset = 0;
const clock = () => Math.floor(Date.now() / 1000) + chainOffset;
const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const listen = (app: express.Express): Promise<Server> => new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const closers: (() => unknown)[] = [];
const EVIDENCE: Record<string, unknown> = {};

interface Seller { base: string; mw: TurnspikeMiddleware; calls: { n: number }; events: Record<string, unknown>[] }
async function startSeller(over: Partial<TurnspikeConfig> = {}): Promise<Seller> {
  const dir = mkdtempSync(join(tmpdir(), "o6-"));
  const events: Record<string, unknown>[] = [];
  const mw = turnspike({
    rpcUrls: [RPC], chainId: CHAIN, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: [SECRET],
    dbPath: join(dir, "s.sqlite"), confirmations: 1, retryAfterSeconds: 1, prices: { "/report": Number(PRICE) }, x402: true,
    rateLimitPerMinute: 100_000, paymentGraceSeconds: 600, clock, onEvent: (e) => events.push(e), ...over,
  });
  const calls = { n: 0 };
  const app = express();
  app.use("/v1", x402Seller(mw));
  app.get("/v1/report", (q, r) => r.json({ n: ++calls.n, query: q.query, marker: "PAID-CONTENT" }));
  const server = await listen(app);
  closers.push(() => { server.closeAllConnections?.(); server.close(); mw.close(); });
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, mw, calls, events };
}

/** The victim's agent: the real TurnspikeClient behind the real createX402Fetch. `fetchHook` sees each HTTP response. */
function victim(seller: Seller, o: { fetchHook?: (res: Response) => Promise<void>; clientEvent?: (e: any) => void; agentEvent?: (e: any) => void } = {}) {
  const journal = new MemoryJournal();
  const client = new TurnspikeClient({
    signer: victimAgent, owner: victimOwner.address, network: tsNet, policy: { payees: [{ origin: seller.base, merchant }], maxPriceBase: 10_000n },
    journal, confirmations: 1, txTimeoutMs: 20_000, onEvent: o.clientEvent,
  } as any);
  const f: typeof fetch = async (i: any, n?: any) => { const r = await fetch(i, n); if (o.fetchHook) await o.fetchHook(r.clone() as Response); return r; };
  const pay = createX402Fetch({
    client: client as any, journal: journal as any, owner: victimOwner.address, agent: victimAgent.address, network: { chainId: CHAIN, token: tsNet.token },
    proofStore: new MemoryProofStore(), fetch: f, retry: { attempts: 3, baseDelayMs: 200, maxDelayMs: 500, totalMs: 5_000 }, onEvent: o.agentEvent,
  });
  return { pay, client, journal };
}

const challengeOf = (res: Response) => unb64json<any>(res.headers.get("payment-required")!).accepts[0];
const qusdc = (a: string) => token.balanceOf(a) as Promise<bigint>;
const vaultBal = async (o: string) => ((await (vault as any).account(o)).balance as bigint);
const revertName = (e: any) => { try { return VAULT_ERR.parseError(e?.data ?? e?.info?.error?.data)?.name ?? null; } catch { return e?.shortMessage ?? String(e); } };
const attackerPay = (from: HDNodeWallet, owner: string, requestId: string, amount: bigint, ov: Record<string, unknown> = {}) =>
  (vault.connect(from) as any).pay(owner, merchant, requestId, amount, ov);
const header = (acc: any, resource: any, txHash: string) => b64json({ x402Version: 2, resource, accepted: acc, payload: { requestId: acc.extra.requestId, txHash, sig: acc.extra.sig } });

let S: Seller;

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
  victimOwner = w(4); victimAgent = w(1); merchant = w(2).address;
  attacker = w(7); // one EOA acting as its own owner AND its own agent
  attacker2Owner = w(8); attacker2Agent = w(9);
  for (const [who, dep] of [[victimOwner, 4_000_000n], [attacker, 10n], [attacker2Owner, 10n]] as const) {
    await (await (token.connect(deployer) as any).mint(who.address, dep)).wait();
    await (await (token.connect(who) as any).approve(vault.target, dep)).wait();
    await (await (vault.connect(who) as any).deposit(dep)).wait();
  }
  await (await (vault.connect(victimOwner) as any).setPolicy(victimAgent.address, 50_000n, 1_000_000n)).wait();
  await (await (vault.connect(victimOwner) as any).setMerchant(merchant, true)).wait();
  await (await (vault.connect(attacker) as any).setPolicy(attacker.address, 1n, 10n)).wait(); // attacker: per-call cap 1 unit
  await (await (vault.connect(attacker2Owner) as any).setPolicy(attacker2Agent.address, 1n, 10n)).wait(); // merchant NOT allowlisted
  tsNet = { name: "local", chainId: CHAIN, contract: vault.target as string, token: token.target as string, decimals: 6, rpcUrls: [RPC], explorer: "http://explorer.local" };
  chainOffset = (await provider.getBlock("latest"))!.timestamp - Math.floor(Date.now() / 1000);
  S = await startSeller();
}, 180_000);

afterAll(() => {
  // eslint-disable-next-line no-console
  console.log("O6_EVIDENCE " + JSON.stringify(EVIDENCE, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  for (const c of closers) { try { c(); } catch { /* ignore */ } }
  stopNode(node);
  provider?.destroy();
});

describe("O6 requestId entropy and observability", () => {
  it("requestIds are 32-byte hashes over a fresh 32-byte random nonce: distinct and unpredictable", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) ids.add(challengeOf(await fetch(`${S.base}/v1/report?e=1`)).extra.requestId.toLowerCase());
    expect(ids.size).toBe(20); // same URL, 20 different requestIds
    for (const id of ids) expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    EVIDENCE.entropy = { sameUrlChallenges: 20, distinctRequestIds: ids.size, source: "keccak256(abi.encode(randomBytes(32) nonce, merchant, resourceId, price, chainId, contract, expiresAt))" };
  });

  it("a challenge is only visible to whoever receives the 402 (or to a mempool observer after broadcast); no on-chain trace before pay", async () => {
    const acc = challengeOf(await fetch(`${S.base}/v1/report?obs=1`));
    expect(await (vault as any).isUsed(merchant, acc.extra.requestId)).toBe(false);
    EVIDENCE.observability = "requestId is in the 402 body and PAYMENT-REQUIRED header only (no-store); nothing on chain until a pay() transaction, whose calldata carries it in clear in the mempool";
  });
});

describe("O6 preconditions for the attacker", () => {
  it("without the merchant on the attacker's own allowlist, pay reverts MerchantNotAllowed and the requestId stays free", async () => {
    const acc = challengeOf(await fetch(`${S.base}/v1/report?pre=1`));
    let err: string | null = null;
    try { await (await attackerPay(attacker2Agent, attacker2Owner.address, acc.extra.requestId, 1n)).wait(); } catch (e) { err = revertName(e); }
    expect(err).toBe("MerchantNotAllowed");
    expect(await (vault as any).isUsed(merchant, acc.extra.requestId)).toBe(false);
    EVIDENCE.withoutAllowlist = { revert: err, requestIdConsumed: false };
  });

  it("the attacker cannot spend from the victim's owner account (NotOwnerAgent)", async () => {
    const acc = challengeOf(await fetch(`${S.base}/v1/report?pre=2`));
    let err: string | null = null;
    try { await (await attackerPay(attacker, victimOwner.address, acc.extra.requestId, 1n)).wait(); } catch (e) { err = revertName(e); }
    expect(err).toBe("NotOwnerAgent");
    EVIDENCE.victimAccount = { revert: err };
  });

  it("the attacker only needs to allowlist the merchant on their own account (one setMerchant, no merchant consent)", async () => {
    await (await (vault.connect(attacker) as any).setMerchant(merchant, true)).wait();
    expect(await (vault as any).allowedMerchant(attacker.address, merchant)).toBe(true);
  });
});

describe("O6 case A: the victim's 402 leaks before the victim pays (attacker pays 1 unit first)", () => {
  let leaked: any;
  let attackTx: string;
  let attackerGasCost = 0n;
  let url: string;
  let v: ReturnType<typeof victim>;

  it("F1: victim's first challenge is refused before broadcast (already_paid, no gas); createX402Fetch requests one fresh challenge and pays it once", async () => {
    url = `${S.base}/v1/report?case=A`;
    let first = true;
    const agentEvents: any[] = [];
    v = victim(S, {
      agentEvent: (e) => agentEvents.push(e),
      fetchHook: async (res) => {
        if (res.status !== 402 || !first) return;
        first = false;
        leaked = { acc: challengeOf(res), resource: unb64json<any>(res.headers.get("payment-required")!).resource };
        const tx = await attackerPay(attacker, attacker.address, leaked.acc.extra.requestId, 1n);
        const rc = await tx.wait();
        attackTx = tx.hash;
        attackerGasCost = rc.gasUsed * rc.gasPrice;
      },
    });
    const merchantBefore = await qusdc(merchant), ownerBefore = await vaultBal(victimOwner.address);
    const r = await v.pay(url);
    expect(r.ok).toBe(true); // the single fresh-challenge retry delivered the resource
    expect(agentEvents.filter((e) => e.evt === "x402.agent.retry" && e.reason === "fresh_challenge:already_paid")).toHaveLength(1);
    expect(ownerBefore - (await vaultBal(victimOwner.address))).toBe(PRICE); // charged once, for the fresh challenge only
    expect((await qusdc(merchant)) - merchantBefore).toBe(1n + PRICE); // the attacker's 1 unit plus the victim's one payment
    const rec = await v.journal.get((r as any).purchaseKey);
    expect(rec?.challenge?.requestId.toLowerCase()).not.toBe(leaked.acc.extra.requestId.toLowerCase());
    EVIDENCE.caseA_victim = { result: { ok: r.ok, kind: (r as any).kind }, freshChallengeRetries: 1, victimQusdcCharged: PRICE, leakedRequestIdCharged: 0, merchantReceived: 1n + PRICE, journalState: rec?.state };
    const rc = await provider.getTransactionReceipt(attackTx);
    EVIDENCE.caseA_attackerCost = { qusdc: 1, gasUsed: rc!.gasUsed, gasCostWei: attackerGasCost };
  });

  it("the seller refuses the attacker's 1-unit tx (amount_below_price), keeps the row open, delivers nothing", async () => {
    const before = S.calls.n;
    const res = await fetch(url, { headers: { "payment-signature": header(leaked.acc, leaked.resource, attackTx) } });
    const pr = res.headers.get("payment-response") ? unb64json<any>(res.headers.get("payment-response")!) : null;
    const row = S.mw.store.get(leaked.acc.extra.requestId.toLowerCase())!;
    expect(res.status).toBe(402);
    expect(S.calls.n).toBe(before); // handler never ran
    expect(row.state).not.toBe("PAID_CONFIRMED");
    expect(row.state).not.toBe("DELIVERED");
    expect(row.txHash ?? null).toBeNull(); // the attacker's tx is not bound to the row
    EVIDENCE.caseA_seller = { status: res.status, errorReason: pr?.errorReason, rowState: row.state, rowTxHash: row.txHash ?? null, delivered: false, events: S.events.filter((e) => e.requestId === leaked.acc.extra.requestId.toLowerCase()).map((e) => e.evt + ":" + (e.reason ?? "")) };
  });

  it("reconcile() finds the attacker's Paid log, refuses it, and leaves the row PAID_PENDING without a txHash (not delivered)", async () => {
    const r = await S.mw.reconcile({ lookbackBlocks: 10_000 });
    const row = S.mw.store.get(leaked.acc.extra.requestId.toLowerCase())!;
    expect(row.state === "PAID_CONFIRMED" || row.state === "DELIVERED").toBe(false);
    expect(row.disposition ?? null).not.toBe("PAID_LATE");
    EVIDENCE.caseA_reconcile = { recovered: r.recovered, rowState: row.state, rowTxHash: row.txHash ?? null, disposition: row.disposition ?? null };
  });

  it("recovery: the same key returns the delivered purchase without paying again; a new intent pays a new challenge", async () => {
    const ownerBefore0 = await vaultBal(victimOwner.address);
    const again = await v.pay(url);
    expect(again.ok).toBe(true);
    expect(await vaultBal(victimOwner.address)).toBe(ownerBefore0); // resumed: no second charge
    EVIDENCE.caseA_sameKeyRetry = { ok: again.ok, resumed: (again as any).resumed, charged: 0, journalState: (await v.journal.get((again as any).purchaseKey))?.state };
    const ownerBefore = await vaultBal(victimOwner.address);
    const fresh = await v.pay(url, {}, { intent: "retry-after-request-used" });
    expect(fresh.ok).toBe(true);
    expect(ownerBefore - (await vaultBal(victimOwner.address))).toBe(PRICE);
    EVIDENCE.caseA_newChallenge = { ok: fresh.ok, kind: (fresh as any).kind, charged: PRICE };
  });
});

describe("O6 case B: mempool front-run of the victim's broadcast pay", () => {
  let frontRun: { tx: string; journal: MemoryJournal; client: TurnspikeClient; rec: any };
  let frontRunChallenge: any = null;
  it("F1: victim's tx reverts RequestAlreadyUsed: closed as request_used_by_other_payer, one fresh challenge, charged once", async () => {
    const url = `${S.base}/v1/report?case=B`;
    let attackDone: Promise<{ hash: string; gasCost: bigint; gasUsed: bigint }> | null = null;
    let sawChallenge = false;
    const broadcasts: string[] = [];
    const agentEvents: any[] = [];
    const v = victim(S, {
      agentEvent: (e) => agentEvents.push(e),
      fetchHook: async (res) => { if (res.status === 402 && !sawChallenge) { sawChallenge = true; await provider.send("evm_setAutomine", [false]); } },
      clientEvent: (e) => {
        if (e.evt === "payment_broadcast") broadcasts.push(e.txHash);
        if (e.evt !== "payment_broadcast" || attackDone) return;
        attackDone = (async () => {
          const recs = (await v.journal.list?.()) ?? [];
          frontRunChallenge = recs.find((x: any) => x.txHash === e.txHash)?.challenge ?? null;
          // A mempool observer reads the requestId from the victim's pending calldata and outbids it.
          const pending = await provider.getTransaction(e.txHash);
          const rid = vault.interface.parseTransaction({ data: pending!.data })!.args[2] as string;
          const fee = await provider.getFeeData();
          const tx = await attackerPay(attacker, attacker.address, rid, 1n, { gasLimit: 200_000n, maxFeePerGas: (fee.maxFeePerGas ?? 10n ** 10n) * 3n, maxPriorityFeePerGas: (fee.maxPriorityFeePerGas ?? 10n ** 9n) * 3n });
          await provider.send("evm_mine", []);
          await provider.send("evm_setAutomine", [true]);
          const rc = (await provider.getTransactionReceipt(tx.hash))!;
          return { hash: tx.hash, gasUsed: rc.gasUsed, gasCost: rc.gasUsed * rc.gasPrice };
        })();
      },
    });
    const ownerBefore = await vaultBal(victimOwner.address);
    const gasBefore = await provider.getBalance(victimAgent.address);
    const r = await v.pay(url);
    const atk = await attackDone!;
    const atkRc = (await provider.getTransactionReceipt(atk.hash))!;
    const victimTx = broadcasts[0];
    const victimRc = await provider.getTransactionReceipt(victimTx);
    const gasSpent = gasBefore - (await provider.getBalance(victimAgent.address));
    expect(atkRc.status).toBe(1);
    expect(victimRc?.status).toBe(0);
    expect(atkRc.blockNumber).toBe(victimRc!.blockNumber); // same block, attacker ordered first
    expect(gasSpent > 0n).toBe(true);
    let revert: string | null = null;
    const vt = (await provider.getTransaction(victimTx))!;
    try { await provider.call({ from: vt.from, to: vt.to, data: vt.data, blockTag: victimRc!.blockNumber }); } catch (e) { revert = revertName(e); }
    // F1: the client closed the front-run attempt as request_used_by_other_payer (paid false), and createX402Fetch asked
    // for exactly one fresh challenge, which it paid once.
    expect(agentEvents.filter((e) => e.evt === "x402.agent.retry" && e.reason === "fresh_challenge:request_used_by_other_payer")).toHaveLength(1);
    expect(r.ok).toBe(true);
    expect(broadcasts).toHaveLength(2);
    expect(ownerBefore - (await vaultBal(victimOwner.address))).toBe(PRICE); // charged once: the reverted tx moved nothing
    const rec = await v.journal.get((r as any).purchaseKey);
    expect(rec?.state).toBe("delivered");
    expect(rec?.txHash).toBe(broadcasts[1]);
    EVIDENCE.caseB = {
      victimResult: { ok: r.ok, kind: (r as any).kind },
      firstAttempt: { error: "request_used_by_other_payer", paid: false, txStatus: victimRc?.status, revertReplayed: revert, gasUsed: victimRc?.gasUsed },
      victimGasCostWei: gasSpent, victimQusdcCharged: PRICE, frontRunRequestIdCharged: 0, freshChallengeRetries: 1, journalState: rec?.state,
      attacker: { qusdc: 1, gasUsed: atk.gasUsed, gasCostWei: atk.gasCost },
    };
    frontRun = { tx: victimTx, journal: v.journal, client: v.client, rec: rec! };
    // Recovery with the same key: the delivered purchase is returned, nothing is paid again.
    const before = await vaultBal(victimOwner.address);
    const again = await v.pay(url);
    expect(again.ok).toBe(true);
    expect(await vaultBal(victimOwner.address)).toBe(before);
    EVIDENCE.caseB_sameKeyRetry = { ok: again.ok, resumed: (again as any).resumed, charged: 0 };
  });

  // Direct client checks on the front-run transaction: only a mined, still-canonical revert counts as "not charged".
  async function brokenRecord(key: string) {
    const victimRc = (await provider.getTransactionReceipt(frontRun.tx))!;
    const rec = { ...frontRun.rec, key, state: "broadcast", txHash: frontRun.tx, challenge: frontRunChallenge, error: undefined, blockNumber: undefined, rev: 1, attempt: `t-${key}`, fromBlock: victimRc.blockNumber - 1 };
    await frontRun.journal.put(rec as any);
  }
  function patchProvider(over: Record<string, (...a: any[]) => any>): () => void {
    const c = frontRun.client as any;
    const real = c.provider;
    c.provider = new Proxy(real, { get: (t, k) => (typeof k === "string" && k in over ? over[k] : typeof t[k] === "function" ? t[k].bind(t) : t[k]) });
    return () => { c.provider = real; };
  }

  it("F1: a resumed front-run attempt is closed as request_used_by_other_payer (paid false, record failed)", async () => {
    await brokenRecord("f1-direct");
    const r = await frontRun.client.resume("f1-direct");
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("request_used_by_other_payer");
    expect((r as any).paid).toBe(false);
    expect((r as any).maybePaid).toBeFalsy();
    const rec = await frontRun.journal.get("f1-direct");
    expect(rec?.state).toBe("failed");
    expect(rec?.error).toBe("request_used_by_other_payer");
    EVIDENCE.F1_direct = { error: (r as any).error, paid: (r as any).paid, maybePaid: (r as any).maybePaid ?? false, journalState: rec?.state };
  });

  it("F1 guard: a receipt not found yet stays maybePaid and the record stays broadcast", async () => {
    await brokenRecord("f1-nofound");
    const restore = patchProvider({ waitForTransaction: async () => null });
    try {
      const r = await frontRun.client.resume("f1-nofound");
      expect((r as any).paid).toBe(false);
      expect((r as any).maybePaid).toBe(true);
      expect((await frontRun.journal.get("f1-nofound"))?.state).toBe("broadcast");
    } finally { restore(); }
  });

  it("F1 guard: a revert removed by a reorg (receipt gone, or block hash changed) is not classified; maybePaid, record stays broadcast", async () => {
    await brokenRecord("f1-reorg1");
    let restore = patchProvider({ getTransactionReceipt: async () => null });
    try {
      const r = await frontRun.client.resume("f1-reorg1");
      expect((r as any).error).toBe("payment_pending");
      expect((r as any).maybePaid).toBe(true);
      expect((r as any).paid).toBe(false);
      expect((await frontRun.journal.get("f1-reorg1"))?.state).toBe("broadcast");
    } finally { restore(); }
    await brokenRecord("f1-reorg2");
    const real = (frontRun.client as any).provider;
    restore = patchProvider({ getBlock: async (b: any) => { const blk = await real.getBlock(b); return blk ? { ...blk, hash: "0x" + "ab".repeat(32) } : blk; } });
    try {
      const r = await frontRun.client.resume("f1-reorg2");
      expect((r as any).error).toBe("payment_pending");
      expect((r as any).maybePaid).toBe(true);
      expect((await frontRun.journal.get("f1-reorg2"))?.state).toBe("broadcast");
    } finally { restore(); }
  });
});

describe("O6 control: payer binding and full-price theft of a leaked challenge", () => {
  it("with allowedOwners set, the attacker's tx is refused as owner_not_permitted", async () => {
    const B = await startSeller({ allowedOwners: [victimOwner.address] } as any);
    const r0 = await fetch(`${B.base}/v1/report?ctl=1`);
    const acc = challengeOf(r0), resource = unb64json<any>(r0.headers.get("payment-required")!).resource;
    // attacker pays FULL price this time (needs a bigger cap and balance)
    await (await (token.connect(new NonceManager(w(0))) as any).mint(attacker.address, PRICE)).wait();
    await (await (token.connect(attacker) as any).approve(vault.target, PRICE)).wait();
    await (await (vault.connect(attacker) as any).deposit(PRICE)).wait();
    await (await (vault.connect(attacker) as any).setPolicy(attacker.address, PRICE, PRICE * 10n)).wait();
    const tx = await attackerPay(attacker, attacker.address, acc.extra.requestId, PRICE);
    await tx.wait();
    const res = await fetch(`${B.base}/v1/report?ctl=1`, { headers: { "payment-signature": header(acc, resource, tx.hash) } });
    const pr = res.headers.get("payment-response") ? unb64json<any>(res.headers.get("payment-response")!) : null;
    expect(res.status).toBe(402);
    expect(B.calls.n).toBe(0);
    EVIDENCE.control_allowedOwners = { status: res.status, errorReason: pr?.errorReason };
  });

  it("without payer binding, a leaked challenge paid at full price by a third party is delivered to whoever presents it", async () => {
    await (await (token.connect(new NonceManager(w(0))) as any).mint(attacker.address, PRICE)).wait();
    await (await (token.connect(attacker) as any).approve(vault.target, PRICE)).wait();
    await (await (vault.connect(attacker) as any).deposit(PRICE)).wait();
    const r0 = await fetch(`${S.base}/v1/report?ctl=2`);
    const acc = challengeOf(r0), resource = unb64json<any>(r0.headers.get("payment-required")!).resource;
    const tx = await attackerPay(attacker, attacker.address, acc.extra.requestId, PRICE);
    await tx.wait();
    const res = await fetch(`${S.base}/v1/report?ctl=2`, { headers: { "payment-signature": header(acc, resource, tx.hash) } });
    expect(res.status).toBe(200);
    EVIDENCE.control_fullPriceLeak = { status: res.status, note: "the attacker bought the resource at full price; same as any buyer, but it also kills the victim's challenge" };
  });
});
