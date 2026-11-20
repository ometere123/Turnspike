import { JsonRpcProvider, getAddress } from "ethers";
import { z } from "zod";
import type { SchemeNetworkFacilitator, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { computeRequestId, verifySig, ChallengeFields } from "../../../packages/middleware/src/challenge";
import { Store } from "../../../packages/middleware/src/store";
import { verifyPayment } from "../../../packages/middleware/src/verify";
import { SCHEME, caip2 } from "./common";

export interface FacilitatorCfg {
  chainId: number; contract: string; token: string; merchants: string[]; rpcUrls: string[]; hmacSecrets: string[]; store: Store;
  confirmations?: number; paymentGraceSeconds?: number;
}
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const proofSchema = z.object({ requestId: hex32, txHash: hex32, sig: z.string().regex(/^[0-9a-fA-F]{64}$/) }).strict();
const lc = (s: string) => s.toLowerCase();

type Checked =
  | { ok: false; reason: string; transaction?: string }
  | { ok: true; requestId: string; txHash: string; payer: string; agent: string; blockNumber: number };

/**
 * Facilitator for `turnspike-allowance`. It never signs or broadcasts: the agent already paid the vault (flow `upfront`).
 * settle() binds the proof to this resource and request, durably and exactly once; the returned `transaction` is the
 * EXISTING Paid transaction. Reuses the Turnspike middleware's HMAC challenge, on-chain verification (Paid log, merchant,
 * amount, confirmations, reorg guard, deadline on chain time) and SQLite state machine unchanged.
 */
export class TurnspikeAllowanceFacilitator implements SchemeNetworkFacilitator {
  readonly scheme = SCHEME;
  readonly caipFamily = "eip155:*";
  private providers: JsonRpcProvider[];
  constructor(private c: FacilitatorCfg) {
    this.providers = c.rpcUrls.map((u) => new JsonRpcProvider(u, c.chainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 }));
  }
  getExtra() { return { protocol: "turnspike/1", contract: this.c.contract, token: this.c.token, flows: ["upfront"], broadcasts: false }; }
  getSigners() { return []; } // no facilitator key exists: it never sends a transaction
  close() { for (const p of this.providers) p.destroy(); }

  private async check(payload: PaymentPayload, req: PaymentRequirements): Promise<Checked> {
    if (payload.x402Version !== 2) return { ok: false, reason: "invalid_x402_version" };
    if (req.scheme !== SCHEME || payload.accepted?.scheme !== SCHEME) return { ok: false, reason: "invalid_scheme" };
    if (req.network !== caip2(this.c.chainId) || payload.accepted.network !== req.network) return { ok: false, reason: "invalid_network" };
    if (lc(req.asset) !== lc(this.c.token) || lc(payload.accepted.asset) !== lc(this.c.token)) return { ok: false, reason: "invalid_turnspike_allowance_asset_mismatch" };
    if (!this.c.merchants.some((m) => lc(m) === lc(req.payTo)) || lc(payload.accepted.payTo) !== lc(req.payTo)) return { ok: false, reason: "invalid_turnspike_allowance_recipient_mismatch" };
    if (payload.accepted.amount !== req.amount) return { ok: false, reason: "invalid_turnspike_allowance_amount_mismatch" };
    if ((req.extra as any)?.paymentFlow !== "upfront") return { ok: false, reason: "invalid_payment_requirements" };
    const parsed = proofSchema.safeParse(payload.payload);
    if (!parsed.success) return { ok: false, reason: "invalid_payload" };
    const proof = parsed.data;
    const requestId = proof.requestId.toLowerCase();
    const row = this.c.store.get(requestId);
    if (!row) return { ok: false, reason: "invalid_turnspike_allowance_unknown_request" };
    const f: ChallengeFields = { nonce: row.nonce, merchant: row.merchant, resourceId: row.resourceId, priceBase: row.priceBase, chainId: row.chainId, contract: row.contract, expiresAt: row.expiresAt };
    if (computeRequestId(f).toLowerCase() !== requestId) return { ok: false, reason: "invalid_turnspike_allowance_integrity" };
    if (!verifySig(this.c.hmacSecrets, requestId, f, proof.sig)) return { ok: false, reason: "invalid_turnspike_allowance_signature" };
    // Binding: the proof authorizes only the resource, merchant, price and chain it was issued for.
    if (row.resourceId !== (req.extra as any)?.resourceId) return { ok: false, reason: "invalid_turnspike_allowance_wrong_resource" };
    if (lc(row.merchant) !== lc(req.payTo)) return { ok: false, reason: "invalid_turnspike_allowance_recipient_mismatch" };
    if (row.priceBase !== req.amount) return { ok: false, reason: "invalid_turnspike_allowance_amount_mismatch" };
    if (lc(row.contract) !== lc(this.c.contract) || row.chainId !== this.c.chainId) return { ok: false, reason: "invalid_network" };
    if (row.txHash && lc(row.txHash) !== lc(proof.txHash)) return { ok: false, reason: "invalid_turnspike_allowance_different_tx", transaction: row.txHash };
    if (row.state === "REJECTED") return { ok: false, reason: "invalid_turnspike_allowance_rejected", transaction: row.txHash ?? "" };
    if (row.state === "PAID_CONFIRMED" || row.state === "DELIVERING" || row.state === "DELIVERED") {
      return { ok: true, requestId, txHash: row.txHash!, payer: row.payer!, agent: row.agent!, blockNumber: row.blockNumber! };
    }
    const v = await verifyPayment(this.providers, row, proof.txHash, { confirmations: this.c.confirmations ?? 2, paymentGraceSeconds: this.c.paymentGraceSeconds ?? 60 });
    if (v.kind === "rpc_unavailable") return { ok: false, reason: "unexpected_settle_error" };
    if (v.kind === "pending") return { ok: false, reason: "settlement_pending", transaction: proof.txHash };
    if (v.kind === "rejected") {
      if (v.reason === "paid_too_late" && v.txRecord) {
        this.c.store.transition(requestId, ["ISSUED", "PAID_PENDING"], "REJECTED", { txHash: proof.txHash.toLowerCase(), payer: v.txRecord.payer, agent: v.txRecord.agent, blockNumber: v.txRecord.blockNumber }, v.reason);
      }
      return { ok: false, reason: `invalid_turnspike_allowance_${v.reason}`, transaction: proof.txHash };
    }
    return { ok: true, requestId, txHash: proof.txHash.toLowerCase(), payer: v.payer, agent: v.agent, blockNumber: v.blockNumber };
  }

  /** Read-only (spec section 7): never writes. Not called by the `upfront` flow; provided for completeness. */
  async verify(payload: PaymentPayload, req: PaymentRequirements) {
    const r = await this.check(payload, req);
    return r.ok ? { isValid: true, payer: r.payer } : { isValid: false, invalidReason: r.reason };
  }

  /** Durable commit: attaches the transaction to the request. Idempotent: the same proof always settles to the same transaction. */
  async settle(payload: PaymentPayload, req: PaymentRequirements) {
    const network = req.network;
    const r = await this.check(payload, req);
    if (!r.ok) return { success: false, errorReason: r.reason, transaction: r.transaction ?? "", network } as any;
    const row = this.c.store.get(r.requestId)!;
    if (row.state === "ISSUED") this.c.store.transition(r.requestId, ["ISSUED"], "PAID_PENDING", {}, "proof_submitted");
    if (this.c.store.get(r.requestId)!.state === "PAID_PENDING") {
      try {
        this.c.store.transition(r.requestId, ["PAID_PENDING"], "PAID_CONFIRMED", { txHash: r.txHash, blockNumber: r.blockNumber, payer: r.payer, agent: r.agent }, "verified");
      } catch {
        return { success: false, errorReason: "invalid_turnspike_allowance_tx_reused", transaction: r.txHash, network } as any; // txHash is UNIQUE: it backs another request
      }
    }
    return { success: true, payer: getAddress(r.payer), transaction: r.txHash, network } as any;
  }
}
