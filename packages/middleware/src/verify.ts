import { Interface, JsonRpcProvider, Log, TransactionReceipt } from "ethers";
import type { PaymentRow } from "./store";

const PAID_IFACE = new Interface([
  "event Paid(address indexed owner, address indexed agent, address indexed merchant, bytes32 requestId, uint256 amount)",
]);

export interface VerifyOptions {
  confirmations: number;
  /** Payment deadline tolerance: a payment mined up to this many seconds after the challenge expiry is accepted (clock skew, mining delay). It does not limit when the proof may be presented. */
  paymentGraceSeconds: number;
  /** Optional payer binding. When set, the Paid log's owner (the funding account) or agent must be in the list. */
  allowedOwners?: ReadonlySet<string>;
  allowedAgents?: ReadonlySet<string>;
}

export type VerifyResult =
  | { kind: "pending"; why: "no_receipt" | "confirmations" | "reorg"; confirmations: number }
  | { kind: "rejected"; reason: string; txRecord?: { payer: string; agent: string; blockNumber: number } }
  | { kind: "ok"; payer: string; agent: string; blockNumber: number; amount: bigint }
  | { kind: "rpc_unavailable" };

/** Runs fn against each provider in order until one answers (NFR-003 failover). */
export async function withFailover<T>(providers: JsonRpcProvider[], fn: (p: JsonRpcProvider) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const p of providers) {
    try {
      return await fn(p);
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("no providers");
}

export async function verifyPayment(providers: JsonRpcProvider[], row: PaymentRow, txHash: string, opts: VerifyOptions): Promise<VerifyResult> {
  type Snapshot = { receipt: TransactionReceipt | null; head: number; chainId: bigint; canonicalHash: string | null; blockTime: number | null };
  let s: Snapshot;
  try {
    // One provider answers every question so receipt, head and block all come from the same view of the chain.
    s = await withFailover(providers, async (p) => {
      const receipt = await p.getTransactionReceipt(txHash);
      const head = await p.getBlockNumber();
      const chainId = (await p.getNetwork()).chainId;
      const block = receipt ? await p.getBlock(receipt.blockNumber) : null;
      return { receipt, head, chainId, canonicalHash: block?.hash ?? null, blockTime: block?.timestamp ?? null };
    });
  } catch {
    return { kind: "rpc_unavailable" };
  }
  const { receipt, head } = s;
  if (s.chainId !== BigInt(row.chainId)) return { kind: "rejected", reason: "wrong_chain" };
  if (!receipt) return { kind: "pending", why: "no_receipt", confirmations: 0 };
  if (receipt.status !== 1) return { kind: "rejected", reason: "tx_failed" };

  // SEC-011: only a log emitted by the configured contract counts; match requestId, merchant, amount.
  const logs = receipt.logs.filter((l: Log) => l.address.toLowerCase() === row.contract.toLowerCase());
  for (const l of logs) {
    let parsed;
    try {
      parsed = PAID_IFACE.parseLog({ topics: [...l.topics], data: l.data });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== "Paid") continue;
    if (String(parsed.args.requestId).toLowerCase() !== row.requestId.toLowerCase()) continue;

    const owner = String(parsed.args.owner);
    const agent = String(parsed.args.agent);
    const rec = { payer: owner, agent, blockNumber: receipt.blockNumber };
    if (String(parsed.args.merchant).toLowerCase() !== row.merchant.toLowerCase()) return { kind: "rejected", reason: "wrong_merchant" };
    if ((parsed.args.amount as bigint) < BigInt(row.priceBase)) return { kind: "rejected", reason: "amount_below_price" };
    if (opts.allowedOwners && !opts.allowedOwners.has(owner.toLowerCase())) return { kind: "rejected", reason: "owner_not_permitted" };
    if (opts.allowedAgents && !opts.allowedAgents.has(agent.toLowerCase())) return { kind: "rejected", reason: "agent_not_permitted" };

    const confirmations = head - receipt.blockNumber + 1;
    if (confirmations < opts.confirmations) return { kind: "pending", why: "confirmations", confirmations };
    // Reorg guard: the receipt's block must still be the canonical block at that height.
    if (s.canonicalHash && s.canonicalHash.toLowerCase() !== receipt.blockHash.toLowerCase()) return { kind: "pending", why: "reorg", confirmations: 0 };
    // The payment deadline is judged on chain time, not on when the proof arrives, so an outage cannot cost a payer their resource.
    if (s.blockTime !== null && s.blockTime > row.expiresAt + opts.paymentGraceSeconds) return { kind: "rejected", reason: "paid_too_late", txRecord: rec };
    return { kind: "ok", payer: owner, agent, blockNumber: receipt.blockNumber, amount: parsed.args.amount as bigint };
  }
  return { kind: "rejected", reason: "no_matching_paid_log" };
}

export interface ReconcileResult { fromBlock: number; toBlock: number; throughTime: number; matched: { requestId: string; txHash: string; blockNumber: number }[] }

/**
 * Scans Paid logs for this merchant on the configured contract between fromBlock and the confirmed head, and returns the
 * ones whose requestId is in `wanted`. This recovers payments that reached the chain while the gateway was down or while
 * the payer never presented a proof. Merchant is an indexed topic, so the query is cheap.
 */
export async function scanPaidLogs(providers: JsonRpcProvider[], contract: string, merchant: string, wanted: Set<string>, fromBlock: number, confirmations: number, chunk = 2000): Promise<ReconcileResult> {
  return withFailover(providers, async (p) => {
    const head = (await p.getBlockNumber()) - (confirmations - 1);
    const matched: ReconcileResult["matched"] = [];
    const topic = PAID_IFACE.getEvent("Paid")!.topicHash;
    const merchantTopic = "0x" + merchant.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    let to = fromBlock - 1;
    for (let from = fromBlock; from <= head; from = to + 1) {
      to = Math.min(head, from + chunk - 1);
      const logs = await p.getLogs({ address: contract, topics: [topic, null, null, merchantTopic], fromBlock: from, toBlock: to });
      for (const l of logs) {
        const parsed = PAID_IFACE.parseLog({ topics: [...l.topics], data: l.data });
        const rid = String(parsed?.args.requestId).toLowerCase();
        if (wanted.has(rid)) matched.push({ requestId: rid, txHash: l.transactionHash.toLowerCase(), blockNumber: l.blockNumber });
      }
    }
    const last = to >= fromBlock ? await p.getBlock(to) : null;
    return { fromBlock, toBlock: to, throughTime: last?.timestamp ?? 0, matched };
  });
}

const PAY_IFACE = new Interface(["function pay(address owner, address merchant, bytes32 requestId, uint256 amount)"]);

/**
 * Best-effort payer (the allowance owner) of a transaction, read from its calldata: `pay(owner, ...)` sent to the configured
 * contract. Used to fill `payer` in x402 settlement responses that fail before a Paid log is available. Null when the
 * transaction is unknown, is not a `pay` call to the contract, or the RPC fails. Never used for authorisation.
 */
export async function payerFromTx(providers: JsonRpcProvider[], contract: string, txHash: string): Promise<string | null> {
  try {
    const tx = await withFailover(providers, (p) => p.getTransaction(txHash));
    if (!tx || !tx.to || tx.to.toLowerCase() !== contract.toLowerCase()) return null;
    const parsed = PAY_IFACE.parseTransaction({ data: tx.data });
    return parsed ? String(parsed.args.owner) : null;
  } catch {
    return null;
  }
}
