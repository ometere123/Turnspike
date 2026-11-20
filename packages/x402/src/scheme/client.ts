import type { PaymentPayloadResult, PaymentRequirements, SchemeNetworkClient } from "@x402/core/types";
import { SCHEME, callContext, challengeRequirementsSchema, requirementToChallenge } from "../common";

/** Structural view of @turnspike-qie/client's TurnspikeClient (0.2.0) used by this package. */
export interface PayChallengeClient {
  payChallenge(challenge: any, ctx: { url: string; method: string; bodyHash?: string; purchaseKey: string; maxPriceBase?: bigint }): Promise<
    | { ok: true; proof: { requestId: string; txHash: string; sig: string }; payment: unknown; resumed: boolean }
    | { ok: false; error: string; message: string; paid: boolean; maybePaid?: boolean; quote?: unknown; proof?: { requestId: string; txHash: string; sig: string } }
  >;
  markProofPresented(purchaseKey: string, requestId?: string): Promise<boolean>;
  markDelivered(purchaseKey: string, requestId?: string): Promise<boolean>;
}

export class TurnspikeSchemeError extends Error {
  constructor(readonly code: string, message: string, readonly paid = false, readonly maybePaid = false) {
    super(`${code}: ${message}`);
  }
}

/**
 * Client side of `turnspike-allowance`. Fails closed outside createX402Fetch (no call context: the scheme cannot see the
 * URL actually fetched, so it cannot apply the payee policy). Validates the requirement strictly, converts it to the
 * turnspike/1 challenge and hands it to TurnspikeClient.payChallenge (payee allowlist on ctx.url, chain/contract/token
 * trust, price ceilings, expiry margin, on-chain policy, journal, nonce lease, confirmations). The returned proof becomes the
 * PAYMENT-SIGNATURE payload. The outcome (including failures) is stored in the call context for the wrapper.
 */
export class TurnspikeAllowanceClient implements SchemeNetworkClient {
  readonly scheme = SCHEME;
  constructor(private readonly client: PayChallengeClient) {}

  async createPaymentPayload(x402Version: number, r: PaymentRequirements): Promise<PaymentPayloadResult> {
    const ctx = callContext.getStore();
    if (!ctx) throw new TurnspikeSchemeError("no_call_context", "use createX402Fetch; the scheme refuses to pay without the fetched URL");
    if (x402Version !== 2) throw new TurnspikeSchemeError("unsupported_x402_version", `x402Version ${x402Version}`);
    const p = challengeRequirementsSchema.safeParse(r);
    if (!p.success) throw new TurnspikeSchemeError("invalid_challenge", "requirements are not a turnspike-allowance upfront challenge");
    ctx.accepted = p.data;
    const result = await this.client.payChallenge(requirementToChallenge(p.data), {
      url: ctx.url, method: ctx.method, bodyHash: ctx.bodyHash || undefined, purchaseKey: ctx.purchaseKey, maxPriceBase: ctx.maxPriceBase,
    });
    ctx.result = result;
    if (!result.ok) throw new TurnspikeSchemeError(result.error, result.message, result.paid, !!result.maybePaid);
    const { requestId, txHash, sig } = result.proof;
    return { x402Version, payload: { requestId, txHash, sig } };
  }
}
