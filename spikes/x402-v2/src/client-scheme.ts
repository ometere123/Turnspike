import type { SchemeNetworkClient, PaymentRequirements } from "@x402/core/types";
import { TurnspikeClient, type ClientOptions, type PaidFetchResult } from "../../../packages/client/src";
import { ProofPayload, SCHEME, b64, callCtx, chainOf, unb64 } from "./common";

/**
 * The released client pins the agent's next pending nonce per payment (crash recovery relies on it), so two payments from one
 * key must not overlap. This adapter serializes payments per agent address inside the process.
 */
const chains = new Map<string, Promise<unknown>>();
function serialized<T>(agent: string, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(agent) ?? Promise.resolve()).then(fn, fn);
  chains.set(agent, run.catch(() => undefined));
  return run;
}

export class TurnspikeX402Error extends Error {
  constructor(readonly code: string, message: string, readonly paid: boolean, readonly maybePaid: boolean, readonly result?: PaidFetchResult) {
    super(`${code}: ${message}`);
  }
}

/**
 * Client-side `turnspike-allowance`. It does NOT re-implement payment logic: it hands the x402 requirement to the unmodified
 * @turnspike-qie/client TurnspikeClient (payee allowlist, chain/contract/token trust, price ceilings, expiry margin, on-chain
 * policy and balance pre-checks, gas checks, approve callback, journal, nonce-pinned payment, crash recovery), as a turnspike/1
 * challenge, through an injected `fetch` that (a) serves the challenge and (b) captures the proof the client would redeem.
 * The proof becomes the x402 PAYMENT-SIGNATURE payload. The real HTTP request is made by the x402 client, not by this scheme.
 */
export class TurnspikeAllowanceClient implements SchemeNetworkClient {
  readonly scheme = SCHEME;
  private inner: TurnspikeClient;
  constructor(private opts: Omit<ClientOptions, "fetch">) {
    const shim: typeof fetch = async (_url, init) => {
      const ctx = callCtx.getStore();
      if (!ctx) throw new Error("turnspike-allowance: no call context (use TurnspikeX402.fetch)");
      const hdr = (init?.headers ?? {}) as Record<string, string>;
      const proof = hdr["x-payment"];
      if (!proof) return new Response(JSON.stringify(ctx.challenge), { status: 402, headers: { "content-type": "application/json" } });
      ctx.captured = proof; // the proof the TurnspikeClient would redeem; here it is handed to x402 as PAYMENT-SIGNATURE instead
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    this.inner = new TurnspikeClient({ ...opts, fetch: shim });
  }

  async createPaymentPayload(x402Version: number, r: PaymentRequirements): Promise<{ x402Version: number; payload: Record<string, unknown> }> {
    const ctx = callCtx.getStore();
    if (!ctx) throw new TurnspikeX402Error("no_call_context", "use the fetch wrapper that sets the call context", false, false);
    const x = (r.extra ?? {}) as any;
    const chainId = chainOf(r.network);
    if (!chainId || x.paymentFlow !== "upfront" || !x.requestId || !x.sig || !x.contract || !x.resourceId || !x.expiresAt) {
      throw new TurnspikeX402Error("invalid_challenge", "requirements are not a turnspike-allowance upfront challenge", false, false);
    }
    ctx.challenge = {
      error: "payment_required", protocol: x.protocol ?? "turnspike/1", requestId: x.requestId, sig: x.sig, priceBase: r.amount, token: r.asset,
      contract: x.contract, merchant: r.payTo, chainId, resourceId: x.resourceId, expiresAt: x.expiresAt, paymentDeadline: x.paymentDeadline,
    };
    // One logical purchase = one journal key. Default: this challenge. A caller-supplied key makes repeated calls for the
    // same intent (after an uncertain outcome) recover the earlier payment instead of paying a fresh challenge.
    const key = ctx.purchaseKey ?? `x402:${x.requestId}`;
    const res = await serialized(await this.agentAddress(), () => this.inner.fetch(ctx.url, ctx.init, { idempotencyKey: key }));
    if (!res.ok) throw new TurnspikeX402Error(res.error, res.message, res.paid, !!res.maybePaid, res);
    if (res.kind !== "paid" || !ctx.captured) throw new TurnspikeX402Error("no_proof", `client finished as ${res.kind} without a proof`, false, false, res);
    const p = unb64<ProofPayload>(ctx.captured);
    return { x402Version, payload: { requestId: p.requestId, txHash: p.txHash, sig: p.sig } };
  }

  private async agentAddress() { return (await this.opts.signer.getAddress()).toLowerCase(); }

  /** Continue an earlier purchase by key (journal) and return its proof, without any new payment decision. */
  async recover(key: string, url: string, init: RequestInit = {}): Promise<ProofPayload> {
    return callCtx.run({ url, init, purchaseKey: key }, async () => {
      const ctx = callCtx.getStore()!;
      const res = await this.inner.resume(key, init);
      if (!res.ok) throw new TurnspikeX402Error(res.error, res.message, res.paid, !!res.maybePaid, res);
      return unb64<ProofPayload>(ctx.captured!);
    });
  }
}

export { b64 };
