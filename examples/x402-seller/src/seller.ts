// Minimal x402 v2 seller (custom scheme `turnspike-allowance`) on top of the Turnspike middleware.
//
// One Express route, two protocols on the same path:
//   - no payment header        -> 402 with the turnspike/1 JSON body AND an x402 v2 PAYMENT-REQUIRED header
//   - PAYMENT-SIGNATURE (v2)   -> settled in-process (LocalFacilitatorClient, the default), then the handler runs once
//   - X-PAYMENT (turnspike/1)  -> handled by the unchanged middleware
//
// Nothing here holds a private key: the seller never sends a transaction. It only checks that the agent already paid the
// TurnpikeAllowance vault for this exact challenge.
import express from "express";
import { turnspike } from "@turnspike-qie/middleware";
import { x402Seller } from "@turnspike-qie/x402";

export interface SellerConfig {
  rpcUrl: string;
  chainId: number;
  /** TurnpikeAllowance contract address. */
  contract: string;
  /** ERC-20 the vault pays in (QUSDC on QIE; MockERC20 on a local Hardhat chain). */
  token: string;
  /** Address that receives payments. Only an address: no key. */
  merchant: string;
  /** HMAC secret that signs challenges (at least 32 bytes). Keep it secret; rotate by prepending a new one. */
  hmacSecret: string;
  /** SQLite file for challenges and stored responses. */
  dbPath: string;
  /** Price of GET /v1/report in token base units (6 decimals: 2500 = 0.0025). */
  priceBase?: number;
  /**
   * Public origin, e.g. "https://api.example.com". It configures `x402.resourceUrl`, which is REQUIRED in production.
   * Defaults to the PUBLIC_ORIGIN environment variable. When neither is set and NODE_ENV is "production", createSeller
   * throws; in development it warns and falls back to the origin Express sees (fine on a local chain only).
   */
  publicOrigin?: string;
  confirmations?: number;
}

export function createSeller(cfg: SellerConfig) {
  const publicOrigin = (cfg.publicOrigin ?? process.env.PUBLIC_ORIGIN)?.replace(/\/+$/, "");
  if (!publicOrigin) {
    const msg = "x402.resourceUrl is not configured: set PUBLIC_ORIGIN (e.g. https://api.example.com). Without it the seller " +
      "advertises the origin Express sees (the internal one behind a proxy) and compares resource.url by path only.";
    if (process.env.NODE_ENV === "production") throw new Error(msg + " Required when NODE_ENV=production.");
    console.warn(`warning: ${msg} Acceptable for local development only.`);
  }
  const mw = turnspike({
    rpcUrls: [cfg.rpcUrl],
    chainId: cfg.chainId,
    contract: cfg.contract,
    token: cfg.token,
    merchant: cfg.merchant,
    hmacSecrets: [cfg.hmacSecret],
    dbPath: cfg.dbPath,
    confirmations: cfg.confirmations ?? 2,
    prices: { "/report": cfg.priceBase ?? 2500 },
    // x402 v2: every 402 also carries PAYMENT-REQUIRED. resourceUrl (required in production) makes resource.url name the
    // public URL.
    x402: publicOrigin ? { resourceUrl: (req) => `${publicOrigin}${req.originalUrl}` } : true,
    // Recommended for public x402 deployments (see packages/middleware/README.md).
    guard: true,
    replayWindowSeconds: 86_400,
  });

  const app = express();
  // x402Seller must be mounted where the middleware would be mounted.
  app.use("/v1", x402Seller(mw, { description: "Example report", mimeType: "application/json" }));
  // The handler runs only after the payment is settled; a re-presented proof replays the stored response instead.
  app.get("/v1/report", (_req, res) => res.json({ report: "example data", generatedAt: new Date().toISOString() }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  return { app, mw };
}
