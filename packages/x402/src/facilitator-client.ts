import { createHash, createHmac, randomBytes } from "node:crypto";
import { x402Facilitator } from "@x402/core/facilitator";
import { FacilitatorResponseError, type FacilitatorClient } from "@x402/core/server";
import type { Network, PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { getAddress } from "ethers";
import { ErrorCodes } from "./common";
import { TurnspikeAllowanceFacilitator, type SettlementBackend } from "./scheme/facilitator";

/** Builds the official @x402/core facilitator with `turnspike-allowance` registered for the backend's network. */
export function createTurnspikeFacilitator(backend: SettlementBackend): x402Facilitator {
  return new x402Facilitator().register(backend.info.network as Network, new TurnspikeAllowanceFacilitator(backend));
}

const failSettle = (req: PaymentRequirements | undefined, reason: string, payer: string, message?: string): SettleResponse => ({
  success: false, errorReason: reason, ...(message ? { errorMessage: message } : {}), transaction: "", network: (req?.network ?? "") as Network, payer,
});

/** Maps an exception from x402Facilitator (unknown scheme or network) to a failure response instead of a 5xx. */
function reasonOf(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/network/i.test(m)) return ErrorCodes.invalidNetwork;
  if (/scheme/i.test(m)) return ErrorCodes.invalidScheme;
  return ErrorCodes.unexpectedSettleError;
}

/**
 * In-process facilitator (the default). Implements the @x402/core FacilitatorClient interface over the official
 * x402Facilitator with `turnspike-allowance` registered, so the resource server's x402ResourceServer settles without a
 * network hop and the merchant's HMAC secrets never leave the process.
 */
export class LocalFacilitatorClient implements FacilitatorClient {
  readonly facilitator: x402Facilitator;
  constructor(private readonly backend: SettlementBackend) {
    this.facilitator = createTurnspikeFacilitator(backend);
  }
  /** The owner who paid, when the payload names a known Paid transaction; "" otherwise. */
  private async payerOf(p: PaymentPayload): Promise<string> {
    const tx = (p as any)?.payload?.txHash;
    if (typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx)) return "";
    const who = await this.backend.payerOf(tx).catch(() => null);
    try { return who ? getAddress(who) : ""; } catch { return ""; }
  }
  async verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResponse> {
    try {
      return await this.facilitator.verify(paymentPayload, paymentRequirements);
    } catch (e) {
      return { isValid: false, invalidReason: reasonOf(e) === ErrorCodes.unexpectedSettleError ? ErrorCodes.unexpectedVerifyError : reasonOf(e), payer: await this.payerOf(paymentPayload) };
    }
  }
  async settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResponse> {
    try {
      return await this.facilitator.settle(paymentPayload, paymentRequirements);
    } catch (e) {
      return failSettle(paymentRequirements, reasonOf(e), await this.payerOf(paymentPayload));
    }
  }
  async getSupported(): Promise<SupportedResponse> {
    return this.facilitator.getSupported() as SupportedResponse;
  }
}

/* ---------------- authenticated remote facilitator (opt-in, see createFacilitatorServer) ---------------- */

export const AUTH_HEADERS = { timestamp: "x-turnspike-timestamp", nonce: "x-turnspike-nonce", signature: "x-turnspike-signature" } as const;

/** Canonical string signed by both sides: timestamp, nonce, method, path and the SHA-256 of the exact body bytes. */
export function canonicalRequest(ts: string, nonce: string, method: string, path: string, body: string | Buffer): string {
  return [ts, nonce, method.toUpperCase(), path, createHash("sha256").update(body).digest("hex")].join("\n");
}
export const signRequest = (secret: string, canonical: string) => createHmac("sha256", secret).update(canonical).digest("hex");

/** Headers authenticating one facilitator request (HMAC-SHA256 over timestamp, nonce, method, path and body). */
export function facilitatorAuthHeaders(secret: string, method: string, path: string, body: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  return { [AUTH_HEADERS.timestamp]: ts, [AUTH_HEADERS.nonce]: nonce, [AUTH_HEADERS.signature]: signRequest(secret, canonicalRequest(ts, nonce, method, path, body)) };
}

const json = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

/**
 * FacilitatorClient for a standalone facilitator started with createFacilitatorServer. Every request carries an HMAC over
 * a fresh timestamp and nonce and the exact body. (The stock HTTPFacilitatorClient cannot sign bodies: its auth hook does
 * not see them.) A settle that fails in transport is an unknown outcome: the resource server answers 502/503 and the
 * client re-presents the same proof, which settles idempotently.
 */
export class RemoteFacilitatorClient implements FacilitatorClient {
  constructor(private readonly o: { url: string; secret: string; timeoutMs?: number; fetch?: typeof fetch }) {
    if (Buffer.byteLength(o.secret) < 32) throw new Error("facilitator secret must be at least 32 bytes");
  }
  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const text = body === undefined ? "" : json(body);
    const base = new URL(this.o.url);
    const fullPath = (base.pathname.replace(/\/$/, "") + path) || path;
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(new URL(fullPath, base).toString(), {
        method,
        headers: { "content-type": "application/json", ...facilitatorAuthHeaders(this.o.secret, method, fullPath, text) },
        ...(method === "POST" ? { body: text } : {}),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
        redirect: "error",
      });
    } catch (e) {
      // transport failure: for settle the outcome is unknown (it may have committed); the SDK answers 502
      throw new FacilitatorResponseError(`facilitator ${path} unreachable: ${(e as Error)?.message ?? e}`);
    }
    const out = await res.json().catch(() => null);
    if (!res.ok && !(out && typeof out === "object" && ("success" in out || "isValid" in out))) throw new FacilitatorResponseError(`facilitator ${path} answered ${res.status}`);
    return out as T;
  }
  verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) {
    return this.call<VerifyResponse>("POST", "/verify", { x402Version: paymentPayload.x402Version, paymentPayload, paymentRequirements });
  }
  settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) {
    return this.call<SettleResponse>("POST", "/settle", { x402Version: paymentPayload.x402Version, paymentPayload, paymentRequirements });
  }
  getSupported() {
    return this.call<SupportedResponse>("GET", "/supported");
  }
}
