import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { paymentMiddlewareFromHTTPServer } from "@x402/express";
import { x402HTTPResourceServer, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { Network, PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import type { TurnspikeMiddleware } from "@turnspike-qie/middleware";
import { defaultProduction, type ResourceUrlPolicy } from "@turnspike-qie/middleware/origin";
import { ErrorCodes, SCHEME, TRANSIENT_MESSAGES, isX402V1Shaped, paymentPayloadSchema, unb64json } from "./common";
import { LocalFacilitatorClient } from "./facilitator-client";
import { TurnspikeAllowanceServer } from "./scheme/server";

export interface X402SellerOptions {
  /**
   * Facilitator used to settle. Default: an in-process LocalFacilitatorClient over `mw` (no network hop; the HMAC secret
   * never leaves the process). Pass a RemoteFacilitatorClient for a standalone authenticated facilitator.
   */
  facilitator?: FacilitatorClient;
  /** PaymentRequired.resource description and mimeType on error responses produced by the x402 SDK. */
  description?: string;
  mimeType?: string;
  /** Maximum PAYMENT-SIGNATURE header length in characters. Default 8192. */
  maxHeaderLength?: number;
  /**
   * O4: production mode. Default: production unless NODE_ENV is "development" or "test" (unset counts as production). In production x402Seller throws at construction
   * unless the middleware was created with a trusted public origin (x402.publicOrigin, or x402.resourceUrl as an origin
   * string or a header-free resolver).
   */
  production?: boolean;
}

/**
 * O4: true when the presented resource.url names the canonical URL of the current request. With a configured public origin
 * (or resolver) the comparison is exact after normalisation: origin, path and query. In the non-production dev fallback
 * the origin is unknown and only the path and query are compared. `trust proxy` never makes the request's own origin
 * (Host, X-Forwarded-*) trusted. The proof itself is also bound to the resource by resourceId (mw.settleProof).
 */
function sameResource(policy: ResourceUrlPolicy, presented: string, d: { resourceUrl: string; resourceUrlTrusted: boolean; resourcePathAndQuery: string }): boolean {
  return policy.matches(presented, { ok: true, url: d.resourceUrl, trusted: d.resourceUrlTrusted, pathAndQuery: d.resourcePathAndQuery });
}

interface Scope { resourceId: string; priceBase: string; correlationId: string; settle?: SettleResponse }

/**
 * One route, both protocols. Mount it where the turnspike middleware would be mounted:
 *
 *   const mw = turnspike({ ...cfg, x402: true });
 *   app.use("/v1", x402Seller(mw));
 *   app.get("/v1/report", handler);
 *
 * Header negotiation:
 *  - X-PAYMENT                -> turnspike/1, handled by the unchanged middleware;
 *  - PAYMENT-SIGNATURE        -> x402 v2 through the official @x402/express middleware and x402ResourceServer with the
 *                                registered `turnspike-allowance` scheme; delivery through the middleware's fenced lease
 *                                and stored-response replay (mw.deliver);
 *  - both                     -> 400 ambiguous_payment_headers;
 *  - an x402 v1-shaped payload (in either header) -> 400 unsupported_x402_version;
 *  - neither                  -> the middleware's 402: the turnspike/1 JSON body plus a PAYMENT-REQUIRED header built
 *                                from the same signed challenge row.
 * Both protocols run the same proof checks (mw.settleProof), so a proof unlocks only its own resource, merchant, network,
 * token and amount, whichever header carries it, and is delivered once (later presentations replay the stored response).
 */
export function x402Seller(mw: TurnspikeMiddleware, opts: X402SellerOptions = {}): RequestHandler {
  const info = mw.info;
  if (!info?.x402) throw new Error("x402Seller needs the turnspike middleware created with x402 enabled (config `x402: true`)");
  const policy = mw.resourcePolicy;
  if (!policy) throw new Error("x402Seller: the middleware has no resource URL policy (x402 not enabled)");
  const production = opts.production ?? defaultProduction();
  if ((production || policy.production) && policy.mode === "dev") {
    throw new Error("x402Seller: production requires a trusted public origin; create the middleware with x402.publicOrigin (or x402.resourceUrl)");
  }
  const scope = new AsyncLocalStorage<Scope>();
  const base = opts.facilitator ?? new LocalFacilitatorClient(mw);
  // Observe settle results (for the 503 mapping of transient failures); the official server still drives the flow.
  const facilitator: FacilitatorClient = {
    verify: (p, r) => base.verify(p, r),
    getSupported: () => base.getSupported(),
    settle: async (p: PaymentPayload, r: PaymentRequirements) => {
      const out = await base.settle(p, r);
      const s = scope.getStore();
      if (s) s.settle = out;
      return out;
    },
  };
  const server = new x402ResourceServer(facilitator);
  server.register(info.network as Network, new TurnspikeAllowanceServer({ chainId: info.chainId, contract: info.contract, token: info.token, resource: policy }));
  const routes = {
    "*": {
      accepts: {
        scheme: SCHEME,
        network: info.network as Network,
        payTo: info.merchant,
        maxTimeoutSeconds: info.maxTimeoutSeconds,
        // the price and resource of THIS request, as the middleware derives them (same rule table, same resource id)
        price: () => {
          const s = scope.getStore();
          if (!s) throw new Error("x402Seller: no request scope");
          return { amount: s.priceBase, asset: info.token, extra: { resourceId: s.resourceId } };
        },
      },
      description: opts.description ?? "",
      mimeType: opts.mimeType ?? "",
    },
  };
  const official = paymentMiddlewareFromHTTPServer(new x402HTTPResourceServer(server, routes), undefined, undefined, true);
  const maxLen = opts.maxHeaderLength ?? 8192;

  return async (req: Request, res: Response, next: NextFunction) => {
    const sigHeader = req.header("payment-signature");
    const xPayment = req.header("x-payment");
    const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) => {
      mw.log({ evt: "x402.refused", reason: error, status });
      res.setHeader("cache-control", "no-store");
      return void res.status(status).json({ error, ...extra });
    };
    try {
      if (sigHeader && xPayment) return refuse(400, "ambiguous_payment_headers", { message: "send either X-PAYMENT (turnspike/1) or PAYMENT-SIGNATURE (x402 v2), not both" });
      if (xPayment) {
        let decoded: unknown = null;
        try { decoded = unb64json(xPayment, 8192); } catch { /* not JSON: the middleware answers malformed_proof */ }
        if (isX402V1Shaped(decoded)) return refuse(400, "unsupported_x402_version", { message: "x402 v1 payloads are not supported; use x402 v2 (PAYMENT-SIGNATURE) with the turnspike-allowance scheme" });
        return mw(req, res, next); // turnspike/1, unchanged
      }
      if (!sigHeader) return mw(req, res, next); // unpaid: the middleware issues the challenge (JSON + PAYMENT-REQUIRED)

      // ---- x402 v2
      const correlationId = (req.header("x-correlation-id") ?? "").slice(0, 64).replace(/[^\w.-]/g, "") || randomUUID();
      res.setHeader("x-correlation-id", correlationId);
      if (!mw.admit(req)) return refuse(429, "rate_limited");
      const d = await mw.describe(req);
      if (d.kind === "free") return next();
      if (d.kind === "invalid") { mw.log({ evt: "x402.refused", reason: "invalid_request", status: d.status, correlationId }); return void res.status(d.status).json(d.body); }
      if (sigHeader.length > maxLen) return refuse(400, "invalid_payment_signature", { message: "header too long" });
      let decoded: unknown;
      try { decoded = unb64json(sigHeader, maxLen); } catch { return refuse(400, "invalid_payment_signature", { message: "PAYMENT-SIGNATURE is not base64 JSON" }); }
      if (isX402V1Shaped(decoded)) return refuse(400, "unsupported_x402_version", { message: "x402 v1 payloads are not supported; use x402 v2" });
      if ((decoded as any)?.x402Version !== 2) return refuse(400, ErrorCodes.invalidX402Version);
      const parsed = paymentPayloadSchema.safeParse(decoded);
      if (!parsed.success) {
        // a v2 payload for another scheme, or a malformed one: never reaches settlement
        const scheme = (decoded as any)?.accepted?.scheme;
        return refuse(400, scheme !== SCHEME ? ErrorCodes.invalidScheme : ErrorCodes.invalidPayload, scheme !== SCHEME ? { message: `scheme ${String(scheme).slice(0, 40)} is not accepted here; this endpoint accepts ${SCHEME} only` } : {});
      }
      const requestId = parsed.data.payload.requestId.toLowerCase();
      // F2: the per-challenge fields the client echoes must be the ones this server issued, and resource.url (when sent)
      // must name this request (O4: canonical origin, path and query). Otherwise a valid proof could carry a forged
      // requirement through.
      const acc = parsed.data.accepted;
      if (acc.extra.resourceId !== d.resourceId) {
        return refuse(402, ErrorCodes.wrongResource, { message: "accepted.extra.resourceId does not name this resource" });
      }
      const row = mw.store.get(requestId);
      // R1: the resourceId is relative to the mount, so one middleware instance mounted under two prefixes (/a and /b)
      // issues the same resourceId for /a/x and /b/x. The stored row records the mount prefix it was issued under; a proof
      // is accepted only under that prefix, whether or not the payload carries `resource`.
      if (row && row.mount != null && row.mount !== (req.baseUrl ?? "")) {
        return refuse(402, ErrorCodes.wrongResource, { message: "the challenge was issued for this resource under another mount path" });
      }
      if (row && (acc.extra.expiresAt !== row.expiresAt || acc.extra.paymentDeadline !== row.expiresAt + info.paymentGraceSeconds)) {
        return refuse(402, ErrorCodes.extraMismatch, { message: "accepted.extra expiresAt/paymentDeadline differ from the issued challenge" });
      }
      if (parsed.data.resource != null && !sameResource(policy, parsed.data.resource.url, d)) {
        return refuse(402, ErrorCodes.wrongResource, { message: "resource.url does not name this resource" });
      }

      // A transient settle failure (RPC or storage) is a 503, not a payment refusal.
      const realStatus = res.status.bind(res);
      (res as any).status = (code: number) => {
        const s = scope.getStore() ?? current;
        const st = s?.settle;
        if (code === 402 && st && !st.success && st.errorReason === ErrorCodes.unexpectedSettleError && TRANSIENT_MESSAGES.has(String(st.errorMessage))) {
          res.setHeader("retry-after", "4");
          return realStatus(503);
        }
        return realStatus(code);
      };
      const current: Scope = { resourceId: d.resourceId, priceBase: d.priceBase, correlationId };
      await scope.run(current, () =>
        official(req, res, (err?: unknown) => {
          if (err) return next(err);
          (res as any).status = realStatus;
          mw.log({ evt: "x402.deliver", correlationId, requestId });
          return mw.deliver(req, res, requestId, next, { correlationId, protocol: "x402" });
        }),
      );
      if (current.settle && !current.settle.success) {
        mw.log({ evt: "x402.refused", correlationId, requestId, reason: current.settle.errorReason });
      }
    } catch (e) {
      next(e);
    }
  };
}
