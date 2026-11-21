import { getAddress } from "ethers";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import type { ProofOutcome, TurnspikeMiddleware } from "@turnspike-qie/middleware";
import {
  ASSET_TRANSFER_METHOD, DYNAMIC_EXTRA, ErrorCodes, PAYMENT_FLOW, SCHEME, TURNSPIKE_PROTOCOL, errorForProofCode, paymentPayloadSchema, requirementsSchema,
  type TurnspikePaymentPayload,
} from "../common";

/** The part of a turnspike middleware instance the facilitator uses: its configuration, proof checks and logger. */
export type SettlementBackend = Pick<TurnspikeMiddleware, "info" | "settleProof" | "checkProof" | "payerOf" | "log">;

const lc = (s: string) => s.toLowerCase();

type Checked =
  | { ok: true; payload: TurnspikePaymentPayload; resourceId: string }
  | { ok: false; reason: string; message?: string; txHash?: string };

/**
 * Facilitator side of `turnspike-allowance` (x402 v2, payment flow `upfront`). It holds no key and never sends a
 * transaction: the agent already paid the vault. settle() binds the proof to the request through the middleware's
 * settleProof (HMAC challenge, resource, merchant, on-chain Paid log, amount, confirmations, reorg guard, deadline on chain
 * time, store transition), exactly once and idempotently, and returns the EXISTING Paid transaction. verify() runs the same
 * checks read-only (checkProof): it writes nothing.
 *
 * Responses follow x402 v2: on failure `transaction` is "" (except the non-terminal `settlement_pending`, which carries the
 * pending hash) and `payer` is always present (the owner, when it can be read from the Paid log or the transaction's
 * calldata; "" when the transaction is unknown).
 */
export class TurnspikeAllowanceFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = SCHEME;
  readonly caipFamily = "eip155:*";
  constructor(private readonly backend: SettlementBackend) {}

  getExtra(_network: Network) {
    const i = this.backend.info;
    return { protocol: TURNSPIKE_PROTOCOL, contract: i.contract, token: i.token, assetTransferMethod: ASSET_TRANSFER_METHOD, paymentFlows: [PAYMENT_FLOW], broadcasts: false };
  }

  getSigners(_network: string): string[] {
    return []; // no facilitator key exists: it never sends a transaction
  }

  /** Requirement and payload checks done before any proof check. Pure: no I/O. */
  private check(payload: PaymentPayload, req: PaymentRequirements): Checked {
    const i = this.backend.info;
    if ((payload as any)?.x402Version !== 2) return { ok: false, reason: ErrorCodes.invalidX402Version };
    if (req?.scheme !== SCHEME || (payload as any)?.accepted?.scheme !== SCHEME) return { ok: false, reason: ErrorCodes.invalidScheme };
    if (req.network !== i.network || payload.accepted.network !== req.network) return { ok: false, reason: ErrorCodes.invalidNetwork };
    const r = requirementsSchema.safeParse(req);
    if (!r.success) return { ok: false, reason: ErrorCodes.invalidPaymentRequirements, message: r.error.issues.map((x) => x.path.join(".") + ": " + x.message).join("; ").slice(0, 300) };
    const p = paymentPayloadSchema.safeParse(payload);
    if (!p.success) return { ok: false, reason: ErrorCodes.invalidPayload, message: p.error.issues.map((x) => x.path.join(".") + ": " + x.message).join("; ").slice(0, 300) };
    const rq = r.data, pl = p.data, acc = pl.accepted;
    if (lc(rq.asset) !== lc(i.token) || lc(acc.asset) !== lc(rq.asset)) return { ok: false, reason: ErrorCodes.assetMismatch };
    if (lc(rq.payTo) !== lc(i.merchant) || lc(acc.payTo) !== lc(rq.payTo)) return { ok: false, reason: ErrorCodes.recipientMismatch };
    if (acc.amount !== rq.amount) return { ok: false, reason: ErrorCodes.amountMismatch };
    if (lc(rq.extra.contract) !== lc(i.contract) || lc(acc.extra.contract) !== lc(rq.extra.contract)) return { ok: false, reason: ErrorCodes.contractMismatch };
    if (acc.maxTimeoutSeconds !== rq.maxTimeoutSeconds) return { ok: false, reason: ErrorCodes.invalidPaymentRequirements, message: "maxTimeoutSeconds differs" };
    // every static extra field the server requires must be echoed unchanged (tamper check), dynamic ones are the challenge
    for (const [k, v] of Object.entries(rq.extra)) {
      if (DYNAMIC_EXTRA.includes(k)) continue;
      if ((acc.extra as Record<string, unknown>)[k] !== v) return { ok: false, reason: ErrorCodes.extraMismatch, message: `extra.${k} differs` };
    }
    // the proof must be the proof of the challenge the client says it accepted
    if (lc(acc.extra.requestId) !== lc(pl.payload.requestId) || lc(acc.extra.sig) !== lc(pl.payload.sig)) return { ok: false, reason: ErrorCodes.proofMismatch };
    return { ok: true, payload: pl, resourceId: rq.extra.resourceId };
  }

  private async payerFor(o: ProofOutcome | null, txHash?: string): Promise<string> {
    const known = o && o.kind === "refused" ? o.payer : undefined;
    if (known) return getAddress(known);
    if (!txHash) return "";
    const p = await this.backend.payerOf(txHash).catch(() => null);
    return p ? getAddress(p) : "";
  }

  private async toResponse(o: ProofOutcome, req: PaymentRequirements, txHash: string, accepted?: PaymentRequirements): Promise<{ success: boolean; reason?: string; message?: string; transaction: string; payer: string }> {
    switch (o.kind) {
      case "settled": {
        // the committed row must be the one these requirements describe (price and merchant at issue time)
        if (o.row.priceBase !== req.amount) return { success: false, reason: ErrorCodes.amountMismatch, transaction: "", payer: o.row.payer ? getAddress(o.row.payer) : "" };
        if (lc(o.row.merchant) !== lc(req.payTo)) return { success: false, reason: ErrorCodes.recipientMismatch, transaction: "", payer: o.row.payer ? getAddress(o.row.payer) : "" };
        // the per-challenge fields must be the issued ones (requirements as built by the server carry them only when echoed)
        const ex = (accepted?.extra ?? {}) as { expiresAt?: number; paymentDeadline?: number };
        if (ex.expiresAt !== undefined && ex.expiresAt !== o.row.expiresAt) return { success: false, reason: ErrorCodes.extraMismatch, message: "extra.expiresAt differs", transaction: "", payer: o.row.payer ? getAddress(o.row.payer) : "" };
        if (ex.paymentDeadline !== undefined && ex.paymentDeadline !== o.row.expiresAt + this.backend.info.paymentGraceSeconds) return { success: false, reason: ErrorCodes.extraMismatch, message: "extra.paymentDeadline differs", transaction: "", payer: o.row.payer ? getAddress(o.row.payer) : "" };
        return { success: true, transaction: o.row.txHash ?? txHash, payer: o.row.payer ? getAddress(o.row.payer) : "" };
      }
      case "pending":
        return { success: false, reason: ErrorCodes.settlementPending, message: o.why, transaction: o.txHash, payer: await this.payerFor(null, o.txHash) };
      case "refused":
        return { success: false, reason: errorForProofCode(o.code), transaction: "", payer: await this.payerFor(o, o.txHash ?? txHash) };
      case "rpc_unavailable":
        return { success: false, reason: ErrorCodes.unexpectedSettleError, message: "rpc_unavailable", transaction: "", payer: await this.payerFor(null, undefined) };
      case "storage_unavailable":
        return { success: false, reason: ErrorCodes.unexpectedSettleError, message: "storage_unavailable", transaction: "", payer: "" };
    }
  }

  /** Read-only (x402 v2 /verify). Not called by the `upfront` flow, provided for completeness. Writes nothing. */
  async verify(payload: PaymentPayload, req: PaymentRequirements): Promise<VerifyResponse> {
    const c = this.check(payload, req);
    const txHash = (payload as any)?.payload?.txHash;
    if (!c.ok) return { isValid: false, invalidReason: c.reason, ...(c.message ? { invalidMessage: c.message } : {}), payer: await this.payerFor(null, typeof txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(txHash) ? txHash : undefined) };
    const o = await this.backend.checkProof(c.payload.payload, c.resourceId);
    const r = await this.toResponse(o, req, c.payload.payload.txHash, c.payload.accepted as PaymentRequirements);
    return r.success ? { isValid: true, payer: r.payer } : { isValid: false, invalidReason: r.reason, ...(r.message ? { invalidMessage: r.message } : {}), payer: r.payer };
  }

  /** Durable commit (x402 v2 /settle). Idempotent: the same proof always settles to the same, already mined transaction. */
  async settle(payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResponse> {
    const network = (req?.network ?? "") as Network;
    const c = this.check(payload, req);
    const rawTx = (payload as any)?.payload?.txHash;
    if (!c.ok) {
      this.backend.log({ evt: "x402.settle.fail", code: c.reason });
      return { success: false, errorReason: c.reason, ...(c.message ? { errorMessage: c.message } : {}), transaction: "", network, payer: await this.payerFor(null, typeof rawTx === "string" && /^0x[0-9a-fA-F]{64}$/.test(rawTx) ? rawTx : undefined) };
    }
    const o = await this.backend.settleProof(c.payload.payload, c.resourceId, { protocol: "x402" });
    const r = await this.toResponse(o, req, c.payload.payload.txHash, c.payload.accepted as PaymentRequirements);
    const requestId = c.payload.payload.requestId.toLowerCase();
    if (r.success) this.backend.log({ evt: "x402.settle.ok", requestId, txHash: r.transaction });
    else if (r.reason === ErrorCodes.settlementPending) this.backend.log({ evt: "x402.settle.pending", requestId, txHash: r.transaction, why: r.message });
    else this.backend.log({ evt: "x402.settle.fail", requestId, code: r.reason, detail: r.message });
    return {
      success: r.success, transaction: r.transaction, network, payer: r.payer,
      ...(r.success ? {} : { errorReason: r.reason, ...(r.message ? { errorMessage: r.message } : {}) }),
    };
  }
}
