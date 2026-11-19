import express from "express";
import { Contract, JsonRpcProvider, NonceManager, Wallet, getAddress, id } from "ethers";
import { z } from "zod";
import { turnspike, Store } from "../../../packages/middleware/src";
import { DemoAgent } from "./agent";
import { DEFAULT_LIMITS, DemoGuard } from "./demo-guard";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");
const envSchema = z.object({
  RPC_URL_1: z.string().url(), RPC_URL_2: z.string().url().optional(), CHAIN_ID: z.coerce.number().int().positive(),
  QUSDC_ADDRESS: addr, ALLOWANCE_ADDRESS: addr, MERCHANT_ADDRESS: addr,
  HMAC_SECRET: z.string().min(32, "HMAC_SECRET must be at least 32 characters"), HMAC_SECRET_PREVIOUS: z.string().min(32).optional(),
  CONFIRMATIONS: z.coerce.number().int().min(1).default(2), CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  DB_PATH: z.string().min(1), PRICE_A_BASE_UNITS: z.string().regex(/^\d+$/).default("1000"), PRICE_ADDRESS_BASE_UNITS: z.string().regex(/^\d+$/).default("1000"),
  PRICE_ACTIVITY_BASE_UNITS: z.string().regex(/^\d+$/).default("2000"),
  OWN_ADDRESSES: z.string().optional(), ALLOWED_ORIGINS: z.string().optional(), PUBLIC_BASE_URL: z.string().url().optional(),
  DEMO_AGENT_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(), DEMO_OWNER: addr.optional(), DEMO_ENABLED: z.enum(["true", "false"]).default("true"),
  DEMO_POW_BITS: z.coerce.number().int().min(0).max(26).default(DEFAULT_LIMITS.powBits),
  DEMO_PER_IP_HOUR: z.coerce.number().int().min(0).default(DEFAULT_LIMITS.perIpHour),
  DEMO_PER_IP_DAY: z.coerce.number().int().min(0).default(DEFAULT_LIMITS.perIpDay),
  DEMO_TX_PER_DAY: z.coerce.number().int().min(0).default(DEFAULT_LIMITS.globalTxPerDay),
  RECONCILE: z.enum(["true", "false"]).default("true"),
  DEMO_MIN_AGENT_GAS_WEI: z.string().regex(/^\d+$/).default("800000000000000"), // 0.0008 QIE: below this the demo refuses to run
});
export type GatewayEnv = Record<string, string | undefined>;

/** Validated runtime configuration. Throws with a readable list of problems instead of failing later. */
export function loadEnv(raw: GatewayEnv) {
  const r = envSchema.safeParse(raw);
  if (!r.success) throw new Error("Invalid gateway configuration: " + r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

// Fly's proxy sets fly-client-ip; trust it only when actually running on Fly (otherwise a caller could forge it to dodge quotas).
const onFly = !!process.env.FLY_APP_NAME;
const clientIp = (req: express.Request) => String((onFly ? req.header("fly-client-ip") : undefined) ?? req.ip ?? "unknown");
const ACTIVITY_MAX_BLOCKS = 50_000;
const ACTIVITY_DEFAULT_BLOCKS = 20_000;
const KNOWN_SCENARIOS = ["allowed", "over-cap", "replay", "unauthorized-merchant"] as const;

export function createGateway(raw: GatewayEnv) {
  const env = loadEnv(raw);
  const urls = [env.RPC_URL_1, env.RPC_URL_2].filter(Boolean) as string[];
  const chainId = env.CHAIN_ID;
  const provider = new JsonRpcProvider(urls[0], chainId, { staticNetwork: true, cacheTimeout: -1 });
  const store = new Store(env.DB_PATH);
  const demoOn = env.DEMO_ENABLED === "true" && !!env.DEMO_AGENT_KEY && !!env.DEMO_OWNER;
  const guard = new DemoGuard(store.db, env.HMAC_SECRET, { powBits: env.DEMO_POW_BITS, powTtlSeconds: DEFAULT_LIMITS.powTtlSeconds, perIpHour: env.DEMO_PER_IP_HOUR, perIpDay: env.DEMO_PER_IP_DAY, globalTxPerDay: env.DEMO_TX_PER_DAY });
  const mw = turnspike({
    rpcUrls: urls, chainId, contract: env.ALLOWANCE_ADDRESS, token: env.QUSDC_ADDRESS, merchant: env.MERCHANT_ADDRESS,
    hmacSecrets: [env.HMAC_SECRET, ...(env.HMAC_SECRET_PREVIOUS ? [env.HMAC_SECRET_PREVIOUS] : [])], dbPath: env.DB_PATH, store,
    confirmations: env.CONFIRMATIONS, challengeTtlSeconds: env.CHALLENGE_TTL_SECONDS,
    prices: {
      "/block-summary": { resourceId: "block-summary", priceBase: env.PRICE_A_BASE_UNITS },
      "/address/:address": { priceBase: env.PRICE_ADDRESS_BASE_UNITS, validate: (req) => (/^0x[0-9a-fA-F]{40}$/.test(req.path.split("/")[2] ?? "") ? null : "invalid_address") }, // resourceId is the concrete path, so a proof for one address never unlocks another; invalid input is refused before any charge
      "/qusdc-activity/:address": {
        priceBase: env.PRICE_ACTIVITY_BASE_UNITS,
        binding: { query: true }, // the window is part of what was bought
        validate: (req) => {
          if (!/^0x[0-9a-fA-F]{40}$/.test(req.path.split("/")[2] ?? "")) return "invalid_address";
          const b = req.query.blocks;
          if (b !== undefined && !(/^[0-9]+$/.test(String(b)) && Number(b) >= 100 && Number(b) <= ACTIVITY_MAX_BLOCKS)) return "blocks_out_of_range";
          return null;
        },
      },
    },
  });

  // Reconcile the chain first (recovers payments made during an outage), then purge only what can no longer be paid.
  const housekeeping = async () => {
    try { await mw.reconcile(); } catch (e: any) { console.error(JSON.stringify({ evt: "reconcile_failed", message: String(e?.shortMessage ?? e?.message ?? e) })); }
    try { mw.purge(); } catch { /* store closed */ }
  };
  if (env.RECONCILE !== "false") void housekeeping();
  const purge = setInterval(() => void housekeeping(), 900_000);
  purge.unref();

  const origins = (env.ALLOWED_ORIGINS ?? "*").split(",").map((o) => o.trim()).filter(Boolean);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "10kb" })); // SEC-014 body limit
  app.use((req, res, next) => {
    const o = req.header("origin");
    if (origins.includes("*")) res.setHeader("access-control-allow-origin", "*");
    else if (o && origins.includes(o)) { res.setHeader("access-control-allow-origin", o); res.setHeader("vary", "Origin"); }
    res.setHeader("access-control-allow-headers", "x-payment,x-demo-pow,content-type,x-correlation-id");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-expose-headers", "retry-after,x-correlation-id");
    res.setHeader("x-content-type-options", "nosniff");
    next();
  });
  app.options("*", (_q, res) => res.sendStatus(204));

  app.get("/healthz", (_q, res) => res.json({ ok: true }));
  app.get("/v1/config", (_q, res) => res.json({
    chainId, contract: env.ALLOWANCE_ADDRESS, token: env.QUSDC_ADDRESS, merchant: env.MERCHANT_ADDRESS,
    priceBase: env.PRICE_A_BASE_UNITS, priceAddressBase: env.PRICE_ADDRESS_BASE_UNITS, priceActivityBase: env.PRICE_ACTIVITY_BASE_UNITS, confirmations: env.CONFIRMATIONS, demoEnabled: demoOn,
    explorer: "https://mainnet.qie.digital",
  }));
  app.get("/v1/payments/:requestId", (req, res) => {
    const row = store.get(String(req.params.requestId).toLowerCase()); // status only, never data
    if (!row) return void res.status(404).json({ error: "unknown_request" });
    res.json({ state: row.state, txHash: row.txHash, expiresAt: row.expiresAt });
  });
  app.get("/v1/stats", (_q, res) => res.json(store.stats((env.OWN_ADDRESSES ?? "").split(",").filter(Boolean))));

  // ---- demo agent (guarded). See demo-guard.ts for the threat model.
  app.get("/demo/status", async (_q, res) => {
    if (!demoOn) return void res.json({ enabled: false });
    let gas: string | null = null;
    try { gas = (await provider.getBalance(new Wallet(env.DEMO_AGENT_KEY!).address)).toString(); } catch { /* unknown */ }
    res.json({ enabled: true, ...guard.status(), agentGasOk: gas === null ? null : BigInt(gas) >= BigInt(env.DEMO_MIN_AGENT_GAS_WEI) });
  });
  app.get("/demo/challenge", (req, res) => {
    if (!demoOn) return void res.status(404).json({ error: "demo_disabled" });
    res.setHeader("cache-control", "no-store");
    res.json(guard.challenge(clientIp(req)));
  });

  const agentSigner = demoOn ? new NonceManager(new Wallet(env.DEMO_AGENT_KEY!, provider)) : null;
  const agents = new Map<string, DemoAgent>();
  let busy = false;
  app.post("/demo/run/:scenario", async (req, res) => {
    if (!demoOn || !agentSigner) return void res.status(404).json({ error: "demo_disabled" });
    const scenario = String(req.params.scenario);
    if (!(KNOWN_SCENARIOS as readonly string[]).includes(scenario)) return void res.status(400).json({ error: "unknown_scenario" });
    if (busy) return void res.status(429).json({ error: "demo_busy" }); // checked first so a busy answer does not burn a puzzle or quota
    const ip = clientIp(req);
    const pow = guard.consumePow(req.header("x-demo-pow"), ip);
    if (!pow.ok) return void res.status(pow.status).json({ error: pow.error });
    busy = true;
    try {
      const gas = await provider.getBalance(await agentSigner.getAddress());
      if (gas < BigInt(env.DEMO_MIN_AGENT_GAS_WEI)) return void res.status(503).json({ error: "demo_funds_low" }); // protects the key from being run dry; refused runs do not consume quota
      const q = guard.reserve(ip, scenario);
      if (!q.ok) { res.setHeader("retry-after", String(q.retryAfterSeconds)); return void res.status(q.status).json({ error: q.error, scope: q.scope, retryAfterSeconds: q.retryAfterSeconds }); }

      let a = agents.get("a");
      if (!a) {
        a = new DemoAgent({ baseUrl: env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`, resourcePath: "/v1/block-summary", signer: agentSigner, provider, vault: env.ALLOWANCE_ADDRESS, owner: env.DEMO_OWNER! });
        agents.set("a", a);
      }
      const out = scenario === "allowed" ? await a.paidCall() : scenario === "over-cap" ? await a.overCap() : scenario === "replay" ? await a.replay() : await a.unauthorizedMerchant();
      console.log(JSON.stringify({ evt: "demo_run", scenario, client: "redacted", ok: out.steps.every((s) => s.ok) }));
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: String(e?.shortMessage ?? e?.message ?? e) });
    } finally { busy = false; }
  });

  // ---- paid endpoints
  app.use("/v1", mw);
  app.get("/v1/block-summary", async (_q, res, next) => {
    try {
      const b = await provider.getBlock("latest");
      if (!b) throw new Error("no block");
      res.json({ blockNumber: b.number, timestamp: b.timestamp, txCount: b.transactions.length, chainId, source: "QIE RPC (live)" });
    } catch (e) { next(e); }
  });
  /** A second real endpoint: live balances and code status for any QIE address, including its QUSDC balance. */
  app.get("/v1/address/:address", async (req, res, next) => {
    try {
      const a = String(req.params.address);
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return void res.status(400).json({ error: "invalid_address" });
      const token = new Contract(env.QUSDC_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
      const [qie, nonce, code, qusdc, block] = await Promise.all([provider.getBalance(a), provider.getTransactionCount(a), provider.getCode(a), token.balanceOf(a), provider.getBlockNumber()]);
      res.json({ address: a, qieWei: qie.toString(), qusdcBaseUnits: qusdc.toString(), nonce, isContract: code !== "0x", atBlock: block, chainId, source: "QIE RPC (live)" });
    } catch (e) { next(e); }
  });

  /**
   * Paid analytics: QUSDC flows for one address over a recent block window, computed from Transfer logs. Saves a buyer from
   * running their own log indexer: totals in and out, net flow, transfer counts and the largest counterparties.
   */
  app.get("/v1/qusdc-activity/:address", async (req, res, next) => {
    try {
      const a = getAddress(String(req.params.address));
      const blocks = Number(req.query.blocks ?? ACTIVITY_DEFAULT_BLOCKS);
      const head = await provider.getBlockNumber();
      const from = Math.max(0, head - blocks + 1);
      const topic = id("Transfer(address,address,uint256)");
      const pad = "0x" + a.slice(2).toLowerCase().padStart(64, "0");
      const get = async (topics: (string | null)[]) => {
        const out = [];
        for (let f = from; f <= head; f += 5000) out.push(...(await provider.getLogs({ address: env.QUSDC_ADDRESS, topics, fromBlock: f, toBlock: Math.min(head, f + 4999) })));
        return out;
      };
      const [incoming, outgoing] = await Promise.all([get([topic, null, pad]), get([topic, pad, null])]);
      const amt = (l: { data: string }) => BigInt(l.data);
      const peers = new Map<string, { in: bigint; out: bigint; count: number }>();
      const bump = (who: string, k: "in" | "out", v: bigint) => { const p = peers.get(who) ?? { in: 0n, out: 0n, count: 0 }; p[k] += v; p.count++; peers.set(who, p); };
      for (const l of incoming) bump(getAddress("0x" + l.topics[1].slice(26)), "in", amt(l));
      for (const l of outgoing) bump(getAddress("0x" + l.topics[2].slice(26)), "out", amt(l));
      const inT = incoming.reduce((s, l) => s + amt(l), 0n), outT = outgoing.reduce((s, l) => s + amt(l), 0n);
      const top = [...peers.entries()].sort((x, y) => { const d = (y[1].in + y[1].out) - (x[1].in + x[1].out); return d > 0n ? 1 : d < 0n ? -1 : 0; }).slice(0, 10)
        .map(([address, p]) => ({ address, inBase: p.in.toString(), outBase: p.out.toString(), transfers: p.count }));
      const all = [...incoming, ...outgoing].map((l) => l.blockNumber);
      res.json({
        address: a, token: env.QUSDC_ADDRESS, decimals: 6, fromBlock: from, toBlock: head, chainId,
        incoming: { count: incoming.length, totalBase: inT.toString() }, outgoing: { count: outgoing.length, totalBase: outT.toString() },
        netBase: (inT - outT).toString(), firstActivityBlock: all.length ? Math.min(...all) : null, lastActivityBlock: all.length ? Math.max(...all) : null,
        topCounterparties: top, source: "QIE RPC Transfer logs (live)",
      });
    } catch (e) { next(e); }
  });

  // The public site is a separate Next.js app (apps/web); the gateway serves the API only.
  app.get("/", (_q, res) => res.json({ service: "turnspike-gateway", endpoints: ["/healthz", "/v1/config", "/v1/stats", "/v1/block-summary (402)", "/v1/address/:address (402)", "/v1/qusdc-activity/:address?blocks=N (402)", "/demo/status"] }));

  app.use((err: any, _q: express.Request, res: express.Response, _n: express.NextFunction) => {
    console.error(JSON.stringify({ evt: "unhandled_error", message: String(err?.message ?? err) }));
    res.status(500).json({ error: "internal" }); // never echo internals to the caller
  });
  return { app, store, guard, close: () => { clearInterval(purge); mw.close(); provider.destroy(); store.close(); } };
}

if (require.main === module) {
  const { app } = createGateway(process.env as GatewayEnv);
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => console.log(`turnspike gateway on :${port}`));
}
