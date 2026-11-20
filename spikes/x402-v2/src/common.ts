import { AsyncLocalStorage } from "node:async_hooks";

/** Custom x402 v2 scheme implemented by this spike. NOT part of the x402 spec; registered at runtime. */
export const SCHEME = "turnspike-allowance";
/** assetTransferMethod label (x402 spec section 5: values are defined per mechanism). */
export const ATM = "vault-pay";
export const caip2 = (chainId: number) => `eip155:${chainId}`;
export const chainOf = (network: string) => {
  const m = /^eip155:(\d+)$/.exec(network);
  return m ? Number(m[1]) : null;
};
/** Dynamic extra fields: minted per 402 and excluded from the accepted-vs-required match (core: dynamicExtraFields). */
export const DYNAMIC_EXTRA = ["requestId", "sig", "expiresAt", "paymentDeadline"];

/** Payload of PAYMENT-SIGNATURE for this scheme: the vault payment's proof. */
export interface ProofPayload { requestId: string; txHash: string; sig: string }

export const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
export const unb64 = <T = any>(s: string): T => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

/** Per-call context for the client scheme (x402Client does not pass the real request URL to createPaymentPayload). */
export interface CallCtx { url: string; init: RequestInit; purchaseKey?: string; captured?: string; challenge?: any }
export const callCtx = new AsyncLocalStorage<CallCtx>();
