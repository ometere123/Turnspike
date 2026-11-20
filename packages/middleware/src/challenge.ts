import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AbiCoder, keccak256 } from "ethers";

export interface ChallengeFields {
  nonce: string;
  merchant: string;
  resourceId: string;
  priceBase: string;
  chainId: number;
  contract: string;
  expiresAt: number;
}

/** requestId = keccak256(abi.encode(nonce, merchant, resourceId, price, chainId, contract, expiry)) (doc 05 section 4). */
export function computeRequestId(f: ChallengeFields): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "string", "uint256", "uint256", "address", "uint256"],
      [f.nonce, f.merchant, f.resourceId, BigInt(f.priceBase), BigInt(f.chainId), f.contract, BigInt(f.expiresAt)],
    ),
  );
}

export function newNonce(): string {
  return "0x" + randomBytes(32).toString("hex");
}

function canonical(requestId: string, f: ChallengeFields): string {
  return [requestId, f.nonce, f.merchant.toLowerCase(), f.resourceId, f.priceBase, f.chainId, f.contract.toLowerCase(), f.expiresAt].join("|");
}

export function sign(secret: string, requestId: string, f: ChallengeFields): string {
  return createHmac("sha256", secret).update(canonical(requestId, f)).digest("hex");
}

export function verifySig(secrets: string[], requestId: string, f: ChallengeFields, sig: string): boolean {
  // several secrets are accepted to allow rotation (TEST-S01): first is current, the rest are previous.
  return secrets.some((s) => {
    const a = Buffer.from(sign(s, requestId, f), "hex");
    const b = Buffer.from(sig, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/*
 * x402 v2 view of a challenge (custom scheme `turnspike-allowance`, NOT the standard `exact` scheme).
 * The middleware builds the PAYMENT-REQUIRED header from the same signed row as the JSON 402 body, and
 * @turnspike-qie/x402 builds the requirements it matches a PAYMENT-SIGNATURE against with the same function, so the two can
 * never drift. Field meanings follow the x402 v2 specification: `amount` in atomic units, `asset` the token address,
 * `payTo` the merchant, `extra` the scheme data. Per-challenge fields (requestId, sig, expiresAt, paymentDeadline) are
 * dynamic: they are excluded from the accepted-versus-required match, and everything else must match exactly.
 */
export const X402_SCHEME = "turnspike-allowance";
export const X402_ASSET_TRANSFER_METHOD = "vault-pay";
export const X402_PAYMENT_FLOW = "upfront";
export const X402_DYNAMIC_EXTRA = ["requestId", "sig", "expiresAt", "paymentDeadline"] as const;
export const caip2 = (chainId: number) => `eip155:${chainId}`;

export interface X402RequirementBase {
  chainId: number;
  contract: string;
  token: string;
  merchant: string;
  priceBase: string;
  resourceId: string;
  maxTimeoutSeconds: number;
}
export interface X402DynamicFields { requestId: string; sig: string; expiresAt: number; paymentDeadline: number }

/** The x402 v2 PaymentRequirements object for a Turnspike challenge (static part, plus the dynamic part when known). */
export function x402Requirement(b: X402RequirementBase, dyn?: X402DynamicFields) {
  return {
    scheme: X402_SCHEME,
    network: caip2(b.chainId),
    amount: String(b.priceBase),
    asset: b.token,
    payTo: b.merchant,
    maxTimeoutSeconds: b.maxTimeoutSeconds,
    extra: {
      resourceId: b.resourceId,
      protocol: "turnspike/1",
      contract: b.contract,
      assetTransferMethod: X402_ASSET_TRANSFER_METHOD,
      paymentFlow: X402_PAYMENT_FLOW,
      ...(dyn ? { requestId: dyn.requestId, sig: dyn.sig, expiresAt: dyn.expiresAt, paymentDeadline: dyn.paymentDeadline } : {}),
    } as Record<string, unknown>,
  };
}

/** The x402 v2 PaymentRequired object (what the PAYMENT-REQUIRED header carries, base64-encoded JSON). */
export function x402PaymentRequired(resource: { url: string; description?: string; mimeType?: string }, accepts: ReturnType<typeof x402Requirement>[], error = "Payment required") {
  return { x402Version: 2, error, resource: { url: resource.url, description: resource.description ?? "", mimeType: resource.mimeType ?? "" }, accepts };
}

export const encodeX402Header = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
