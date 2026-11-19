import type { NextFunction, Request, RequestHandler, Response } from "express";
import { JsonRpcProvider, getAddress } from "ethers";
import { z } from "zod";
import { computeRequestId, newNonce, sign, verifySig, ChallengeFields } from "./challenge";
import { Store, PaymentRow } from "./store";
import { verifyPayment } from "./verify";

export { Store } from "./store";
export type { PaymentRow } from "./store";

export interface PriceRule {
  resourceId?: string; // defaults to the concrete request path
  priceBase: string | number | bigint;
  /** FR-018: optional probe run BEFORE a challenge is issued. Return a string reason to refuse with 503 (nothing charged). */
  preflight?: (req: Request) => Promise<string | null>;
}

export interface TurnpikeConfig {
  rpcUrls: string[];
  chainId: number;
  contract: string; // TurnpikeAllowance address
  token: string; // QUSDC address (returned in challenges)
  merchant: string;
  hmacSecrets: string[]; // [current, ...previous]; each >= 32 bytes
  dbPath: string;
  confirmations?: number; // default 2
  challengeTtlSeconds?: number; // default 300
  rateLimitPerMinute?: number; // default 60
  retryAfterSeconds?: number; // default 4
  /** Paths are relative to the mount point, e.g. "/block-summary" or "/price/:symbol". */
  prices: Record<string, PriceRule | string | number>;
  store?: Store;
}

const proofSchema = z.object({ requestId: z.string().regex(/^0x[0-9a-fA-F]{64}$/), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), sig: z.string().optional() });

function matchRule(prices: TurnpikeConfig["prices"], path: string): { resourceId: string; rule: PriceRule } | null {
  for (const [pattern, raw] of Object.entries(prices)) {
    const pp = pattern.split("/");
    const rp = path.split("/");
    if (pp.length !== rp.length) continue;
    if (pp.every((seg, i) => seg.startsWith(":") || seg === rp[i])) {
      const rule: PriceRule = typeof raw === "object" ? raw : { priceBase: raw };
      return { resourceId: rule.resourceId ?? path, rule };
    }
  }
  return null;
}

/**
 * Drop-in Express middleware (FR-016):  app.use('/paid', turnpike({...}))
 * Unpaid -> 402 challenge; valid proof -> next() is run once and its response is stored (idempotent replay).
 */
export function turnpike(cfg: TurnpikeConfig): RequestHandler & { store: Store; close(): void } {
  if (cfg.hmacSecrets.some((s) => Buffer.byteLength(s) < 32)) throw new Error("HMAC secret must be at least 32 bytes");
  const confirmations = cfg.confirmations ?? 2;
  const ttl = cfg.challengeTtlSeconds ?? 300;
  const retryAfter = cfg.retryAfterSeconds ?? 4;
  const limit = cfg.rateLimitPerMinute ?? 60;
  const contract = getAddress(cfg.contract);
  const merchant = getAddress(cfg.merchant);
  const token = getAddress(cfg.token);
  const store = cfg.store ?? new Store(cfg.dbPath);
  const providers = cfg.rpcUrls.map((u) => new JsonRpcProvider(u, cfg.chainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 })); // cacheTimeout -1: no ethers result cache, confirmations must be fresh
  const inFlight = new Set<string>();
  const hits = new Map<string, { n: number; reset: number }>();

  const now = () => Math.floor(Date.now() / 1000);

  const handler: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // SEC-014 rate limit (fixed window per IP)
      const ip = req.ip ?? "unknown";
      const h = hits.get(ip);
      if (!h || h.reset < now()) hits.set(ip, { n: 1, reset: now() + 60 });
      else if (++h.n > limit) return void res.status(429).json({ error: "rate_limited" });

      const m = matchRule(cfg.prices, req.path);
      if (!m) return next(); // free route
      const { resourceId, rule } = m;
      const header = req.header("x-payment");

      if (!header) return await issueChallenge(req, res, resourceId, rule);

      let proof;
      try {
        proof = proofSchema.parse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
      } catch {
        return void res.status(402).json({ error: "payment_required", reason: "malformed_proof" });
      }
      const requestId = proof.requestId.toLowerCase();
      const row = store.get(requestId);
      if (!row) return void res.status(402).json({ error: "payment_required", reason: "unknown_request" });

      // integrity: requestId must be derivable from the stored fields, and sig (if given) must verify
      const fields: ChallengeFields = { nonce: row.nonce, merchant: row.merchant, resourceId: row.resourceId, priceBase: row.priceBase, chainId: row.chainId, contract: row.contract, expiresAt: row.expiresAt };
      if (computeRequestId(fields).toLowerCase() !== requestId) return void res.status(402).json({ error: "payment_required", reason: "integrity" });
      if (proof.sig && !verifySig(cfg.hmacSecrets, requestId, fields, proof.sig)) return void res.status(402).json({ error: "payment_required", reason: "bad_signature" });

      // SEC-003: the proof authorizes only its own resource
      if (row.resourceId !== resourceId) return void res.status(403).json({ error: "wrong_resource" });

      if (row.state === "DELIVERED") return replay(res, row);
      if (row.state === "REJECTED") return void res.status(402).json({ error: "payment_required", reason: "rejected" });
      if (row.state === "EXPIRED") return void res.status(410).json({ error: "expired" });
      if (row.txHash && row.txHash.toLowerCase() !== proof.txHash.toLowerCase()) return void res.status(409).json({ error: "already_redeemed", reason: "different_tx" });

      if (row.state === "ISSUED" || row.state === "PAID_PENDING") {
        if (row.state === "ISSUED" && row.expiresAt < now()) {
          store.transition(requestId, ["ISSUED"], "EXPIRED", {}, "ttl");
          return void res.status(410).json({ error: "expired" });
        }
        if (row.state === "ISSUED") store.transition(requestId, ["ISSUED"], "PAID_PENDING", {}, "proof_submitted");
        const v = await verifyPayment(providers, row, proof.txHash, confirmations);
        if (v.kind === "rpc_unavailable") return void res.status(503).json({ error: "rpc_unavailable" });
        if (v.kind === "pending") return void res.status(202).json({ status: "pending", why: v.why, confirmations: v.confirmations, required: confirmations, retryAfter });
        if (v.kind === "rejected") {
          store.transition(requestId, ["PAID_PENDING"], "REJECTED", {}, v.reason);
          return void res.status(402).json({ error: "payment_required", reason: v.reason });
        }
        try {
          store.transition(requestId, ["PAID_PENDING"], "PAID_CONFIRMED", { txHash: proof.txHash.toLowerCase(), blockNumber: v.blockNumber, payer: v.payer }, "verified");
        } catch (e) {
          // txHash UNIQUE: this tx already backs a different request
          store.transition(requestId, ["PAID_PENDING"], "REJECTED", {}, "tx_reused");
          return void res.status(409).json({ error: "already_redeemed", reason: "tx_reused" });
        }
      }

      // state is now PAID_CONFIRMED: run the handler once (also the crash-recovery path)
      const cur = store.get(requestId)!;
      if (cur.state === "DELIVERED") return replay(res, cur);
      if (inFlight.has(requestId)) return void res.status(202).json({ status: "pending", why: "delivering", retryAfter });
      inFlight.add(requestId);
      captureAndDeliver(req, res, next, requestId, () => inFlight.delete(requestId));
    } catch (e) {
      next(e);
    }
  };

  async function issueChallenge(req: Request, res: Response, resourceId: string, rule: PriceRule) {
    if (rule.preflight) {
      const reason = await rule.preflight(req);
      if (reason) return void res.status(503).json({ error: reason }); // nothing charged, no challenge
    }
    const f: ChallengeFields = { nonce: newNonce(), merchant, resourceId, priceBase: BigInt(rule.priceBase).toString(), chainId: cfg.chainId, contract, expiresAt: now() + ttl };
    const requestId = computeRequestId(f);
    store.insert({ requestId, ...f });
    res.status(402).json({
      error: "payment_required", requestId, sig: sign(cfg.hmacSecrets[0], requestId, f), priceBase: f.priceBase, token,
      contract, merchant, chainId: cfg.chainId, resourceId, expiresAt: f.expiresAt,
    });
  }

  function replay(res: Response, row: PaymentRow) {
    res.status(row.responseStatus ?? 200).type(row.responseType ?? "application/json").send(row.responseBody ?? "");
  }

  /** Lets the downstream handler run, captures its body, stores it and marks DELIVERED. Only 2xx is stored. */
  function captureAndDeliver(req: Request, res: Response, next: NextFunction, requestId: string, done: () => void) {
    const chunks: Buffer[] = [];
    const w = res.write.bind(res) as typeof res.write;
    const e = res.end.bind(res) as typeof res.end;
    (res as any).write = (chunk: any, ...a: any[]) => (chunks.push(Buffer.from(chunk)), (w as any)(chunk, ...a));
    (res as any).end = (chunk?: any, ...a: any[]) => {
      if (chunk && typeof chunk !== "function") chunks.push(Buffer.from(chunk));
      const out = (e as any)(chunk, ...a);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.transition(requestId, ["PAID_CONFIRMED"], "DELIVERED", {
          responseBody: Buffer.concat(chunks).toString("utf8"), responseStatus: res.statusCode,
          responseType: String(res.getHeader("content-type") ?? "application/json"),
        }, "handler_ok");
      } // a failed handler leaves PAID_CONFIRMED so the same proof can be retried (FR-014)
      done();
      return out;
    };
    res.on("close", done);
    next();
  }

  const mw = handler as RequestHandler & { store: Store; close(): void };
  mw.store = store;
  mw.close = () => {
    for (const p of providers) p.destroy();
    if (!cfg.store) store.close();
  };
  return mw;
}
