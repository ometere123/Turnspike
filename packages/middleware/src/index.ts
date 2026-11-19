import type { NextFunction, Request, RequestHandler, Response } from "express";
import { JsonRpcProvider, getAddress } from "ethers";
import { z } from "zod";
import { computeRequestId, newNonce, sign, verifySig, ChallengeFields } from "./challenge";
import { Store, PaymentRow } from "./store";
import { verifyPayment } from "./verify";

export { Store } from "./store";
export type { PaymentRow, State } from "./store";

/*
 * Security model
 * --------------
 * A paid response is a capability held by whoever presents the full proof: { requestId, txHash, sig }.
 *  - requestId and txHash are public once the payment is mined (they are in the Paid event).
 *  - sig is an HMAC that only the party that received the 402 challenge has seen. It is therefore the secret half of the
 *    capability and is REQUIRED on every redemption, including replays of a stored response.
 * Consequence: treat the sig like a session token. Anyone who obtains the sig and the transaction hash can fetch the stored
 * response, so do not put per-customer private data behind a Turnpike route unless you also authenticate the caller yourself
 * (for example with an Express middleware mounted before turnpike()). Turnpike proves "this resource was paid for", not
 * "this caller is customer X".
 * Handler semantics: the gateway guarantees at most one stored response per payment and delivers the stored copy on replay.
 * It cannot guarantee that an arbitrary handler runs exactly once: a crash mid-handler means the handler runs again after the
 * delivery lease expires. Handlers behind a priced route should therefore be idempotent or side-effect free.
 */

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
  /** A payment mined this long after the challenge expiry is still honoured. Default 86400 (the 24 h recovery window). */
  lateGraceSeconds?: number;
  deliveryLeaseSeconds?: number; // default 30
  maxResponseBytes?: number; // default 1 MiB; larger handler responses are not stored and are refused
  rateLimitPerMinute?: number; // default 60
  retryAfterSeconds?: number; // default 4
  /** Optional payer binding: only Paid logs funded by these owners / sent by these agents are accepted. */
  allowedOwners?: string[];
  allowedAgents?: string[];
  /** Paths are relative to the mount point, e.g. "/block-summary" or "/address/:address". */
  prices: Record<string, PriceRule | string | number>;
  store?: Store;
}

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const proofSchema = z.object({ requestId: hex32, txHash: hex32, sig: z.string().regex(/^[0-9a-fA-F]{64}$/) }).strict();

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

const isSqliteError = (e: unknown) =>
  (typeof (e as any)?.code === "string" && String((e as any).code).startsWith("SQLITE")) ||
  (e instanceof TypeError && /database connection is not open/i.test(e.message));

/** Drop-in Express middleware (FR-016):  app.use('/paid', turnpike({...})) */
export function turnpike(cfg: TurnpikeConfig): RequestHandler & { store: Store; close(): void } {
  if (cfg.hmacSecrets.length === 0 || cfg.hmacSecrets.some((s) => Buffer.byteLength(s) < 32)) throw new Error("HMAC secret must be at least 32 bytes");
  const confirmations = cfg.confirmations ?? 2;
  const ttl = cfg.challengeTtlSeconds ?? 300;
  const retryAfter = cfg.retryAfterSeconds ?? 4;
  const limit = cfg.rateLimitPerMinute ?? 60;
  const lease = cfg.deliveryLeaseSeconds ?? 30;
  const maxBytes = cfg.maxResponseBytes ?? 1_048_576;
  const contract = getAddress(cfg.contract);
  const merchant = getAddress(cfg.merchant);
  const token = getAddress(cfg.token);
  const opts = {
    confirmations,
    lateGraceSeconds: cfg.lateGraceSeconds ?? 86_400,
    allowedOwners: cfg.allowedOwners ? new Set(cfg.allowedOwners.map((a) => a.toLowerCase())) : undefined,
    allowedAgents: cfg.allowedAgents ? new Set(cfg.allowedAgents.map((a) => a.toLowerCase())) : undefined,
  };
  const store = cfg.store ?? new Store(cfg.dbPath);
  const providers = cfg.rpcUrls.map((u) => new JsonRpcProvider(u, cfg.chainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 })); // no ethers result cache: confirmations must be fresh
  const hits = new Map<string, { n: number; reset: number }>();
  const now = () => Math.floor(Date.now() / 1000);
  const fail = (res: Response, status: number, body: object) => void res.status(status).json(body);
  const needPayment = (res: Response, reason: string) => fail(res, 402, { error: "payment_required", reason });

  const handler: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // SEC-014 rate limit (fixed window per IP)
      const ip = req.ip ?? "unknown";
      const h = hits.get(ip);
      if (!h || h.reset < now()) hits.set(ip, { n: 1, reset: now() + 60 });
      else if (++h.n > limit) return fail(res, 429, { error: "rate_limited" });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now()) hits.delete(k);

      const m = matchRule(cfg.prices, req.path);
      if (!m) return next(); // free route
      const { resourceId, rule } = m;
      const header = req.header("x-payment");
      if (!header) return await issueChallenge(req, res, resourceId, rule);

      // ---- 1. parse and authenticate the proof. Nothing is revealed or changed before every check below passes.
      let proof;
      try {
        if (header.length > 2048) throw new Error("too long");
        proof = proofSchema.parse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
      } catch {
        return needPayment(res, "malformed_proof");
      }
      const requestId = proof.requestId.toLowerCase();
      const row = store.get(requestId);
      if (!row) return needPayment(res, "unknown_request");
      const fields: ChallengeFields = { nonce: row.nonce, merchant: row.merchant, resourceId: row.resourceId, priceBase: row.priceBase, chainId: row.chainId, contract: row.contract, expiresAt: row.expiresAt };
      if (computeRequestId(fields).toLowerCase() !== requestId) return needPayment(res, "integrity");
      if (!verifySig(cfg.hmacSecrets, requestId, fields, proof.sig)) return needPayment(res, "bad_signature");

      // ---- 2. the proof authorizes only its own resource and only its own transaction
      if (row.resourceId !== resourceId) return fail(res, 403, { error: "wrong_resource" });
      if (row.txHash && row.txHash.toLowerCase() !== proof.txHash.toLowerCase()) return fail(res, 409, { error: "already_redeemed", reason: "different_tx" });

      // ---- 3. replay of an already delivered response (only after the checks above)
      if (row.state === "DELIVERED") return replay(res, row);
      if (row.state === "REJECTED") return needPayment(res, "rejected");

      // ---- 4. verify on chain (also the recovery path for a proof that arrives after expiry or after a gateway restart)
      if (row.state === "ISSUED" || row.state === "PAID_PENDING") {
        if (row.state === "ISSUED") store.transition(requestId, ["ISSUED"], "PAID_PENDING", {}, "proof_submitted");
        const v = await verifyPayment(providers, row, proof.txHash, opts);
        if (v.kind === "rpc_unavailable") return fail(res, 503, { error: "rpc_unavailable" });
        if (v.kind === "pending") return fail(res, 202, { status: "pending", why: v.why, confirmations: v.confirmations, required: confirmations, retryAfter });
        if (v.kind === "rejected") {
          // A terminal REJECTED is reserved for a verified payment that arrived too late. Every other refusal concerns only the
          // transaction presented, so the row stays open and a correct transaction can still be presented.
          if (v.reason === "paid_too_late" && v.txRecord) {
            store.transition(requestId, ["PAID_PENDING"], "REJECTED", { txHash: proof.txHash.toLowerCase(), payer: v.txRecord.payer, agent: v.txRecord.agent, blockNumber: v.txRecord.blockNumber }, v.reason);
          }
          return needPayment(res, v.reason);
        }
        try {
          store.transition(requestId, ["PAID_PENDING"], "PAID_CONFIRMED", { txHash: proof.txHash.toLowerCase(), blockNumber: v.blockNumber, payer: v.payer, agent: v.agent }, "verified");
        } catch {
          return fail(res, 409, { error: "already_redeemed", reason: "tx_reused" }); // txHash UNIQUE: tx already backs another request
        }
      }

      // ---- 5. deliver: take the lease, run the handler, persist the response, then send it
      if (store.get(requestId)?.state === "DELIVERED") return replay(res, store.get(requestId)!);
      if (!store.claimDelivery(requestId, lease)) return fail(res, 202, { status: "pending", why: "delivering", retryAfter });
      deliver(req, res, next, requestId);
    } catch (e) {
      if (isSqliteError(e)) return fail(res, 503, { error: "storage_unavailable" });
      next(e);
    }
  };

  async function issueChallenge(req: Request, res: Response, resourceId: string, rule: PriceRule) {
    if (rule.preflight) {
      const reason = await rule.preflight(req);
      if (reason) return fail(res, 503, { error: reason }); // nothing charged, no challenge
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

  /**
   * Runs the downstream handler against a buffering response. The response is written to SQLite (synchronously, fsync'd)
   * BEFORE any byte reaches the client, so a client never holds data the database does not know about. If the handler fails or
   * returns a non-2xx status the lease is released, the payment stays PAID_CONFIRMED and the same proof can retry.
   */
  function deliver(req: Request, res: Response, next: NextFunction, requestId: string) {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const realEnd = res.end.bind(res) as (...a: any[]) => Response;
    const toBuf = (c: any, enc?: any) => (Buffer.isBuffer(c) ? c : Buffer.from(String(c), typeof enc === "string" ? (enc as BufferEncoding) : "utf8"));
    // Replaces the buffered handler output with an error body. Length and etag headers belong to the discarded body.
    const replace = (status: number, body: object) => {
      res.removeHeader("content-length");
      res.removeHeader("etag");
      res.status(status).setHeader("content-type", "application/json");
      return realEnd(JSON.stringify(body));
    };
    (res as any).write = (chunk: any, enc?: any, cb?: any) => {
      if (chunk) { const b = toBuf(chunk, enc); size += b.length; chunks.push(b); }
      if (typeof enc === "function") enc(); else if (typeof cb === "function") cb();
      return true;
    };
    (res as any).end = (chunk?: any, enc?: any, cb?: any) => {
      if (finished) return res;
      finished = true;
      if (chunk && typeof chunk !== "function") { const b = toBuf(chunk, enc); size += b.length; chunks.push(b); }
      const body = Buffer.concat(chunks);
      const status = res.statusCode;
      try {
        if (status >= 200 && status < 300) {
          if (size > maxBytes) {
            store.releaseDelivery(requestId, "response_too_large");
            return replace(500, { error: "response_too_large" });
          }
          const type = String(res.getHeader("content-type") ?? "application/json");
          const ok = store.completeDelivery(requestId, body.toString("utf8"), status, type); // durable before send
          if (!ok) return replace(503, { error: "delivery_state_lost" });
        } else {
          store.releaseDelivery(requestId, `handler_status_${status}`);
        }
      } catch {
        return replace(503, { error: "storage_unavailable" });
      }
      return realEnd(body, typeof enc === "function" ? undefined : enc, typeof enc === "function" ? enc : cb);
    };
    // No release on client disconnect: the handler may still finish and store its response. If it never does, the lease lapses
    // after deliveryLeaseSeconds and the next presentation of the proof re-runs it.
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
