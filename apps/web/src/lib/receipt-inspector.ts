import { Interface } from "ethers";
import { ALLOWANCE_ABI } from "./abi";
import { config } from "./config";
import { ReadError, rpcRead, withFailover } from "./rpc";

const PAID = new Interface(ALLOWANCE_ABI as unknown as string[]);
const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x[0-9a-fA-F]{1,14}$/;

/** The gateway's default. Fewer confirmations than this are shown as settling, never as settled. */
export const SETTLED_CONFIRMATIONS = 2;
/** A latest block older than this means the RPC is behind, so the confirmation count is only a lower bound. */
export const STALE_HEAD_SECONDS = 180;

export function isTransactionHash(value: string): boolean {
  return HEX_32.test(value);
}

export type ChainInspection =
  | { kind: "not_found"; hash: string }
  | { kind: "pending"; hash: string }
  | { kind: "reverted"; hash: string; blockNumber: number }
  | { kind: "not_turnspike"; hash: string; blockNumber: number }
  | { kind: "uncertain"; hash: string; reason: string }
  | { kind: "paid"; hash: string; blockNumber: number; confirmations: number; settled: boolean; headAgeSeconds: number; owner: string; agent: string; merchant: string; requestId: string; amountBase: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const quantity = (v: unknown): number => {
  if (typeof v !== "string" || !QUANTITY.test(v)) throw new ReadError("The QIE RPC returned a malformed number. Nothing was verified.");
  return Number(BigInt(v));
};

/**
 * Reads one transaction from the configured RPC and decides whether it contains exactly one Paid event emitted by the
 * configured vault, in a block this RPC considers canonical. Read-only; it says nothing about delivery.
 */
export async function inspectTransaction(input: string, signal?: AbortSignal): Promise<ChainInspection> {
  const hash = input.trim();
  if (!isTransactionHash(hash)) throw new ReadError("Enter a complete transaction hash: 0x followed by 64 hexadecimal characters.");
  return withFailover(config.rpcUrls, (url) => inspectAt(url, hash, signal));
}

async function inspectAt(url: string, hash: string, signal?: AbortSignal): Promise<ChainInspection> {

  // Configuration is not evidence: ask the endpoint which chain it actually serves.
  const served = quantity(await rpcRead(url, "eth_chainId", [], signal));
  if (served !== config.chainId) throw new ReadError(`The RPC answered for chain ${served}, not ${config.chainId}. Nothing it returns can be trusted here.`);

  const receipt = await rpcRead(url, "eth_getTransactionReceipt", [hash], signal);
  if (receipt === null) {
    const known = await rpcRead(url, "eth_getTransactionByHash", [hash], signal);
    return { kind: isObj(known) && same(known.hash, hash) ? "pending" : "not_found", hash };
  }
  if (!isObj(receipt) || !same(receipt.transactionHash, hash) || typeof receipt.blockHash !== "string" || !Array.isArray(receipt.logs)) {
    return { kind: "uncertain", hash, reason: "The RPC returned a receipt that does not match this transaction hash." };
  }
  const { blockHash, logs } = receipt;
  const blockNumber = quantity(receipt.blockNumber);

  // Canonical checks come before any verdict, including "reverted": a receipt from an orphaned block proves nothing.
  const [block, head] = await Promise.all([
    rpcRead(url, "eth_getBlockByNumber", ["0x" + blockNumber.toString(16), false], signal),
    rpcRead(url, "eth_getBlockByNumber", ["latest", false], signal),
  ]);
  if (!isObj(head)) return { kind: "uncertain", hash, reason: "The RPC did not return its latest block." };
  const headNumber = quantity(head.number);
  if (headNumber < blockNumber) return { kind: "uncertain", hash, reason: "The RPC's latest block is behind the transaction's block." };
  if (!isObj(block) || !same(block.hash, blockHash)) {
    return { kind: "uncertain", hash, reason: "The transaction's block is not the canonical block returned by this RPC. Recheck later or use another RPC." };
  }

  if (receipt.status === "0x0") return { kind: "reverted", hash, blockNumber };
  if (receipt.status !== "0x1") return { kind: "uncertain", hash, reason: "The receipt does not say whether the transaction succeeded." };

  const matches = logs.flatMap((log: unknown) => {
    if (!isObj(log) || log.removed === true || !same(log.address, config.allowance) || !same(log.transactionHash, hash) || !same(log.blockHash, blockHash)) return [];
    if (!Array.isArray(log.topics) || typeof log.data !== "string") return [];
    try {
      const parsed = PAID.parseLog({ topics: log.topics as string[], data: log.data });
      return parsed?.name === "Paid" ? [parsed] : [];
    } catch { return []; }
  });
  if (matches.length === 0) return { kind: "not_turnspike", hash, blockNumber };
  if (matches.length !== 1) return { kind: "uncertain", hash, reason: "More than one Turnspike Paid event appeared in this transaction. Inspect the event logs on the explorer." };

  const args = matches[0].args;
  const confirmations = headNumber - blockNumber + 1;
  return {
    kind: "paid", hash, blockNumber, confirmations, settled: confirmations >= SETTLED_CONFIRMATIONS,
    headAgeSeconds: Math.max(0, Math.floor(Date.now() / 1000) - quantity(head.timestamp)),
    owner: String(args.owner), agent: String(args.agent), merchant: String(args.merchant),
    requestId: String(args.requestId), amountBase: String(args.amount),
  };
}
