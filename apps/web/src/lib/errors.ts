import { Interface } from "ethers";
import { ALLOWANCE_ABI, ERROR_TEXT } from "./abi";

const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);

export type FailureKind = "rejected" | "insufficient-gas" | "contract" | "network" | "unknown";

/** Turns wallet, RPC and contract errors into text a person can act on. */
export function describeError(e: any): { kind: FailureKind; message: string } {
  const code = e?.code ?? e?.info?.error?.code;
  if (code === 4001 || code === "ACTION_REJECTED" || /user (rejected|denied)/i.test(String(e?.message))) {
    return { kind: "rejected", message: "You rejected the request in your wallet. Nothing was sent." };
  }
  if (code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(String(e?.shortMessage ?? e?.message))) {
    return { kind: "insufficient-gas", message: "Not enough QIE in this wallet to pay for gas." };
  }
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === "string" && data.startsWith("0x")) {
    try {
      const p = iface.parseError(data);
      if (p) return { kind: "contract", message: ERROR_TEXT[p.name] ?? p.name };
    } catch { /* not one of ours */ }
  }
  if (code === "NETWORK_ERROR" || code === "TIMEOUT" || /network|timeout|failed to fetch/i.test(String(e?.message))) {
    return { kind: "network", message: "The QIE RPC did not respond. Check your connection and try again." };
  }
  if (code === "CALL_EXCEPTION" || /revert/i.test(String(e?.shortMessage ?? e?.message))) {
    return { kind: "contract", message: "The contract rejected this transaction." };
  }
  return { kind: "unknown", message: String(e?.shortMessage ?? e?.message ?? "Something went wrong.") };
}
