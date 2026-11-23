import { Interface, JsonRpcProvider } from "ethers";
import { ALLOWANCE_ABI } from "./abi";
import { config } from "./config";

const PAID = new Interface(ALLOWANCE_ABI as unknown as string[]);
const HEX_32 = /^0x[0-9a-fA-F]{64}$/;

export function isTransactionHash(value: string): boolean {
  return HEX_32.test(value);
}

export type ChainInspection =
  | { kind: "not_found"; hash: string }
  | { kind: "reverted"; hash: string; blockNumber: number }
  | { kind: "not_turnspike"; hash: string; blockNumber: number }
  | { kind: "uncertain"; hash: string; reason: string }
  | { kind: "paid"; hash: string; blockNumber: number; confirmations: number; owner: string; agent: string; merchant: string; requestId: string; amountBase: string };

export async function inspectTransaction(input: string): Promise<ChainInspection> {
  const hash = input.trim();
  if (!isTransactionHash(hash)) throw new Error("Enter a 0x transaction hash followed by 64 hexadecimal characters.");
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true, cacheTimeout: -1 });
  try {
    // The static provider's configured chainId is NOT evidence that the remote RPC serves that chain.
    const chain = await provider.send("eth_chainId", []);
    if (BigInt(chain) !== BigInt(config.chainId)) throw new Error("The RPC returned a different network; no result can be trusted.");
    const receipt = await provider.getTransactionReceipt(hash);
    if (!receipt) return { kind: "not_found", hash };
    if (receipt.status !== 1) return { kind: "reverted", hash, blockNumber: receipt.blockNumber };

    const matches = receipt.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== config.allowance.toLowerCase()) return [];
      try {
        const parsed = PAID.parseLog({ topics: log.topics, data: log.data });
        return parsed?.name === "Paid" ? [parsed] : [];
      } catch { return []; }
    });
    if (matches.length === 0) return { kind: "not_turnspike", hash, blockNumber: receipt.blockNumber };
    if (matches.length !== 1) return { kind: "uncertain", hash, reason: "More than one Turnspike Paid event appeared in this transaction. Inspect the event logs on the explorer." };

    const [canonical, head] = await Promise.all([
      provider.getBlock(receipt.blockNumber), provider.getBlockNumber(),
    ]);
    if (!canonical || !canonical.hash || canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      return { kind: "uncertain", hash, reason: "The transaction's block is not the canonical block returned by this RPC. Recheck later or use another RPC." };
    }
    if (head < receipt.blockNumber) return { kind: "uncertain", hash, reason: "The RPC's latest block is behind the transaction's block." };

    const args = matches[0].args;
    return {
      kind: "paid", hash, blockNumber: receipt.blockNumber, confirmations: head - receipt.blockNumber + 1,
      owner: String(args.owner), agent: String(args.agent), merchant: String(args.merchant),
      requestId: String(args.requestId), amountBase: String(args.amount),
    };
  } finally {
    provider.destroy();
  }
}
