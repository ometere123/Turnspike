// RV-4: the F1 classification (request_used_by_other_payer) must read "used" and the Paid-log scan from ONE head snapshot.
// A lagging or load-balanced RPC can report the requestId as used (by the owner's OWN competing payment) while the log
// scan misses that payment; closing the key as "not charged" would let the retry charge the owner twice.
// Local Hardhat only (port 8761), the real vault, the real middleware and the real client. The lagging node is a provider
// wrapper around the client's provider (getLogs only).
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { startNode, stopNode } from "../../../scripts/test-util/hardhat-node";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { turnspike, type TurnspikeMiddleware } from "@turnspike-qie/middleware";
import { TurnspikeClient, MemoryJournal, type Network as TsNetwork } from "@turnspike-qie/client";
import { x402Seller, unb64json } from "../src";

const PORT = 8761;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN = 31337;
const ROOT = resolve(__dirname, "../../..");
const PHRASE = "test test test test test test test test test test test junk";
const SECRET = "rv4".repeat(14);
const PRICE = 1000n;
const art = (p: string) => JSON.parse(readFileSync(join(ROOT, "artifacts/contracts", p), "utf8"));

let node: ChildProcess;
let provider: JsonRpcProvider;
let token: ethers.Contract, vault: ethers.Contract;
let victimOwner: HDNodeWallet, victimAgent: HDNodeWallet, attacker: HDNodeWallet, merchant: string;
let tsNet: TsNetwork;
let chainOffset = 0;
const clock = () => Math.floor(Date.now() / 1000) + chainOffset;
const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const closers: (() => unknown)[] = [];
// Background mining tasks started from onEvent handlers; every one is awaited before the next test and before provider.destroy().
const bg = new Set<Promise<void>>();
let tearingDown = false;
const drainBg = async () => { while (bg.size) await Promise.allSettled([...bg]); };
const vaultBal = async (o: string) => ((await (vault as any).account(o)).balance as bigint);
let seller: { base: string; mw: TurnspikeMiddleware };
let seq = 0;

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
  victimOwner = w(4); victimAgent = w(1); merchant = w(2).address; attacker = w(7); // attacker: its own owner and agent
  for (const [who, dep] of [[victimOwner, 4_000_000n], [attacker, 100_000n]] as const) {
    await (await (token.connect(deployer) as any).mint(who.address, dep)).wait();
    await (await (token.connect(who) as any).approve(vault.target, dep)).wait();
    await (await (vault.connect(who) as any).deposit(dep)).wait();
  }
  await (await (vault.connect(victimOwner) as any).setPolicy(victimAgent.address, 50_000n, 1_000_000n)).wait();
  await (await (vault.connect(victimOwner) as any).setMerchant(merchant, true)).wait();
  await (await (vault.connect(attacker) as any).setPolicy(attacker.address, 50_000n, 1_000_000n)).wait();
  await (await (vault.connect(attacker) as any).setMerchant(merchant, true)).wait();
  tsNet = { name: "local", chainId: CHAIN, contract: vault.target as string, token: token.target as string, decimals: 6, rpcUrls: [RPC], explorer: "http://explorer.local" };
  chainOffset = (await provider.getBlock("latest"))!.timestamp - Math.floor(Date.now() / 1000);
  const mw = turnspike({
    rpcUrls: [RPC], chainId: CHAIN, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: [SECRET],
    dbPath: join(mkdtempSync(join(tmpdir(), "rv4-")), "s.sqlite"), confirmations: 1, retryAfterSeconds: 1, prices: { "/report": Number(PRICE) }, x402: true,
    rateLimitPerMinute: 100_000, paymentGraceSeconds: 600, clock, onEvent: () => {},
  } as any);
  const app = express();
  app.use("/v1", x402Seller(mw));
  app.get("/v1/report", (q, r) => r.json({ marker: "PAID-CONTENT", query: q.query }));
  const server: Server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  closers.push(() => { server.closeAllConnections?.(); server.close(); mw.close(); });
  seller = { base: `http://127.0.0.1:${(server.address() as any).port}`, mw };
}, 180_000);

afterEach(async () => {
  await drainBg(); // no mining task may outlive its test: a late evm_setAutomine(true) would let the next test's competitor mine early
  await provider.send("evm_setAutomine", [true]);
});

afterAll(async () => {
  tearingDown = true;
  await drainBg();
  for (const c of closers) { try { c(); } catch { /* ignore */ } }
  stopNode(node);
  provider?.destroy();
});

/**
 * Runs the victim client up to a mined, reverted own transaction. The competitor pays the same requestId as soon as the 402 is
 * seen (before the client broadcasts) and both land in one block, the competitor first: for "own" it is the same owner and agent
 * (an earlier nonce of the agent, as when a second worker of the same agent pays), for "other" an unrelated payer.
 */
async function revertedAttempt(competitor: "own" | "other") {
  const journal = new MemoryJournal();
  const broadcasts: string[] = [];
  let compete: Promise<string> | null = null;
  const http: typeof fetch = async (i: any, n?: any) => {
    const res = await fetch(i, n);
    if (res.status === 402 && !compete) {
      const rid = unb64json<any>(res.headers.get("payment-required")!).accepts[0].extra.requestId as string;
      await provider.send("evm_setAutomine", [false]);
      const fee = await provider.getFeeData();
      const ov = { gasLimit: 250_000n, maxFeePerGas: (fee.maxFeePerGas ?? 10n ** 10n) * 3n, maxPriorityFeePerGas: (fee.maxPriorityFeePerGas ?? 10n ** 9n) * 3n };
      compete = (async () => (competitor === "own"
        ? await (vault.connect(victimAgent) as any).pay(victimOwner.address, merchant, rid, PRICE, ov) // the owner's own other payment
        : await (vault.connect(attacker) as any).pay(attacker.address, merchant, rid, 1n, ov)).hash as string)(); // an unrelated payer
      await compete;
    }
    return res;
  };
  // Gas estimation runs on hardhat's pending block, where the competitor is already queued and would make it revert; a fixed
  // estimate lets the client broadcast, as it would against a node whose mempool view is behind.
  const noPending = new Proxy(provider, { get: (t: any, k) => (k === "estimateGas" ? async () => 250_000n : typeof t[k] === "function" ? t[k].bind(t) : t[k]) });
  const client = new TurnspikeClient({
    signer: victimAgent.connect(noPending as any), owner: victimOwner.address, network: tsNet, policy: { payees: [{ origin: seller.base, merchant }], maxPriceBase: 10_000n },
    journal, confirmations: 1, txTimeoutMs: 20_000, fetch: http,
    onEvent: (e: any) => {
      if (e.evt !== "payment_broadcast") return;
      broadcasts.push(e.txHash);
      // One block with both transactions, then an empty one so the provider's poller (which may have missed the first) sees a new head.
      if (tearingDown) return;
      const task: Promise<void> = (async () => {
        await provider.send("evm_mine", []);
        await provider.send("evm_setAutomine", [true]);
        await new Promise((r) => setTimeout(r, 400));
        await provider.send("evm_mine", []);
      })().catch((e) => { if (!tearingDown) throw e; }).finally(() => { bg.delete(task); });
      bg.add(task);
    },
  } as any);
  return { client, journal, broadcasts, competitorDone: () => compete!, run: (key: string) => client.fetch(`${seller.base}/v1/report?rv4=${++seq}`, {}, { idempotencyKey: key }) };
}

/** Wraps the client's provider: getLogs scans to "latest" return nothing while `lagged()` (a stale replica); numeric toBlock reads are real. */
function lagLatestScans(client: TurnspikeClient, lagged: () => boolean): () => void {
  const c = client as any;
  const real = c.provider;
  c.provider = new Proxy(real, {
    get: (t, k) => {
      if (k === "getLogs") return async (f: any) => (lagged() && f.toBlock === "latest" ? [] : t.getLogs(f));
      return typeof t[k] === "function" ? t[k].bind(t) : t[k];
    },
  });
  return () => { c.provider = real; };
}

describe("RV-4: F1 classification reads one head snapshot", () => {
  it("(a) lagging node: the owner's own competing Paid log is not visible to the latest scan while isUsed is true -> payment_pending + maybePaid, record stays broadcast", async () => {
    const a = await revertedAttempt("own");
    const restore = lagLatestScans(a.client, () => true);
    const ownerBefore = await vaultBal(victimOwner.address);
    try {
      const r: any = await a.run("rv4-a");
      const competitorTx = await a.competitorDone();
      const victimRc = (await provider.getTransactionReceipt(a.broadcasts[0]))!;
      expect(victimRc.status).toBe(0); // our own tx mined and reverted: RequestAlreadyUsed
      expect((await provider.getTransactionReceipt(competitorTx))!.status).toBe(1); // the owner's own competing payment landed
      expect(r.ok).toBe(false);
      expect(r.error).toBe("payment_pending");
      expect(r.maybePaid).toBe(true);
      expect(r.paid).toBe(false);
      expect((await a.journal.get("rv4-a"))?.state).toBe("broadcast"); // not closed as "not charged"
      expect(ownerBefore - (await vaultBal(victimOwner.address))).toBe(PRICE); // the owner WAS charged once (by the competitor)
      expect(a.broadcasts).toHaveLength(1); // and nothing was re-sent
    } finally { restore(); await provider.send("evm_setAutomine", [true]); }
  });

  it("(b) consistent snapshot, no Paid log for this owner and agent (an unrelated payer took the requestId) -> request_used_by_other_payer, paid false, record failed", async () => {
    const a = await revertedAttempt("other");
    const ownerBefore = await vaultBal(victimOwner.address);
    try {
      const r: any = await a.run("rv4-b");
      await a.competitorDone();
      expect((await provider.getTransactionReceipt(a.broadcasts[0]))!.status).toBe(0);
      expect(r.ok).toBe(false);
      expect(r.error).toBe("request_used_by_other_payer");
      expect(r.paid).toBe(false);
      expect(r.maybePaid).toBeFalsy();
      expect((await a.journal.get("rv4-b"))?.state).toBe("failed");
      expect(ownerBefore - (await vaultBal(victimOwner.address))).toBe(0n); // the owner was not charged
    } finally { await provider.send("evm_setAutomine", [true]); }
  });

  it("(c) the log is visible at head: treated as paid, no retry and no second charge (the key resumes to the competing tx)", async () => {
    const a = await revertedAttempt("own");
    let lagged = true;
    const restore = lagLatestScans(a.client, () => lagged);
    const ownerBefore = await vaultBal(victimOwner.address);
    try {
      const first: any = await a.run("rv4-c");
      expect(first.error).toBe("payment_pending");
      expect(first.maybePaid).toBe(true);
      const competitorTx = await a.competitorDone();
      lagged = false; // the replica caught up: the Paid log is visible to every scan
      const r: any = await a.client.resume("rv4-c");
      expect(r.ok).toBe(true); // the owner's one payment is recognised as this purchase's payment and redeemed
      const rec = await a.journal.get("rv4-c");
      expect(rec?.state).not.toBe("failed");
      expect(rec?.txHash?.toLowerCase()).toBe(competitorTx.toLowerCase());
      expect(a.broadcasts).toHaveLength(1); // no second pay() broadcast
      expect(ownerBefore - (await vaultBal(victimOwner.address))).toBe(PRICE); // charged exactly once
    } finally { restore(); await provider.send("evm_setAutomine", [true]); }
  });
});
