import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { JsonRpcProvider, getAddress } from "ethers";
import { z } from "zod";
import { computeRequestId, newNonce, sign, verifySig, ChallengeFields } from "./challenge";
import { Store, PaymentRow } from "./store";
import { scanPaidLogs, verifyPayment } from "./verify";

export { Store } from "./store";
export type { PaymentRow, State, StoredResponse } from "./store";
export { computeRequestId } from "./challenge";

/** Protocol identifier carried in every challenge. Clients should refuse challenges with a version they do not know. */
export const PROTOCOL = "turnspike/1";

/*
 * Security model
 * --------------
 * A paid response is a capability held by whoever presents the full proof: { requestId, txHash, sig }.
 *  - requestId and txHash are public once the payment is mined (they are in the Paid event).
 *  - sig is an HMAC that only the party that received the 402 challenge has seen. It is therefore the secret half of the
 *    capability and is REQUIRED on every redemption, including replays of a stored response.
 * Consequence: treat the sig like a session token. Anyone who obtains the sig and the transaction hash can fetch the stored
 * response, so do not put per-customer private data behind a Turnspike route unless you also bind the caller's identity
 * (PriceRule.bind.identity) and authenticate the caller yourself. Turnspike proves "this resource was paid for", not
 * "this caller is customer X".
 *
 * Time model
 * ----------
 *  - Payment deadline: the payment must be MINED by expiresAt + paymentGraceSeconds (chain time). Default grace 60 s, so a
 *    quoted price cannot be paid for a day later.
 *  - Redemption: a payment mined in time can be redeemed (proof presented) at any later time while the row is retained.
 *  - Retention: rows with a transaction are never purged. Unpaid rows are purged only after the deadline has passed, the
 *    chain has been reconciled past that deadline (reconcile()), and retentionSeconds have elapsed.
 *
 * Handler semantics
 * -----------------
 * At most one response is stored per payment, and replays return the stored copy. Handlers run AT LEAST once: a crash or a
 * lost lease means the handler can run again. The lease is renewed while the handler runs and fenced with a token, so a
 * stale handler can never overwrite or race the stored response, but handlers behind a priced route must be idempotent or
 * side-effect free.
 *
 * Responses are buffered (max maxResponseBytes) and stored byte-exact before the first byte is sent. Streaming responses
 * (server-sent events, long polls) are not supported behind a priced route.
 */

export interface Binding {
  /** Include the HTTP method in the resource id. Default true (GET is implicit and not written into the id). */
  method?: boolean;
  /** Include the sorted query string. Default true, unless an explicit resourceId is set. */
  query?: boolean;
  /** Include a SHA-256 of the parsed JSON body (requires a body parser mounted before the middleware). Default false. */
  body?: boolean;
  /** Bind the payment to a caller identity you have authenticated (for example an API key id). Hashed into the id. */
  identity?: (req: Request) => string | null;
}

export interface PriceRule {
  /** Fixed resource id. Defaults to the concrete request path plus the binding below. */
  resourceId?: string;
  priceBase: string | number | bigint;
  binding?: Binding;
  /**
   * Input validation run BEFORE a challenge is issued (and before a proof is redeemed). Return a reason string to refuse
   * with 400. Nothing is charged for an invalid request.
   */
  validate?: (req: Request) => string | null | Promise<string | null>;
  /** FR-018: optional dependency probe run BEFORE a challenge is issued. Return a reason to refuse with 503 (nothing charged). */
  preflight?: (req: Request) => Promise<string | null>;
}

export interface TurnspikeConfig {
  rpcUrls: string[];
  chainId: number;
  contract: string; // TurnpikeAllowance address (the deployed contract keeps its original name)
  token: string; // QUSDC address (returned in challenges)
  merchant: string;
  hmacSecrets: string[]; // [current, ...previous]; each >= 32 bytes
  dbPath: string;
  confirmations?: number; // default 2
  challengeTtlSeconds?: number; // default 300
  /** A payment mined up to this many seconds after the challenge expiry is accepted. Default 60. */
  paymentGraceSeconds?: number;
  /** @deprecated Older name of paymentGraceSeconds. */
  lateGraceSeconds?: number;
  /** Unpaid challenges are kept at least this long. Default 30 days. */
  retentionSeconds?: number;
  deliveryLeaseSeconds?: number; // default 30; renewed while the handler runs
  maxResponseBytes?: number; // default 1 MiB; larger handler responses are not stored and are refused
  rateLimitPerMinute?: number; // default 60
  retryAfterSeconds?: number; // default 4
  /** Optional payer binding: only Paid logs funded by these owners / sent by these agents are accepted. */
  allowedOwners?: string[];
  allowedAgents?: string[];
  /** Paths are relative to the mount point, e.g. "/block-summary" or "/address/:address". */
  prices: Record<string, PriceRule | string | number>;
  store?: Store;
  /** Structured event sink. Defaults to JSON lines on stdout unless TURNSPIKE_LOG=off. Never receives proofs or bodies. */
  onEvent?: (e: Record<string, unknown>) => void;
  /** Seconds-since-epoch clock used for challenge expiry. Defaults to the system clock; tests and simulations may align it with chain time. */
  clock?: () => number;
}

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const proofSchema = z.object({ requestId: hex32, txHash: hex32, sig: z.string().regex(/^[0-9a-fA-F]{64}$/) }).strict();
/** Headers stored with a paid response and sent again on replay. Others (cookies, auth) are deliberately not stored. */
const KEPT_HEADERS = ["cache-control", "content-language", "content-disposition", "content-encoding", "last-modified", "etag", "vary"];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function matchRule(prices: TurnspikeConfig["prices"], path: string): { pattern: string; rule: PriceRule } | null {
  for (const [pattern, raw] of Object.entries(prices)) {
    const pp = pattern.split("/");
    const rp = path.split("/");
    if (pp.length !== rp.length) continue;
    if (pp.every((seg, i) => seg.startsWith(":") || seg === rp[i])) {
      return { pattern, rule: typeof raw === "object" ? raw : { priceBase: raw } };
    }
  }
  return null;
}

/**
 * The resource id a payment is bound to. Two requests share a payment only if they produce the same id.
 * GET /a              -> "/a"
 * GET /a?b=2&a=1      -> "/a?a=1&b=2"
 * POST /a with body   -> "POST /a#body=<sha256>"
 */
export function resourceIdFor(req: Request, rule: PriceRule): string {
  const b = rule.binding ?? {};
  let id = rule.resourceId ?? req.path;
  const method = req.method.toUpperCase();
  if ((b.method ?? true) && method !== "GET" && method !== "HEAD") id = `${method} ${id}`;
  if (b.query ?? rule.resourceId === undefined) {
    const u = new URL(req.originalUrl, "http://x");
    const pairs = [...u.searchParams.entries()].sort(([a, x], [c, y]) => (a === c ? (x < y ? -1 : 1) : a < c ? -1 : 1));
    if (pairs.length) id += "?" + new URLSearchParams(pairs).toString();
  }
  if (b.body) id += "#body=" + sha(JSON.stringify(req.body ?? null));
  if (b.identity) {
    const who = b.identity(req);
    if (who) id += "#id=" + sha(who);
  }
  return id;
}

const isSqliteError = (e: unknown) =>
  (typeof (e as any)?.code === "string" && String((e as any).code).startsWith("SQLITE")) ||
  (e instanceof TypeError && /database connection is not open/i.test(e.message));

export type TurnspikeMiddleware = RequestHandler & {
  store: Store;
  /** Finds on-chain payments for unpaid challenges (e.g. paid during an outage) and attaches them. Run periodically. */
  reconcile(opts?: { lookbackBlocks?: number }): Promise<{ scannedTo: number; recovered: number }>;
  /** Deletes unpaid challenges that can no longer be paid and are past retention. Safe only after reconcile(). */
  purge(): number;
  close(): void;
};

/** Drop-in Express middleware (FR-016):  app.use('/paid', turnspike({...})) */
export function turnspike(cfg: TurnspikeConfig): TurnspikeMiddleware {
  if (cfg.hmacSecrets.length === 0 || cfg.hmacSecrets.some((s) => Buffer.byteLength(s) < 32)) throw new Error("HMAC secret must be at least 32 bytes");
  const confirmations = cfg.confirmations ?? 2;
  const ttl = cfg.challengeTtlSeconds ?? 300;
  const retryAfter = cfg.retryAfterSeconds ?? 4;
  const limit = cfg.rateLimitPerMinute ?? 60;
  const lease = Math.max(2, cfg.deliveryLeaseSeconds ?? 30);
  const maxBytes = cfg.maxResponseBytes ?? 1_048_576;
  const paymentGrace = cfg.paymentGraceSeconds ?? cfg.lateGraceSeconds ?? 60;
  const retention = cfg.retentionSeconds ?? 30 * 86_400;
  const contract = getAddress(cfg.contract);
  const merchant = getAddress(cfg.merchant);
  const token = getAddress(cfg.token);
  const opts = {
    confirmations,
    paymentGraceSeconds: paymentGrace,
    allowedOwners: cfg.allowedOwners ? new Set(cfg.allowedOwners.map((a) => a.toLowerCase())) : undefined,
    allowedAgents: cfg.allowedAgents ? new Set(cfg.allowedAgents.map((a) => a.toLowerCase())) : undefined,
  };
  const store = cfg.store ?? new Store(cfg.dbPath);
  const providers = cfg.rpcUrls.map((u) => new JsonRpcProvider(u, cfg.chainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 })); // no ethers result cache: confirmations must be fresh
  const hits = new Map<string, { n: number; reset: number }>();
  const now = () => Math.floor(cfg.clock ? cfg.clock() : Date.now() / 1000);
  const emit = cfg.onEvent ?? ((e) => { if (process.env.TURNSPIKE_LOG !== "off" && process.env.TURNPIKE_LOG !== "off") console.log(JSON.stringify(e)); });
  const fail = (res: Response, status: number, body: object) => void res.status(status).json(body);
  const needPayment = (res: Response, reason: string) => fail(res, 402, { error: "payment_required", reason });

  const handler: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req.header("x-correlation-id") ?? "").slice(0, 64).replace(/[^\w.-]/g, "") || randomUUID();
    try {
      // SEC-014 rate limit (fixed window per IP)
      const ip = req.ip ?? "unknown";
      const h = hits.get(ip);
      if (!h || h.reset < now()) hits.set(ip, { n: 1, reset: now() + 60 });
      else if (++h.n > limit) return fail(res, 429, { error: "rate_limited" });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now()) hits.delete(k);

      const m = matchRule(cfg.prices, req.path);
      if (!m) return next(); // free route
      res.setHeader("x-correlation-id", correlationId);
      const { rule } = m;
      // Invalid input is refused before anything is charged, on both the challenge and the redemption path.
      if (rule.validate) {
        const bad = await rule.validate(req);
        if (bad) return fail(res, 400, { error: "invalid_request", reason: bad });
      }
      const resourceId = resourceIdFor(req, rule);
      const header = req.header("x-payment");
      if (!header) return await issueChallenge(req, res, resourceId, rule, correlationId);

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

      // ---- 4. verify on chain (also the recovery path for a proof that arrives late or after a gateway restart)
      if (row.state === "ISSUED" || row.state === "PAID_PENDING") {
        if (row.state === "ISSUED") store.transition(requestId, ["ISSUED"], "PAID_PENDING", {}, "proof_submitted");
        const v = await verifyPayment(providers, row, proof.txHash, opts);
        if (v.kind === "rpc_unavailable") return fail(res, 503, { error: "rpc_unavailable" });
        if (v.kind === "pending") return fail(res, 202, { status: "pending", why: v.why, confirmations: v.confirmations, required: confirmations, retryAfter });
        if (v.kind === "rejected") {
          // A terminal REJECTED is reserved for a verified payment that missed the payment deadline. Every other refusal concerns
          // only the transaction presented, so the row stays open and a correct transaction can still be presented.
          if (v.reason === "paid_too_late" && v.txRecord) {
            store.transition(requestId, ["PAID_PENDING"], "REJECTED", { txHash: proof.txHash.toLowerCase(), payer: v.txRecord.payer, agent: v.txRecord.agent, blockNumber: v.txRecord.blockNumber }, v.reason);
          }
          emit({ evt: "payment_rejected", correlationId, requestId, reason: v.reason });
          return needPayment(res, v.reason);
        }
        try {
          store.transition(requestId, ["PAID_PENDING"], "PAID_CONFIRMED", { txHash: proof.txHash.toLowerCase(), blockNumber: v.blockNumber, payer: v.payer, agent: v.agent }, "verified");
        } catch {
          return fail(res, 409, { error: "already_redeemed", reason: "tx_reused" }); // txHash UNIQUE: tx already backs another request
        }
      }

      // ---- 5. deliver: take the fenced lease, run the handler, persist the response, then send it
      const cur = store.get(requestId)!;
      if (cur.state === "DELIVERED") return replay(res, cur);
      const leaseToken = store.claimDelivery(requestId, lease);
      if (!leaseToken) return fail(res, 202, { status: "pending", why: "delivering", retryAfter });
      emit({ evt: "delivery_started", correlationId, requestId, txHash: cur.txHash });
      deliver(req, res, next, requestId, leaseToken, correlationId);
    } catch (e) {
      if (isSqliteError(e)) return fail(res, 503, { error: "storage_unavailable" });
      next(e);
    }
  };

  async function issueChallenge(req: Request, res: Response, resourceId: string, rule: PriceRule, correlationId: string) {
    if (rule.preflight) {
      const reason = await rule.preflight(req);
      if (reason) return fail(res, 503, { error: reason }); // nothing charged, no challenge
    }
    const f: ChallengeFields = { nonce: newNonce(), merchant, resourceId, priceBase: BigInt(rule.priceBase).toString(), chainId: cfg.chainId, contract, expiresAt: now() + ttl };
    const requestId = computeRequestId(f);
    store.insert({ requestId, ...f });
    emit({ evt: "challenge_issued", correlationId, requestId, resourceId, priceBase: f.priceBase });
    res.setHeader("cache-control", "no-store");
    res.status(402).json({
      error: "payment_required", protocol: PROTOCOL, requestId, sig: sign(cfg.hmacSecrets[0], requestId, f), priceBase: f.priceBase, token,
      contract, merchant, chainId: cfg.chainId, resourceId, expiresAt: f.expiresAt, paymentDeadline: f.expiresAt + paymentGrace,
    });
  }

  function replay(res: Response, row: PaymentRow) {
    const s = store.storedResponse(row);
    for (const [k, v] of Object.entries(s.headers)) res.setHeader(k, v);
    res.setHeader("content-type", s.type);
    res.setHeader("x-turnspike-replay", "1");
    res.status(s.status).end(s.body);
  }

  /**
   * Runs the downstream handler against a buffering response. The response is written to SQLite (synchronously, fsync'd)
   * BEFORE any byte reaches the client, so a client never holds data the database does not know about. If the handler fails or
   * returns a non-2xx status the lease is released, the payment stays PAID_CONFIRMED and the same proof can retry.
   * The lease is renewed every lease/3 seconds while the handler runs. If renewal fails (the lease lapsed and another
   * process took over), this run's output is discarded: the other holder owns the stored response.
   */
  function deliver(req: Request, res: Response, next: NextFunction, requestId: string, leaseToken: string, correlationId: string) {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    let finished = false;
    let leaseLost = false;
    const renew = setInterval(() => {
      try { if (!store.renewLease(requestId, leaseToken, lease)) leaseLost = true; } catch { leaseLost = true; }
    }, Math.max(500, (lease * 1000) / 3));
    renew.unref?.();
    const realEnd = res.end.bind(res) as (...a: any[]) => Response;
    const toBuf = (c: any, enc?: any) => (Buffer.isBuffer(c) ? c : c instanceof Uint8Array ? Buffer.from(c) : Buffer.from(String(c), typeof enc === "string" ? (enc as BufferEncoding) : "utf8"));
    const add = (b: Buffer) => { size += b.length; if (size > maxBytes) { overflow = true; chunks.length = 0; } else if (!overflow) chunks.push(b); };
    // Replaces the buffered handler output with an error body. Length and etag headers belong to the discarded body.
    const replace = (status: number, body: object) => {
      for (const h of ["content-length", "etag", "content-encoding", "content-disposition", "last-modified"]) res.removeHeader(h);
      res.status(status).setHeader("content-type", "application/json");
      return realEnd(JSON.stringify(body));
    };
    (res as any).write = (chunk: any, enc?: any, cb?: any) => {
      if (chunk) add(toBuf(chunk, enc));
      if (typeof enc === "function") enc(); else if (typeof cb === "function") cb();
      return true;
    };
    (res as any).flushHeaders = () => {}; // nothing may reach the client before the response is stored
    (res as any).end = (chunk?: any, enc?: any, cb?: any) => {
      if (finished) return res;
      finished = true;
      clearInterval(renew);
      if (chunk && typeof chunk !== "function") add(toBuf(chunk, enc));
      const body = Buffer.concat(chunks);
      const status = res.statusCode;
      try {
        if (status >= 200 && status < 300) {
          if (overflow) {
            store.releaseDelivery(requestId, leaseToken, "response_too_large");
            emit({ evt: "delivery_failed", correlationId, requestId, reason: "response_too_large", bytes: size });
            return replace(500, { error: "response_too_large" });
          }
          const type = String(res.getHeader("content-type") ?? "application/octet-stream");
          const headers: Record<string, string> = {};
          for (const k of KEPT_HEADERS) { const v = res.getHeader(k); if (v !== undefined) headers[k] = String(v); }
          if (!headers["cache-control"]) { headers["cache-control"] = "private, no-store"; res.setHeader("cache-control", "private, no-store"); }
          const ok = !leaseLost && store.completeDelivery(requestId, leaseToken, { status, type, body, headers }); // durable before send
          if (!ok) {
            // Another holder took over (or already stored a response). Serve the stored copy if there is one; never ours.
            const row = store.get(requestId);
            emit({ evt: "delivery_superseded", correlationId, requestId });
            if (row?.state === "DELIVERED") {
              const s = store.storedResponse(row);
              for (const h of ["content-length", "etag"]) res.removeHeader(h);
              for (const [k, v] of Object.entries(s.headers)) res.setHeader(k, v);
              res.status(s.status).setHeader("content-type", s.type);
              return realEnd(s.body);
            }
            return replace(503, { error: "delivery_state_lost", retryAfter });
          }
          emit({ evt: "delivered", correlationId, requestId, status, bytes: body.length });
          res.setHeader("content-length", String(body.length));
        } else {
          store.releaseDelivery(requestId, leaseToken, `handler_status_${status}`);
          emit({ evt: "delivery_failed", correlationId, requestId, reason: `handler_status_${status}` });
        }
      } catch {
        return replace(503, { error: "storage_unavailable" });
      }
      return realEnd(body, typeof enc === "function" ? enc : cb);
    };
    // No release on client disconnect: the handler may still finish and store its response. If it never does, the lease lapses
    // after deliveryLeaseSeconds and the next presentation of the proof re-runs it.
    next();
  }

  const mw = handler as TurnspikeMiddleware;
  mw.store = store;
  mw.reconcile = async ({ lookbackBlocks = 50_000 } = {}) => {
    const wanted = store.unpaidIds();
    const head = await providers[0].getBlockNumber().catch(() => null);
    const saved = store.getMeta("reconciledBlock");
    const from = saved ? Number(saved) + 1 : Math.max(0, (head ?? 0) - lookbackBlocks);
    const r = await scanPaidLogs(providers, contract, merchant, wanted, from, confirmations);
    let recovered = 0;
    for (const m of r.matched) {
      const row = store.get(m.requestId);
      if (!row) continue;
      if (row.state === "ISSUED") store.transition(m.requestId, ["ISSUED"], "PAID_PENDING", {}, "reconcile_found_payment");
      const v = await verifyPayment(providers, store.get(m.requestId)!, m.txHash, opts);
      if (v.kind === "ok") {
        try {
          if (store.transition(m.requestId, ["PAID_PENDING"], "PAID_CONFIRMED", { txHash: m.txHash, blockNumber: v.blockNumber, payer: v.payer, agent: v.agent }, "reconciled")) recovered++;
        } catch { /* txHash already attached elsewhere */ }
      } else if (v.kind === "rejected" && v.reason === "paid_too_late" && v.txRecord) {
        store.transition(m.requestId, ["PAID_PENDING"], "REJECTED", { txHash: m.txHash, payer: v.txRecord.payer, agent: v.txRecord.agent, blockNumber: v.txRecord.blockNumber }, "reconciled_paid_too_late");
      }
    }
    if (r.toBlock >= from) {
      store.setMeta("reconciledBlock", String(r.toBlock));
      store.setMeta("reconciledThroughTime", String(r.throughTime));
    }
    emit({ evt: "reconciled", fromBlock: from, toBlock: r.toBlock, recovered });
    return { scannedTo: r.toBlock, recovered };
  };
  mw.purge = () => store.purgeUnpaid({ retentionSeconds: retention, paymentGraceSeconds: paymentGrace });
  mw.close = () => {
    for (const p of providers) p.destroy();
    if (!cfg.store) store.close();
  };
  return mw;
}

/** @deprecated Former product spelling, kept so existing integrations keep compiling. Use `turnspike`. */
export const turnpike = turnspike;
/** @deprecated Use `TurnspikeConfig`. */
export type TurnpikeConfig = TurnspikeConfig;
