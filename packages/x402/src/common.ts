import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import {
  X402_ASSET_TRANSFER_METHOD, X402_DYNAMIC_EXTRA, X402_PAYMENT_FLOW, X402_SCHEME, caip2, x402Requirement,
} from "@turnspike-qie/middleware/challenge";

/**
 * Custom x402 v2 scheme `turnspike-allowance`. It is NOT the standard `exact` scheme and is not registered with the x402
 * maintainers: both parties must register it. Money moves only through TurnpikeAllowance.pay, sent by the owner's
 * authorised agent, before PAYMENT-SIGNATURE is sent (payment flow `upfront`); settle binds that existing payment to the
 * request and never broadcasts anything.
 */
export const SCHEME = X402_SCHEME;
/** assetTransferMethod label (x402 v2: values are defined per mechanism). */
export const ASSET_TRANSFER_METHOD = X402_ASSET_TRANSFER_METHOD;
export const PAYMENT_FLOW = X402_PAYMENT_FLOW;
export const TURNSPIKE_PROTOCOL = "turnspike/1";
/** Per-challenge extra fields, excluded from the accepted-versus-required match (core `dynamicExtraFields`). */
export const DYNAMIC_EXTRA: string[] = [...X402_DYNAMIC_EXTRA];
export { caip2 };
export const chainOf = (network: string): number | null => {
  const m = /^eip155:([1-9][0-9]{0,15})$/.exec(network);
  return m ? Number(m[1]) : null;
};

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const sigHex = z.string().regex(/^[0-9a-fA-F]{64}$/);

/** PAYMENT-SIGNATURE `payload` of this scheme: the proof of the vault payment. */
export const proofPayloadSchema = z.object({ requestId: hex32, txHash: hex32, sig: sigHex }).strict();
export type ProofPayload = z.infer<typeof proofPayloadSchema>;

const staticExtra = {
  resourceId: z.string().min(1).max(2048),
  protocol: z.literal(TURNSPIKE_PROTOCOL),
  contract: addr,
  assetTransferMethod: z.literal(ASSET_TRANSFER_METHOD),
  paymentFlow: z.literal(PAYMENT_FLOW),
};
const requirementCore = {
  scheme: z.literal(SCHEME),
  network: z.string().regex(/^eip155:[1-9][0-9]{0,15}$/),
  amount: z.string().regex(/^[1-9][0-9]{0,77}$/),
  asset: addr,
  payTo: addr,
  maxTimeoutSeconds: z.number().int().positive().max(86_400),
};

/** PaymentRequirements of this scheme as the resource server builds them for matching (no per-challenge fields). */
export const requirementsSchema = z.object({
  ...requirementCore,
  extra: z.object({
    ...staticExtra,
    requestId: hex32.optional(), sig: sigHex.optional(), expiresAt: z.number().int().positive().optional(), paymentDeadline: z.number().int().positive().optional(),
  }).strict(),
}).strict();

/** PaymentRequirements of this scheme as carried by a 402 (and echoed in `accepted`): every challenge field present. */
export const challengeRequirementsSchema = z.object({
  ...requirementCore,
  extra: z.object({
    ...staticExtra,
    requestId: hex32, sig: sigHex, expiresAt: z.number().int().positive(), paymentDeadline: z.number().int().positive(),
  }).strict(),
}).strict();
export type ChallengeRequirements = z.infer<typeof challengeRequirementsSchema>;

const resourceSchema = z.object({ url: z.string().max(4096) }).passthrough();

/** x402 v2 PaymentPayload for this scheme (the decoded PAYMENT-SIGNATURE header). */
export const paymentPayloadSchema = z.object({
  x402Version: z.literal(2),
  /** Optional; `null` is accepted (valid in @x402/core PaymentPayloadV2Schema) and treated as absent. */
  resource: resourceSchema.nullish(),
  accepted: challengeRequirementsSchema,
  payload: proofPayloadSchema,
  extensions: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type TurnspikePaymentPayload = z.infer<typeof paymentPayloadSchema>;

/**
 * Error reasons. The standard x402 codes are used where they exist; scheme-specific ones are namespaced
 * `invalid_turnspike_allowance_*` (not registered with x402; clients must match on the code).
 */
export const ErrorCodes = {
  // standard x402 v2
  invalidX402Version: "invalid_x402_version",
  invalidScheme: "invalid_scheme",
  invalidNetwork: "invalid_network",
  invalidPayload: "invalid_payload",
  invalidPaymentRequirements: "invalid_payment_requirements",
  settlementPending: "settlement_pending",
  unexpectedSettleError: "unexpected_settle_error",
  unexpectedVerifyError: "unexpected_verify_error",
  // turnspike-allowance: requirement checks
  assetMismatch: "invalid_turnspike_allowance_asset_mismatch",
  recipientMismatch: "invalid_turnspike_allowance_recipient_mismatch",
  amountMismatch: "invalid_turnspike_allowance_amount_mismatch",
  contractMismatch: "invalid_turnspike_allowance_contract_mismatch",
  extraMismatch: "invalid_turnspike_allowance_extra_mismatch",
  proofMismatch: "invalid_turnspike_allowance_proof_mismatch",
  // turnspike-allowance: proof checks (the same checks as turnspike/1, see the middleware's ProofOutcome codes)
  malformedProof: "invalid_turnspike_allowance_malformed_proof",
  unknownRequest: "invalid_turnspike_allowance_unknown_request",
  integrity: "invalid_turnspike_allowance_integrity",
  signature: "invalid_turnspike_allowance_signature",
  wrongResource: "invalid_turnspike_allowance_wrong_resource",
  wrongMerchant: "invalid_turnspike_allowance_wrong_merchant",
  differentTx: "invalid_turnspike_allowance_different_tx",
  txReused: "invalid_turnspike_allowance_tx_reused",
  rejected: "invalid_turnspike_allowance_rejected",
  paidTooLate: "invalid_turnspike_allowance_paid_too_late",
  wrongChain: "invalid_turnspike_allowance_wrong_chain",
  txFailed: "invalid_turnspike_allowance_tx_failed",
  amountBelowPrice: "invalid_turnspike_allowance_amount_below_price",
  ownerNotPermitted: "invalid_turnspike_allowance_owner_not_permitted",
  agentNotPermitted: "invalid_turnspike_allowance_agent_not_permitted",
  noMatchingPaidLog: "invalid_turnspike_allowance_no_matching_paid_log",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Maps a middleware ProofOutcome refusal code to the x402 error reason. */
export function errorForProofCode(code: string): string {
  const map: Record<string, string> = {
    malformed_proof: ErrorCodes.malformedProof, unknown_request: ErrorCodes.unknownRequest, integrity: ErrorCodes.integrity,
    bad_signature: ErrorCodes.signature, wrong_resource: ErrorCodes.wrongResource, wrong_merchant: ErrorCodes.wrongMerchant,
    different_tx: ErrorCodes.differentTx, tx_reused: ErrorCodes.txReused, rejected: ErrorCodes.rejected, paid_too_late: ErrorCodes.paidTooLate,
    wrong_chain: ErrorCodes.wrongChain, tx_failed: ErrorCodes.txFailed, amount_below_price: ErrorCodes.amountBelowPrice,
    owner_not_permitted: ErrorCodes.ownerNotPermitted, agent_not_permitted: ErrorCodes.agentNotPermitted, no_matching_paid_log: ErrorCodes.noMatchingPaidLog,
  };
  return map[code] ?? `invalid_turnspike_allowance_${code.replace(/[^a-z0-9_]/g, "_")}`;
}

/** errorMessage values of `unexpected_settle_error` that mean "try again later" (the seller answers 503). */
export const TRANSIENT_MESSAGES = new Set(["rpc_unavailable", "storage_unavailable"]);

export const b64json = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
export function unb64json<T = unknown>(s: string, maxBytes = 16_384): T {
  if (typeof s !== "string" || s.length > Math.ceil((maxBytes * 4) / 3) + 4) throw new Error("header too long");
  if (!/^[A-Za-z0-9+/=_-]+$/.test(s)) throw new Error("not base64");
  return JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;
}

/** True for an x402 v1-shaped payment payload (top-level scheme/network, or x402Version 1). */
export function isX402V1Shaped(o: unknown): boolean {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const x = o as Record<string, unknown>;
  if (x.x402Version === 1) return true;
  return "scheme" in x && "network" in x && "payload" in x && !("accepted" in x);
}

/** The turnspike/1 challenge a turnspike-allowance requirement carries (what TurnspikeClient.payChallenge pays). */
export function requirementToChallenge(r: ChallengeRequirements) {
  const chainId = chainOf(r.network);
  if (chainId === null) throw new Error(`not an eip155 network: ${r.network}`);
  return {
    error: "payment_required" as const, protocol: r.extra.protocol, requestId: r.extra.requestId, sig: r.extra.sig, priceBase: r.amount,
    token: r.asset, contract: r.extra.contract, merchant: r.payTo, chainId, resourceId: r.extra.resourceId, expiresAt: r.extra.expiresAt,
    paymentDeadline: r.extra.paymentDeadline,
  };
}

/** Rebuilds the requirement of a recorded challenge (recovery when the original `accepted` was not kept). */
export function challengeToRequirement(c: { requestId: string; sig: string; priceBase: string; token: string; contract: string; merchant: string; chainId: number; resourceId: string; expiresAt: number; paymentDeadline?: number }, maxTimeoutSeconds: number) {
  return x402Requirement(
    { chainId: c.chainId, contract: c.contract, token: c.token, merchant: c.merchant, priceBase: c.priceBase, resourceId: c.resourceId, maxTimeoutSeconds },
    { requestId: c.requestId, sig: c.sig, expiresAt: c.expiresAt, paymentDeadline: c.paymentDeadline ?? c.expiresAt },
  );
}

/** Per-call context set by createX402Fetch. The client scheme refuses to pay without it (fail closed). */
export interface CallContext {
  /** URL actually fetched (after same-origin redirects), bound to the payee policy. */
  url: string;
  /** URL the caller asked for (before redirects); bound to the purchase key with method and bodyHash. */
  requestUrl?: string;
  method: string;
  bodyHash: string;
  purchaseKey: string;
  maxPriceBase?: bigint;
  /** Set by the client scheme: the requirement it paid and the result of payChallenge. */
  accepted?: ChallengeRequirements;
  result?: unknown;
  /** Set by the wrapper's transport: the PAYMENT-SIGNATURE header sent (or about to be sent). */
  paymentHeader?: string;
}
export const callContext = new AsyncLocalStorage<CallContext>();
