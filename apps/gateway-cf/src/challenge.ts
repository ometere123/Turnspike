import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";

/** Same fields, id and signature as packages/middleware/src/challenge.ts (turnspike/1); CF-01 and CF-26 compare the two. */
export interface ChallengeFields { nonce: string; merchant: string; resourceId: string; priceBase: string; chainId: number; contract: string; expiresAt: number }

const word = (n: bigint) => n.toString(16).padStart(64, "0");
const addressWord = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");

/** keccak256(abi.encode(bytes32 nonce, address merchant, string resourceId, uint256 price, uint256 chainId, address contract, uint256 expiry)) */
export function computeRequestId(f: ChallengeFields): string {
  const text = Buffer.from(f.resourceId, "utf8");
  const tail = text.toString("hex").padEnd(Math.ceil(text.length / 32) * 64, "0");
  const data = f.nonce.slice(2) + addressWord(f.merchant) + word(224n) + word(BigInt(f.priceBase)) + word(BigInt(f.chainId)) + addressWord(f.contract) + word(BigInt(f.expiresAt)) + word(BigInt(text.length)) + tail;
  return "0x" + Buffer.from(keccak_256(Buffer.from(data, "hex"))).toString("hex");
}

export const newNonce = () => "0x" + randomBytes(32).toString("hex");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const canonical = (requestId: string, f: ChallengeFields) =>
  [requestId, f.nonce, f.merchant.toLowerCase(), f.resourceId, f.priceBase, f.chainId, f.contract.toLowerCase(), f.expiresAt].join("|");

export const sign = (secret: string, requestId: string, f: ChallengeFields) => createHmac("sha256", secret).update(canonical(requestId, f)).digest("hex");

export function verifySig(secrets: string[], requestId: string, f: ChallengeFields, sig: string): boolean {
  const given = Buffer.from(sig, "hex");
  // Every secret is tried (current, then previous) so that rotation does not depend on timing.
  return secrets.map((s) => Buffer.from(sign(s, requestId, f), "hex")).map((want) => want.length === given.length && timingSafeEqual(want, given)).some(Boolean);
}

/** Constant-time comparison of two secrets of any length. */
export const sameSecret = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
