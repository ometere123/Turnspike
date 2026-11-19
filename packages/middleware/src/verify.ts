import { Interface, JsonRpcProvider, Log, TransactionReceipt } from "ethers";
import type { PaymentRow } from "./store";

const PAID_IFACE = new Interface([
  "event Paid(address indexed owner, address indexed agent, address indexed merchant, bytes32 requestId, uint256 amount)",
]);

export type VerifyResult =
  | { kind: "pending"; why: "no_receipt" | "confirmations"; confirmations: number }
  | { kind: "rejected"; reason: string }
  | { kind: "ok"; payer: string; blockNumber: number; amount: bigint }
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

export async function verifyPayment(
  providers: JsonRpcProvider[],
  row: PaymentRow,
  txHash: string,
  confirmationsRequired: number,
): Promise<VerifyResult> {
  let receipt: TransactionReceipt | null;
  let head: number;
  let chainId: bigint;
  try {
    ({ receipt, head, chainId } = await withFailover(providers, async (p) => ({
      receipt: await p.getTransactionReceipt(txHash),
      head: await p.getBlockNumber(),
      chainId: (await p.getNetwork()).chainId,
    })));
  } catch {
    return { kind: "rpc_unavailable" };
  }
  if (chainId !== BigInt(row.chainId)) return { kind: "rejected", reason: "wrong_chain" };
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
    if (String(parsed.args.merchant).toLowerCase() !== row.merchant.toLowerCase()) return { kind: "rejected", reason: "wrong_merchant" };
    if ((parsed.args.amount as bigint) < BigInt(row.priceBase)) return { kind: "rejected", reason: "amount_below_price" };
    const confirmations = head - receipt.blockNumber + 1;
    if (confirmations < confirmationsRequired) return { kind: "pending", why: "confirmations", confirmations };
    return { kind: "ok", payer: String(parsed.args.owner), blockNumber: receipt.blockNumber, amount: parsed.args.amount as bigint };
  }
  return { kind: "rejected", reason: "no_matching_paid_log" };
}
