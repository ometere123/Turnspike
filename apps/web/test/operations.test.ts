import { Interface } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWANCE_ABI } from "../src/lib/abi";
import { config } from "../src/lib/config";
import { assessHealth, correlate, lookupDelivery, stateTone } from "../src/lib/delivery";
import { gateway } from "../src/lib/gateway";
import { inspectTransaction, type ChainInspection } from "../src/lib/receipt-inspector";
import { isHexAddress } from "../src/lib/address";

const HASH = "0x" + "a1".repeat(32), BLOCK = "0x" + "b2".repeat(32), ID = "0x" + "c3".repeat(32), OTHER = "0x" + "d4".repeat(32);
const A = (n: string) => "0x" + n.repeat(40);
const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);
const paidLog = (over: Record<string, unknown> = {}) => {
  const e = iface.encodeEventLog("Paid", [A("1"), A("2"), A("3"), ID, 1000n]);
  return { address: config.allowance, topics: e.topics, data: e.data, transactionHash: HASH, blockHash: BLOCK, removed: false, ...over };
};
const now = () => "0x" + Math.floor(Date.now() / 1000).toString(16);
let chain: Record<string, unknown>;
beforeEach(() => {
  chain = {
    eth_chainId: "0x" + config.chainId.toString(16),
    eth_getTransactionReceipt: { transactionHash: HASH, blockHash: BLOCK, blockNumber: "0x64", status: "0x1", logs: [paidLog()] },
    eth_getTransactionByHash: null,
    block: { hash: BLOCK, number: "0x64", timestamp: now() },
    latest: { hash: OTHER, number: "0x6e", timestamp: now() },
  };
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
    const q = JSON.parse(String(init.body));
    const result = q.method === "eth_getBlockByNumber" ? chain[q.params[0] === "latest" ? "latest" : "block"] : chain[q.method];
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const receipt = (over: object) => { chain.eth_getTransactionReceipt = { ...(chain.eth_getTransactionReceipt as object), ...over }; };

describe("receipt inspector", () => {
  it("OPS-1 accepts exactly one Paid event from the configured vault in a canonical block", async () => {
    expect(await inspectTransaction(HASH)).toMatchObject({ kind: "paid", confirmations: 11, settled: true, requestId: ID, amountBase: "1000", merchant: A("3") });
  });
  it("OPS-2 one confirmation is reported but not settled", async () => {
    chain.latest = { hash: BLOCK, number: "0x64", timestamp: now() };
    expect(await inspectTransaction(HASH)).toMatchObject({ kind: "paid", confirmations: 1, settled: false });
  });
  it("OPS-3 reports the age of the RPC's head", async () => {
    chain.latest = { hash: OTHER, number: "0x6e", timestamp: "0x" + (Math.floor(Date.now() / 1000) - 3600).toString(16) };
    const r = await inspectTransaction(HASH);
    expect(r.kind === "paid" && r.headAgeSeconds).toBeGreaterThan(3500);
  });
  it("OPS-4 wrong chain, malformed numbers, RPC errors and HTTP failures throw; none becomes a verdict", async () => {
    chain.eth_chainId = "0x1";
    await expect(inspectTransaction(HASH)).rejects.toThrow("chain 1, not");
    chain.eth_chainId = "1990";
    await expect(inspectTransaction(HASH)).rejects.toThrow("malformed number");
    for (const [res, text] of [[() => Response.json({ error: { code: 1 } }), "refused"], [() => new Response("x", { status: 200 }), "unreadable"], [() => Response.json({}), "incomplete"], [() => new Response("", { status: 429 }), "rate limiting"], [() => new Response("", { status: 502 }), "HTTP 502"], [() => { throw new TypeError("Failed to fetch"); }, "could not be reached"]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => res()));
      await expect(inspectTransaction(HASH)).rejects.toThrow(text);
    }
  });
  it("OPS-5 a stalled RPC times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, i: RequestInit) => new Promise((_r, rej) => i.signal!.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))))));
    const p = expect(inspectTransaction(HASH)).rejects.toThrow("did not answer in time");
    await vi.advanceTimersByTimeAsync(13_000);
    await p;
  });
  it("OPS-6 null receipt: pending when the node knows the transaction, otherwise not found", async () => {
    chain.eth_getTransactionReceipt = null;
    expect((await inspectTransaction(HASH)).kind).toBe("not_found");
    chain.eth_getTransactionByHash = { hash: HASH };
    expect((await inspectTransaction(HASH)).kind).toBe("pending");
    chain.eth_getTransactionByHash = { hash: OTHER };
    expect((await inspectTransaction(HASH)).kind).toBe("not_found");
  });
  it("OPS-7 canonical checks come first: a reverted receipt in a replaced block is uncertain, not reverted", async () => {
    receipt({ status: "0x0" });
    expect((await inspectTransaction(HASH)).kind).toBe("reverted");
    chain.block = { hash: OTHER, number: "0x64", timestamp: now() };
    expect((await inspectTransaction(HASH)).kind).toBe("uncertain");
    chain.block = null;
    expect((await inspectTransaction(HASH)).kind).toBe("uncertain");
  });
  it("OPS-8 a lagging head, a missing status and a receipt for another hash are uncertain", async () => {
    chain.latest = { hash: OTHER, number: "0x63", timestamp: now() };
    expect((await inspectTransaction(HASH)).kind).toBe("uncertain");
    chain.latest = { hash: OTHER, number: "0x6e", timestamp: now() };
    receipt({ status: undefined });
    expect((await inspectTransaction(HASH)).kind).toBe("uncertain");
    receipt({ status: "0x1", transactionHash: OTHER });
    expect((await inspectTransaction(HASH)).kind).toBe("uncertain");
  });
  it("OPS-9 other contracts, removed logs, logs of another transaction and undecodable logs never count; two events are uncertain", async () => {
    for (const over of [{ address: A("9") }, { removed: true }, { transactionHash: OTHER }, { blockHash: OTHER }, { data: "0x" }, { topics: null }]) {
      receipt({ logs: [paidLog(over)] });
      expect((await inspectTransaction(HASH)).kind, JSON.stringify(over)).toBe("not_turnspike");
    }
    receipt({ logs: [paidLog(), paidLog()] });
    expect((await inspectTransaction(HASH)).kind).toBe("uncertain");
  });
});

const paid = (over = {}): ChainInspection => ({ kind: "paid", hash: HASH, blockNumber: 100, confirmations: 11, settled: true, headAgeSeconds: 1, owner: A("1"), agent: A("2"), merchant: A("3"), requestId: ID, amountBase: "1000", ...over });
const rec = (over = {}) => ({ requestId: ID, state: "DELIVERED", txHash: HASH as string | null, expiresAt: 1, ...over });

describe("gateway correlation and status", () => {
  it("OPS-10 only an exact, settled match on both identifiers is success", () => {
    expect(correlate(paid(), rec())?.tone).toBe("success");
    expect(correlate(paid(), rec({ requestId: ID.toUpperCase().replace("0X", "0x") }))?.tone).toBe("success");
    expect(correlate(paid(), rec({ txHash: OTHER }))?.tone).toBe("danger");
    expect(correlate(paid(), rec({ requestId: OTHER }))?.tone).toBe("danger");
    expect(correlate(paid(), rec({ requestId: OTHER, txHash: null }))?.tone).toBe("danger");
    expect(correlate(paid(), rec({ txHash: null }))?.tone).toBe("warn");
    expect(correlate(paid({ settled: false }), rec())?.tone).toBe("warn");
    for (const state of ["PAID_CONFIRMED", "DELIVERING", "REJECTED", "SOMETHING_NEW"]) expect(correlate(paid(), rec({ state }))?.tone).toBe("warn");
    expect(correlate({ kind: "reverted", hash: HASH, blockNumber: 1 }, rec())).toBeNull();
  });
  it("OPS-11 an unknown state is neutral", () => { expect(stateTone("SOMETHING_NEW")).toBe("neutral"); });
  it("OPS-12 delivery lookups refuse malformed records and say what failed", async () => {
    for (const [res, text] of [[() => new Response("", { status: 404 }), "no matching"], [() => new Response("", { status: 429 }), "rate limiting"], [() => new Response("", { status: 500 }), "HTTP 500"], [() => Response.json({ state: 1 }), "unexpected"], [() => Response.json({ state: "DELIVERED", txHash: "0x1" }), "malformed"], [() => { throw new TypeError("x"); }, "could not be reached"]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => res()));
      await expect(lookupDelivery(ID)).rejects.toThrow(text);
    }
    await expect(lookupDelivery("0x12")).rejects.toThrow("request ID");
  });
  const good = { chainId: config.chainId, contract: config.allowance, token: config.qusdc } as any;
  const stats = { delivered: 5 } as any;
  it("OPS-13 health: a different vault is an error, unknown statistics stay unknown, unreachable is not unhealthy", () => {
    expect(assessHealth({ ok: true, data: { ok: true } }, { ok: true, data: good }, { ok: true, data: stats })).toMatchObject({ gateway: { tone: "success" }, network: { tone: "success" }, delivered: 5, problem: null });
    expect(assessHealth({ ok: true, data: { ok: true } }, { ok: true, data: { ...good, contract: A("9") } }, { ok: true, data: stats }).network.tone).toBe("danger");
    expect(assessHealth({ ok: true, data: { ok: true } }, { ok: true, data: good }, { ok: true, data: { delivered: "5" } as any }).delivered).toBeNull();
    expect(assessHealth({ ok: false, error: "x", status: 503 }, { ok: false, error: "x" }, { ok: false, error: "x" }).gateway.label).toBe("Responding, not healthy");
    expect(assessHealth({ ok: false, error: "x" }, { ok: false, error: "x" }, { ok: false, error: "x" }).gateway.label).toBe("Unreachable");
  });
  it("OPS-14 an empty or non-JSON 200, and a 402 on a free route, are not data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    expect((await gateway.config()).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "payment_required" }, { status: 402 })));
    expect((await gateway.stats()).ok).toBe(false);
    expect((await gateway.probe()).ok).toBe(true);
  });
});

describe("address rule for contract calls", () => {
  it("OPS-15 only plain 0x addresses with a valid checksum pass", () => {
    expect(isHexAddress(config.merchant)).toBe(true);
    expect(isHexAddress(config.merchant.toLowerCase())).toBe(true);
    for (const bad of [config.merchant.slice(2), "XE7338O073KYGTWWZN0F2WZ0R8PX5ZPPZS", "0x12", "", config.merchant.replace("D", "d")]) expect(isHexAddress(bad), bad).toBe(false);
  });
});
