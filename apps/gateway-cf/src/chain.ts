// Read-only JSON-RPC. No signing key exists in this Worker.

export const PAID_TOPIC = "0xd73367c4ebfa158722b9021d70c4839ada0c4df8226284f44b29706a1558fe50"; // Paid(address,address,address,bytes32,uint256)
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const IS_USED = "0xa322b53c"; // isUsed(address,bytes32); CF-24 depends on it

export class ChainUnavailable extends Error {}

export interface Log { address: string; topics: string[]; data: string; blockNumber: string; blockHash: string; transactionHash: string; removed?: boolean }
interface Receipt { status: string; blockNumber: string; blockHash: string; transactionHash: string; logs: Log[] }
interface Block { number: string; hash: string; timestamp: string; transactions: string[] }

export interface ChainConfig { urls: string[]; chainId: number; contract: string; merchant: string; confirmations: number; graceSeconds: number }

const lc = (s: string) => s.toLowerCase();
const num = (h: unknown): number => {
  if (typeof h !== "string" || !/^0x[0-9a-fA-F]{1,14}$/.test(h)) throw new ChainUnavailable("malformed number");
  return Number(BigInt(h));
};
export const topicAddress = (a: string) => "0x" + lc(a).slice(2).padStart(64, "0");
const addressOf = (topic: string) => "0x" + topic.slice(-40);

/** One endpoint's view of the chain. Every answer used for one decision comes from one endpoint. */
export class Rpc {
  constructor(readonly url: string, private signal?: AbortSignal) {}
  async call<T>(method: string, params: unknown[]): Promise<T> {
    let body: { result?: T; error?: unknown };
    try {
      const timeout = AbortSignal.timeout(8_000);
      const res = await fetch(this.url, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
      });
      if (!res.ok) { await res.body?.cancel(); throw new ChainUnavailable(`HTTP ${res.status}`); }
      body = await res.json();
    } catch (e) {
      throw e instanceof ChainUnavailable ? e : new ChainUnavailable("unreachable");
    }
    if (typeof body !== "object" || body === null || body.error || !("result" in body)) throw new ChainUnavailable("rpc error");
    return body.result as T;
  }
  chainId = async () => num(await this.call<string>("eth_chainId", []));
  head = async () => num(await this.call<string>("eth_blockNumber", []));
  block = (n: number | "latest") => this.call<Block | null>("eth_getBlockByNumber", [n === "latest" ? n : "0x" + n.toString(16), false]);
  logs = (f: { address: string; topics: (string | null)[]; from: number; to: number }) =>
    this.call<Log[]>("eth_getLogs", [{ address: f.address, topics: f.topics, fromBlock: "0x" + f.from.toString(16), toBlock: "0x" + f.to.toString(16) }]);
}

/** Runs fn against each endpoint in order until one answers. An endpoint on another chain counts as not answering. */
export async function withFailover<T>(c: { urls: string[]; chainId: number }, fn: (rpc: Rpc) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let last: unknown;
  for (const url of c.urls) {
    const rpc = new Rpc(url, signal);
    try {
      if ((await rpc.chainId()) !== c.chainId) throw new ChainUnavailable("wrong chain");
      return await fn(rpc);
    } catch (e) {
      if (!(e instanceof ChainUnavailable)) throw e;
      last = e;
    }
  }
  throw last ?? new ChainUnavailable("no endpoints");
}

export interface Payer { payer: string; agent: string; blockNumber: number }
export type Verdict =
  | { kind: "pending"; why: "no_receipt" | "confirmations" | "reorg" | "behind"; confirmations: number }
  | { kind: "rejected"; reason: string; late?: Payer }
  | ({ kind: "ok" } & Payer)
  | { kind: "rpc_unavailable" };

export interface Expected { requestId: string; merchant: string; contract: string; priceBase: string; expiresAt: number }

export function decodePaid(l: Log): { owner: string; agent: string; merchant: string; requestId: string; amount: bigint } | null {
  if (!Array.isArray(l.topics) || l.topics.length !== 4 || lc(l.topics[0]!) !== PAID_TOPIC || !/^0x[0-9a-fA-F]{128}$/.test(l.data)) return null;
  return { owner: addressOf(l.topics[1]!), agent: addressOf(l.topics[2]!), merchant: addressOf(l.topics[3]!), requestId: lc(l.data.slice(0, 66)), amount: BigInt("0x" + l.data.slice(66)) };
}

/** Decides whether txHash pays this exact challenge. Mirrors packages/middleware/src/verify.ts. */
export async function verifyPayment(c: ChainConfig, row: Expected, txHash: string): Promise<Verdict> {
  let s: { receipt: Receipt | null; head: number; block: Block | null };
  try {
    s = await withFailover(c, async (rpc) => {
      const receipt = await rpc.call<Receipt | null>("eth_getTransactionReceipt", [txHash]);
      const head = await rpc.head();
      return { receipt, head, block: receipt ? await rpc.block(num(receipt.blockNumber)) : null };
    });
  } catch (e) {
    if (e instanceof ChainUnavailable) return { kind: "rpc_unavailable" };
    throw e;
  }
  const { receipt, head, block } = s;
  if (!receipt) return { kind: "pending", why: "no_receipt", confirmations: 0 };
  if (lc(receipt.transactionHash) !== lc(txHash) || !Array.isArray(receipt.logs)) return { kind: "rpc_unavailable" };
  const height = num(receipt.blockNumber);
  // A receipt from a block this endpoint no longer considers canonical proves nothing, in either direction.
  if (!block || lc(block.hash) !== lc(receipt.blockHash)) return { kind: "pending", why: "reorg", confirmations: 0 };
  if (receipt.status !== "0x1") return { kind: "rejected", reason: "tx_failed" };

  for (const l of receipt.logs) {
    if (lc(l.address) !== lc(row.contract) || l.removed === true) continue; // only the configured vault counts
    const p = decodePaid(l);
    if (!p || p.requestId !== lc(row.requestId)) continue;
    const who: Payer = { payer: p.owner, agent: p.agent, blockNumber: height };
    if (p.merchant !== lc(row.merchant)) return { kind: "rejected", reason: "wrong_merchant" };
    if (p.amount < BigInt(row.priceBase)) return { kind: "rejected", reason: "amount_below_price" };
    const confirmations = head - height + 1;
    if (confirmations < 1) return { kind: "pending", why: "behind", confirmations: 0 };
    if (confirmations < c.confirmations) return { kind: "pending", why: "confirmations", confirmations };
    // Chain time, not arrival time: an outage must not cost a payer what they paid for in time.
    if (num(block.timestamp) > row.expiresAt + c.graceSeconds) return { kind: "rejected", reason: "paid_too_late", late: who };
    return { kind: "ok", ...who };
  }
  return { kind: "rejected", reason: "no_matching_paid_log" };
}

/** Has (merchant, requestId) been paid on chain? Used when this gateway has no record of a request. */
export async function isUsedOnChain(c: ChainConfig, requestId: string): Promise<boolean> {
  return withFailover(c, async (rpc) => {
    const r = await rpc.call<string>("eth_call", [{ to: c.contract, data: IS_USED + topicAddress(c.merchant).slice(2) + requestId.slice(2) }, "latest"]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(r)) throw new ChainUnavailable("malformed call result");
    return BigInt(r) === 1n;
  });
}

export interface FoundPayment { requestId: string; txHash: string; blockNumber: number; payer: string; agent: string; amountBase: string }

/** Paid logs for this merchant from a block to the confirmed head, in bounded steps. */
export async function scanPaid(c: ChainConfig, from: number, maxChunks = 12, chunk = 2000): Promise<{ found: FoundPayment[]; toBlock: number; throughTime: number; complete: boolean }> {
  return withFailover(c, async (rpc) => {
    const head = (await rpc.head()) - (c.confirmations - 1);
    const found: FoundPayment[] = [];
    let to = from - 1;
    for (let i = 0, f = from; i < maxChunks && f <= head; i++, f = to + 1) {
      to = Math.min(head, f + chunk - 1);
      for (const l of await rpc.logs({ address: c.contract, topics: [PAID_TOPIC, null, null, topicAddress(c.merchant)], from: f, to })) {
        const p = decodePaid(l);
        if (p && l.removed !== true && lc(l.address) === lc(c.contract)) found.push({ requestId: p.requestId, txHash: lc(l.transactionHash), blockNumber: num(l.blockNumber), payer: p.owner, agent: p.agent, amountBase: p.amount.toString() });
      }
    }
    const last = to >= from ? await rpc.block(to) : null;
    return { found, toBlock: to, throughTime: last ? num(last.timestamp) : 0, complete: to >= head };
  });
}
