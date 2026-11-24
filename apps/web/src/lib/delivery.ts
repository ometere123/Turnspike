import { config } from "./config";
import type { GatewayConfig, GatewayStats, Result } from "./gateway";
import { isTransactionHash, type ChainInspection } from "./receipt-inspector";
import { ReadError } from "./rpc";

export type Tone = "neutral" | "success" | "warn" | "danger";
export interface DeliveryRecord { requestId: string; state: string; txHash: string | null; expiresAt: number }

const REQUEST_ID = /^0x[0-9a-fA-F]{64}$/;
export const isRequestId = (v: string) => REQUEST_ID.test(v);

/** Reads the gateway's status-only record for one request. Throws ReadError with a message written for the page. */
export async function lookupDelivery(requestId: string, signal?: AbortSignal, timeoutMs = 10_000): Promise<DeliveryRecord> {
  if (!isRequestId(requestId)) throw new ReadError("Enter a request ID: 0x followed by 64 hexadecimal characters.");
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const r = await fetch(`${config.gatewayUrl}/v1/payments/${requestId}`, { method: "GET", cache: "no-store", signal: ctl.signal });
    if (r.status === 404) throw new ReadError("This gateway has no matching request record. That does not establish whether a transaction settled.");
    if (r.status === 429) throw new ReadError("The gateway is rate limiting this connection. Its delivery state is unknown; try again in a minute.");
    if (!r.ok) throw new ReadError(`The gateway answered HTTP ${r.status}. Its delivery state is unknown.`);
    const data: unknown = await r.json().catch(() => null);
    if (typeof data !== "object" || data === null || !("state" in data) || typeof data.state !== "string" || data.state === "") {
      throw new ReadError("The gateway returned an unexpected status record. Its delivery state is unknown.");
    }
    const rec = data as Record<string, unknown>;
    const tx = rec.txHash ?? null;
    if (tx !== null && (typeof tx !== "string" || !isTransactionHash(tx))) {
      throw new ReadError("The gateway's transaction reference was malformed. Its delivery state is unknown.");
    }
    return { requestId, state: data.state, txHash: tx, expiresAt: typeof rec.expiresAt === "number" && Number.isFinite(rec.expiresAt) ? rec.expiresAt : 0 };
  } catch (e) {
    if (e instanceof ReadError || signal?.aborted) throw e;
    throw new ReadError(timedOut ? "The gateway did not answer in time. Its delivery state is unknown." : "The gateway could not be reached. Its delivery state is unknown.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export function stateMeaning(state: string): string {
  switch (state) {
    case "DELIVERED": return "The gateway records a stored response for this request. This is a gateway claim, not an on-chain delivery proof.";
    case "PAID_CONFIRMED": return "The gateway has confirmed payment; response delivery has not been recorded.";
    case "PAID_PENDING": return "Payment evidence is pending verification or confirmations.";
    case "DELIVERING": return "A worker is delivering the resource, or may need a retry after its lease expires.";
    case "ISSUED": return "A price challenge was issued, but this does not prove payment.";
    case "EXPIRED": return "The challenge expired without a confirmed payment in this gateway record.";
    case "REJECTED": return "The gateway rejected the payment proof. Check the original challenge and receipt.";
    default: return "This page does not know that gateway state, so it draws no conclusion from it.";
  }
}

export function stateTone(state: string): Tone {
  if (state === "DELIVERED") return "success";
  if (state === "REJECTED" || state === "EXPIRED") return "danger";
  if (state === "PAID_PENDING" || state === "DELIVERING" || state === "PAID_CONFIRMED") return "warn";
  return "neutral";
}

/** Compares an inspected Paid event with a gateway record. Only an exact match on both identifiers can be "success". */
export function correlate(tx: ChainInspection | null, d: DeliveryRecord | null): { tone: Tone; text: string } | null {
  if (tx?.kind !== "paid" || !d) return null;
  const sameId = d.requestId.toLowerCase() === tx.requestId.toLowerCase();
  const sameHash = d.txHash !== null && d.txHash.toLowerCase() === tx.hash.toLowerCase();
  if (!sameId) {
    return { tone: "danger", text: sameHash
      ? "Mismatch: the gateway links this transaction to a different request ID than the one in the Paid event. Do not treat these as one payment."
      : "Mismatch: this request ID is not the one in the Paid event above. These are two different payments." };
  }
  if (d.txHash === null) return { tone: "warn", text: "The request ID matches, but the gateway has not recorded a transaction for it, so the two records cannot be correlated yet." };
  if (!sameHash) return { tone: "danger", text: "Mismatch: the gateway recorded a different transaction for this request ID. Do not treat these as one payment." };
  if (!tx.settled) return { tone: "warn", text: "Both records refer to the same transaction, but it does not have enough confirmations yet." };
  if (d.state === "DELIVERED") return { tone: "success", text: "The Paid event and the gateway record agree on the request ID and the transaction. The gateway reports delivery; that part is the gateway's own claim." };
  return { tone: "warn", text: "Both records refer to the same transaction, but the gateway does not report completed delivery." };
}

export interface HealthView {
  gateway: { tone: Tone; label: string };
  network: { tone: Tone; label: string; note: string };
  delivered: number | null;
  problem: string | null;
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** Turns the three free gateway reads into what the page may honestly show. Anything unknown stays unknown. */
export function assessHealth(h: Result<{ ok: boolean }>, c: Result<GatewayConfig>, s: Result<GatewayStats>): HealthView {
  const delivered = s.ok ? count(s.data.delivered) : null;
  const gateway: HealthView["gateway"] = h.ok && h.data.ok === true ? { tone: "success", label: "Responding" }
    : h.ok || h.status !== undefined ? { tone: "danger", label: "Responding, not healthy" }
    : { tone: "danger", label: "Unreachable" };
  let network: HealthView["network"] = { tone: "neutral", label: "Unavailable", note: "The gateway's configuration could not be read." };
  if (c.ok) {
    const wrong = [
      Number(c.data.chainId) !== config.chainId && "chain ID",
      String(c.data.contract).toLowerCase() !== config.allowance.toLowerCase() && "vault address",
      String(c.data.token).toLowerCase() !== config.qusdc.toLowerCase() && "token address",
    ].filter(Boolean);
    network = wrong.length
      ? { tone: "danger", label: "Configuration mismatch", note: `The gateway's ${wrong.join(" and ")} differ from this site's. Do not pay it until that is explained.` }
      : { tone: "success", label: `QIE, chain ${config.chainId}`, note: "The gateway reports the same chain, vault and token as this site. Gateway-reported, not a chain read." };
  }
  const failed = [
    !h.ok && `health (${h.error})`, !c.ok && `configuration (${c.error})`, !s.ok && `statistics (${s.error})`,
    s.ok && delivered === null && "statistics (unexpected format)",
  ].filter(Boolean);
  return { gateway, network, delivered, problem: failed.length ? `Not available: ${failed.join(", ")}. No values were substituted.` : null };
}
