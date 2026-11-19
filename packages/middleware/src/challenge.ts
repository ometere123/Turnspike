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
