import type { SchemeNetworkServer, PaymentRequirements, Network } from "@x402/core/types";
import { computeRequestId, newNonce, sign, ChallengeFields } from "../../../packages/middleware/src/challenge";
import { Store } from "../../../packages/middleware/src/store";
import { ATM, DYNAMIC_EXTRA, SCHEME, caip2 } from "./common";

export interface ServerCfg {
  chainId: number; contract: string; token: string; hmacSecrets: string[]; store: Store;
  ttlSeconds?: number; paymentGraceSeconds?: number; decimals?: number;
}

/** Resource id a payment is bound to: method (non-GET) + path + sorted query. Same rule as @turnspike-qie/middleware resourceIdFor. */
export function resourceIdOf(method: string, path: string, query: Record<string, string | string[]> | undefined): string {
  let id = path;
  if (method !== "GET" && method !== "HEAD") id = `${method} ${id}`;
  const pairs = Object.entries(query ?? {})
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => [k, x] as [string, string]))
    .sort(([a, x], [c, y]) => (a === c ? (x < y ? -1 : 1) : a < c ? -1 : 1));
  if (pairs.length) id += "?" + new URLSearchParams(pairs).toString();
  return id;
}

/** Resource-server side of `turnspike-allowance`: pricing, per-request challenge minting, flow declaration (upfront only). */
export class TurnspikeAllowanceServer implements SchemeNetworkServer {
  readonly scheme = SCHEME;
  readonly defaultAssetTransferMethod = ATM;
  readonly paymentFlows = { [ATM]: { supported: ["upfront"], default: "upfront" } } as const;
  readonly dynamicExtraFields = DYNAMIC_EXTRA;
  constructor(private cfg: ServerCfg) {}

  async parsePrice(price: any, network: Network) {
    if (network !== caip2(this.cfg.chainId)) throw new Error(`turnspike-allowance is configured for ${caip2(this.cfg.chainId)}, not ${network}`);
    if (price && typeof price === "object" && "amount" in price) return { amount: String(price.amount), asset: price.asset ?? this.cfg.token };
    throw new Error("turnspike-allowance needs an explicit {amount, asset} price (no dollar-string default asset for this network)");
  }
  getAssetDecimals() { return this.cfg.decimals ?? 6; }

  async enhancePaymentRequirements(r: PaymentRequirements, kind: { extra?: Record<string, unknown> }): Promise<PaymentRequirements> {
    return { ...r, extra: { ...r.extra, ...kind.extra, assetTransferMethod: ATM, paymentFlow: "upfront", protocol: "turnspike/1", contract: this.cfg.contract } };
  }

  /** Runs on every request to the route. Mints a challenge only on the unpaid request; always states the resource id. */
  async enrichPaymentRequiredResponse(ctx: any): Promise<PaymentRequirements[]> {
    const req = ctx.transportContext?.request;
    const adapter = req?.adapter;
    const method = String(req?.method ?? adapter?.getMethod?.() ?? "GET").toUpperCase();
    const resourceId = resourceIdOf(method, adapter.getPath(), adapter.getQueryParams?.());
    const paying = !!adapter.getHeader("payment-signature");
    return ctx.requirements.map((r: PaymentRequirements) => {
      if (r.scheme !== SCHEME) return r;
      const extra = { ...r.extra, resourceId };
      if (paying) return { ...r, extra };
      const f: ChallengeFields = {
        nonce: newNonce(), merchant: r.payTo, resourceId, priceBase: r.amount, chainId: this.cfg.chainId, contract: this.cfg.contract,
        expiresAt: Math.floor(Date.now() / 1000) + (this.cfg.ttlSeconds ?? 300),
      };
      const requestId = computeRequestId(f);
      this.cfg.store.insert({ requestId, ...f });
      return { ...r, extra: { ...extra, requestId, sig: sign(this.cfg.hmacSecrets[0], requestId, f), expiresAt: f.expiresAt, paymentDeadline: f.expiresAt + (this.cfg.paymentGraceSeconds ?? 60) } };
    });
  }
}
