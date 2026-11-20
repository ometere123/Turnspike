import type { AssetAmount, Network, PaymentRequirements, Price, SchemeNetworkServer, SupportedKind } from "@x402/core/types";
import { ASSET_TRANSFER_METHOD, DYNAMIC_EXTRA, PAYMENT_FLOW, SCHEME, TURNSPIKE_PROTOCOL, caip2 } from "../common";

export interface ServerSchemeConfig {
  chainId: number;
  contract: string;
  token: string;
  decimals?: number;
}

/**
 * Resource-server side of `turnspike-allowance` for the official @x402/core x402ResourceServer.
 *
 * It only describes requirements; it never mints a challenge. Challenges (and their database rows) are issued by the
 * turnspike middleware on the unpaid request, from which the PAYMENT-REQUIRED header is built. On a paid request the
 * requirements built here are what the client's `accepted` is matched against: per-challenge fields are dynamic
 * (excluded), and `extra.resourceId` (derived by the middleware from the request) is static, so a proof can never match
 * another resource. Payment flow is `upfront` only: settle runs before the handler and verify is never used.
 */
export class TurnspikeAllowanceServer implements SchemeNetworkServer {
  readonly scheme = SCHEME;
  readonly defaultAssetTransferMethod = ASSET_TRANSFER_METHOD;
  readonly paymentFlows = { [ASSET_TRANSFER_METHOD]: { supported: [PAYMENT_FLOW], default: PAYMENT_FLOW } } as const;
  readonly dynamicExtraFields = DYNAMIC_EXTRA;
  constructor(private readonly cfg: ServerSchemeConfig) {}

  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (network !== caip2(this.cfg.chainId)) throw new Error(`turnspike-allowance is configured for ${caip2(this.cfg.chainId)}, not ${network}`);
    if (price && typeof price === "object" && "amount" in price) {
      if (!/^[1-9][0-9]*$/.test(String(price.amount))) throw new Error("turnspike-allowance needs a positive integer amount in base units");
      if (price.asset && price.asset.toLowerCase() !== this.cfg.token.toLowerCase()) throw new Error("turnspike-allowance prices are in the configured token only");
      return { amount: String(price.amount), asset: this.cfg.token, ...(price.extra ? { extra: price.extra } : {}) };
    }
    throw new Error("turnspike-allowance needs an explicit { amount, asset } price in base units (no dollar-string default asset)");
  }

  getAssetDecimals(): number {
    return this.cfg.decimals ?? 6;
  }

  async enhancePaymentRequirements(r: PaymentRequirements, _kind: SupportedKind): Promise<PaymentRequirements> {
    return {
      ...r,
      extra: { ...r.extra, protocol: TURNSPIKE_PROTOCOL, contract: this.cfg.contract, assetTransferMethod: ASSET_TRANSFER_METHOD, paymentFlow: PAYMENT_FLOW },
    };
  }
}
