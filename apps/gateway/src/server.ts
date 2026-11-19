import express from "express";
import { JsonRpcProvider, NonceManager, Wallet } from "ethers";
import { turnpike, Store } from "../../../packages/middleware/src";
import { DemoAgent } from "./agent";

export interface GatewayEnv {
  RPC_URL_1: string; RPC_URL_2?: string; CHAIN_ID: string; QUSDC_ADDRESS: string; ALLOWANCE_ADDRESS: string; MERCHANT_ADDRESS: string;
  HMAC_SECRET: string; HMAC_SECRET_PREVIOUS?: string; CONFIRMATIONS?: string; CHALLENGE_TTL_SECONDS?: string; DB_PATH: string;
  PRICE_A_BASE_UNITS?: string; OWN_ADDRESSES?: string;
  DEMO_AGENT_KEY?: string; DEMO_OWNER?: string; PUBLIC_BASE_URL?: string; // demo runner is enabled only when these are set
}

/** Endpoint A (FR-017): real, deterministic read of the latest QIE block. */
export function createGateway(env: GatewayEnv) {
  const urls = [env.RPC_URL_1, env.RPC_URL_2].filter(Boolean) as string[];
  const chainId = Number(env.CHAIN_ID);
  const provider = new JsonRpcProvider(urls[0], chainId, { staticNetwork: true, cacheTimeout: -1 });
  const store = new Store(env.DB_PATH);
  const mw = turnpike({
    rpcUrls: urls, chainId, contract: env.ALLOWANCE_ADDRESS, token: env.QUSDC_ADDRESS, merchant: env.MERCHANT_ADDRESS,
    hmacSecrets: [env.HMAC_SECRET, ...(env.HMAC_SECRET_PREVIOUS ? [env.HMAC_SECRET_PREVIOUS] : [])], dbPath: env.DB_PATH, store,
    confirmations: Number(env.CONFIRMATIONS ?? 2), challengeTtlSeconds: Number(env.CHALLENGE_TTL_SECONDS ?? 300),
    prices: { "/block-summary": { resourceId: "block-summary", priceBase: env.PRICE_A_BASE_UNITS ?? "1000" } },
  });

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "10kb" })); // SEC-014 body limit
  app.use((_q, res, next) => { res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "x-payment,content-type"); res.setHeader("access-control-expose-headers", "*"); next(); });
  app.options("*", (_q, res) => res.sendStatus(204));

  app.get("/healthz", (_q, res) => res.json({ ok: true }));
  app.get("/v1/config", (_q, res) => res.json({
    chainId, contract: env.ALLOWANCE_ADDRESS, token: env.QUSDC_ADDRESS, merchant: env.MERCHANT_ADDRESS,
    priceBase: env.PRICE_A_BASE_UNITS ?? "1000", confirmations: Number(env.CONFIRMATIONS ?? 2), demoEnabled: Boolean(env.DEMO_AGENT_KEY && env.DEMO_OWNER),
    explorer: "https://mainnet.qie.digital",
  }));
  app.get("/v1/payments/:requestId", (req, res) => {
    const row = store.get(String(req.params.requestId).toLowerCase()); // status only, never data
    if (!row) return void res.status(404).json({ error: "unknown_request" });
    res.json({ state: row.state, txHash: row.txHash, expiresAt: row.expiresAt });
  });
  app.get("/v1/stats", (_q, res) => res.json(store.stats((env.OWN_ADDRESSES ?? "").split(",").filter(Boolean))));

  app.use("/v1", mw);
  app.get("/v1/block-summary", async (_q, res, next) => {
    try {
      const b = await provider.getBlock("latest");
      if (!b) throw new Error("no block");
      res.json({ blockNumber: b.number, timestamp: b.timestamp, txCount: b.transactions.length, chainId, source: "QIE RPC (live)" });
    } catch (e) { next(e); }
  });

  // Scripted demo agent for the playground (FR-019/FR-020). Spends only what the owner's on-chain policy allows.
  const agents = new Map<string, DemoAgent>();
  let busy = false;
  app.post("/demo/run/:scenario", async (req, res) => {
    if (!env.DEMO_AGENT_KEY || !env.DEMO_OWNER) return void res.status(404).json({ error: "demo_disabled" });
    if (busy) return void res.status(429).json({ error: "demo_busy" });
    busy = true;
    try {
      const signer = new NonceManager(new Wallet(env.DEMO_AGENT_KEY, provider));
      const a = agents.get("a") ?? new DemoAgent({ baseUrl: env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`, resourcePath: "/v1/block-summary", signer, provider, vault: env.ALLOWANCE_ADDRESS, owner: env.DEMO_OWNER });
      agents.set("a", a);
      const s = req.params.scenario;
      const out = s === "allowed" ? await a.paidCall() : s === "over-cap" ? await a.overCap() : s === "replay" ? await a.replay() : s === "after-revoke" ? await a.paidCall() : null;
      if (!out) return void res.status(400).json({ error: "unknown_scenario" });
      res.json(out);
    } catch (e: any) { res.status(500).json({ error: String(e?.shortMessage ?? e?.message ?? e) }); }
    finally { busy = false; }
  });

  app.use((err: any, _q: express.Request, res: express.Response, _n: express.NextFunction) => res.status(500).json({ error: "internal", detail: String(err?.message ?? err) }));
  return { app, store, close: () => { mw.close(); provider.destroy(); } };
}

if (require.main === module) {
  const env = process.env as unknown as GatewayEnv;
  const { app } = createGateway(env);
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => console.log(`turnpike gateway on :${port}`));
}
