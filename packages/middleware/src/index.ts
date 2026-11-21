import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { JsonRpcProvider, getAddress } from "ethers";
import { z } from "zod";
import { computeRequestId, newNonce, sign, verifySig, ChallengeFields, caip2, encodeX402Header, x402PaymentRequired, x402Requirement } from "./challenge";
import { Store, PaymentRow, PaidUndelivered } from "./store";
import { payerFromTx, scanPaidLogs, verifyPayment } from "./verify";
import { createResourceUrlPolicy, type ResourceUrlPolicy, type ResourceUrlMode, type CanonicalResult } from "./origin";

export { Store } from "./store";
export type { PaymentRow, State, StoredResponse, PaidUndelivered } from "./store";
export { computeRequestId } from "./challenge";
export {
  createResourceUrlPolicy, defaultProduction, normalizeOrigin, normalizeBasePath, normalizeResourceUrl, pathAndQuery, headerlessView, ResourceUrlConfigError,
  type ResourceUrlOptions, type ResourceUrlPolicy, type ResourceUrlMode, type CanonicalResult,
} from "./origin";
export { X402_SCHEME, X402_ASSET_TRANSFER_METHOD, X402_PAYMENT_FLOW, X402_DYNAMIC_EXTRA, x402Requirement, x402PaymentRequired, caip2 } from "./challenge";

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
 * "this caller is customer X". Since 0.2.0 `replayWindowSeconds` can limit replay of a stored response (default 0: no expiry, as
 * in 0.1.x); after the window it is purged and the proof answers 410.
 *
 * Time model
 * ----------
 *  - Payment deadline: the payment must be MINED by expiresAt + paymentGraceSeconds (chain time). Default grace 60 s, so a
 *    quoted price cannot be paid for a day later. A later payment is recorded as PAID_LATE (state REJECTED) and listed by
 *    paidUndelivered(), so the merchant can honour or refund it off-protocol.
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
 *
 * Protocols
 * ---------
 * A challenge row is protocol-neutral. turnspike/1 (X-PAYMENT) is served by this middleware. x402 v2 (PAYMENT-SIGNATURE,
 * custom scheme turnspike-allowance) is served by @turnspike-qie/x402, which reuses the proof checks (settleProof,
 * checkProof) and the fenced delivery (deliver) exposed below, so both protocols enforce identical checks.
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

/** x402 v2 view of the 402 (see @turnspike-qie/x402). When enabled, every challenge also carries a PAYMENT-REQUIRED header. */
export interface X402Options {
  /** Default true when the object is given. */
  enabled?: boolean;
  /** `maxTimeoutSeconds` advertised in the requirements. Default: challengeTtlSeconds. */
  maxTimeoutSeconds?: number;
  /**
   * O4: server-trusted public origin, e.g. "https://api.example.com". resource.url is publicOrigin + basePath + the path and
   * query of req.originalUrl. Required in production (NODE_ENV=production or `production: true`) unless `resourceUrl` is a
   * resolver; validated at construction (https, or http on localhost only in production; no userinfo, path, query,
   * fragment, wildcard or list).
   */
  publicOrigin?: string;
  /** Public path prefix removed by a reverse proxy (e.g. "/api"). Used with publicOrigin. */
  basePath?: string;
  /**
   * An origin string (same as publicOrigin) or a resolver (req) => absolute canonical URL. The resolver gets a request view
   * on which Host, X-Forwarded-*, Forwarded, req.protocol, req.hostname, req.secure and req.ip throw; its output is
   * normalised and must end with the request's own path and query, or the request is refused (500).
   */
  resourceUrl?: string | ((req: Request) => string);
  /** Production mode for the resource URL policy. Default: production unless NODE_ENV is "development" or "test" (unset counts as production). */
  production?: boolean;
  description?: string;
  mimeType?: string;
}

/**
 * Challenge-issuance guard. Every unpaid request writes a row, so issuance is limited per client and per route.
 * Off by default (turnspike/1 0.1.x behaviour). Pass `guard: true` for the defaults below, or an object to override some
 * of them (unset fields take the defaults). Recommended for public x402 deployments:
 * `{ burst: 120, refillPerSecond: 2, maxUnpaidPerRoute: 10_000, maxQueryLength: 2048, maxQueryParams: 64, reaperIntervalSeconds: 300 }`.
 */
export interface GuardOptions {
  /** Token bucket per client (default key: req.ip): capacity. Default 120 challenges. */
  burst?: number;
  /** Token bucket refill rate in challenges per second. Default 2. */
  refillPerSecond?: number;
  /** Maximum live (payable, unpaid) challenges per price route. Default 10 000; beyond it the route answers 503. */
  maxUnpaidPerRoute?: number;
  /** Maximum length of the query string, in characters. Default 2048; longer answers 414. */
  maxQueryLength?: number;
  /** Maximum number of query parameters. Default 64; more answers 400. */
  maxQueryParams?: number;
  /** Runs reap() on this interval. Default 300 s; 0 disables the timer (reap() can still be called). */
  reaperIntervalSeconds?: number;
  /** Extra seconds after the payment deadline before an ISSUED row may be reaped. Default 0. */
  reaperGraceSeconds?: number;
  /** Client key for the token bucket. Default req.ip. */
  clientKey?: (req: Request) => string;
  /** Upper bound on tracked clients (memory). Default 10 000. */
  maxTrackedClients?: number;
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
  /** 0.2.0: x402 v2 PAYMENT-REQUIRED header on every challenge. Off unless set. */
  x402?: X402Options | boolean;
  /** 0.2.0: challenge-issuance guard (token bucket, query limits, unpaid-row cap, reaper timer). Off unless set: `true` uses the defaults. */
  guard?: GuardOptions | boolean;
  /**
   * 0.2.0: a stored response is replayed for this long after delivery, then purged (410). Default 0 = forever (0.1.x
   * behaviour). Recommended for x402 deployments: 86 400.
   */
  replayWindowSeconds?: number;
  /**
   * 0.2.0: merchant addresses this gateway used before `merchant`. A challenge row is bound to the merchant that issued
   * it; after a merchant change, rows of earlier merchants are refused (`wrong_merchant`) unless listed here.
   */
  previousMerchants?: string[];
  /** 0.2.0: add Access-Control-Expose-Headers for the payment headers on priced responses. Default true. */
  exposeHeaders?: boolean;
}

/** The proof both protocols carry: { requestId, txHash, sig }. */
export interface Proof { requestId: string; txHash: string; sig: string }

/**
 * Outcome of checking or settling a proof for a resource. `refused.code` is a stable reason (for example `bad_signature`,
 * `wrong_resource`, `paid_too_late`); `status` and `body` are exactly what turnspike/1 answers.
 */
export type ProofOutcome =
  | { kind: "settled"; row: PaymentRow }
  | { kind: "pending"; why: "no_receipt" | "confirmations" | "reorg"; confirmations: number; required: number; txHash: string }
  | { kind: "refused"; code: string; status: number; body: Record<string, unknown>; txHash?: string; payer?: string }
  | { kind: "rpc_unavailable" }
  | { kind: "storage_unavailable" };

export type RouteDescription =
  | { kind: "free" }
  | { kind: "invalid"; status: number; body: Record<string, unknown> }
  /**
   * resourceUrl: the canonical absolute URL of this request (see X402Options.publicOrigin). resourceUrlTrusted is false only
   * in the non-production dev fallback (no configured origin), where it must be compared by path and query only.
   */
  | { kind: "priced"; route: string; resourceId: string; priceBase: string; resourceUrl: string; resourceUrlTrusted: boolean; resourcePathAndQuery: string };

export interface TurnspikeInfo {
  chainId: number;
  network: string;
  contract: string;
  token: string;
  merchant: string;
  confirmations: number;
  challengeTtlSeconds: number;
  paymentGraceSeconds: number;
  maxTimeoutSeconds: number;
  replayWindowSeconds: number;
  x402: boolean;
  /** 0.2.0: true when x402.resourceUrl is configured (the seller then knows its public origin). */
  resourceUrlConfigured?: boolean;
  /** O4: "origin" (publicOrigin), "resolver", "dev" (non-production fallback) or null when x402 is off. */
  resourceUrlMode?: ResourceUrlMode | null;
  /** O4: true when the resource URL policy runs in production mode. */
  production?: boolean;
}

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const proofSchema = z.object({ requestId: hex32, txHash: hex32, sig: z.string().regex(/^[0-9a-fA-F]{64}$/) }).strict();
/** Headers stored with a paid response and sent again on replay. Others (cookies, auth) are deliberately not stored. */
const KEPT_HEADERS = ["cache-control", "content-language", "content-disposition", "content-encoding", "last-modified", "etag", "vary"];
/** Response headers browser clients need to read (CORS). */
export const EXPOSED_HEADERS = ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-Correlation-Id", "X-Turnspike-Replay", "Retry-After"];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** Keys never written to logs, whatever an event carries: proofs, sigs, payment headers, bodies, credentials. */
const REDACTED_KEYS = /^(sig|signature|paymentsignature|payment-signature|x-payment|xpayment|payload|proof|header|headers|body|responsebody|authorization|cookie|set-cookie|secret|secrets|hmacsecret|hmacsecrets|privatekey|key)$/i;

/** Removes secrets from a structured event (shallow; nested objects are dropped unless they are plain scalars arrays). */
export function redactEvent(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (REDACTED_KEYS.test(k)) continue;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) continue; // never log nested payloads
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

/** Adds the payment headers to Access-Control-Expose-Headers, keeping whatever is already exposed. */
export function exposePaymentHeaders(res: Response) {
  const cur = String(res.getHeader("access-control-expose-headers") ?? "");
  const have = new Set(cur.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  if (have.has("*")) return;
  const add = EXPOSED_HEADERS.filter((h) => !have.has(h.toLowerCase()));
  if (add.length) res.setHeader("access-control-expose-headers", [cur, ...add].filter(Boolean).join(", "));
}

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
  /** 0.2.0: chain, contract, token, merchant and timing as configured (for protocol front-ends). */
  readonly info: TurnspikeInfo;
  /** 0.2.0: whether this request is priced, invalid (400, runs `validate`), or free; and its resource id and price. */
  describe(req: Request): Promise<RouteDescription>;
  /** O4: the resource URL policy (null when x402 is off). */
  readonly resourcePolicy: ResourceUrlPolicy | null;
  /** 0.2.0: the per-IP request limit (rateLimitPerMinute) applied to a request handled outside the middleware. */
  admit(req: Request): boolean;
  /**
   * 0.2.0: verifies a proof for `resourceId` and commits it (ISSUED/PAID_PENDING -> PAID_CONFIRMED), exactly as an
   * X-PAYMENT redemption does, without delivering. Idempotent for the same proof. A payment mined after the deadline is
   * recorded as PAID_LATE.
   */
  settleProof(proof: unknown, resourceId: string, meta?: { correlationId?: string; protocol?: string }): Promise<ProofOutcome>;
  /** 0.2.0: the same checks as settleProof, read-only: nothing is written to the store. */
  checkProof(proof: unknown, resourceId: string): Promise<ProofOutcome>;
  /**
   * 0.2.0: delivers a settled request through the fenced lease and stored-response replay: replays a stored response
   * (inside the replay window, else 410), or claims the lease and runs the downstream handler (`next`), storing its 2xx
   * response before sending it. The request's resource must be the row's resource (403 otherwise).
   */
  deliver(req: Request, res: Response, requestId: string, next: NextFunction, meta?: { correlationId?: string; protocol?: string }): Promise<void>;
  /** 0.2.0: payments that moved money but were not delivered (PAID_LATE, or paid and stuck for `staleSeconds`). */
  paidUndelivered(opts?: { staleSeconds?: number }): PaidUndelivered[];
  /** 0.2.0: deletes ISSUED rows past deadline + reaperGraceSeconds once reconcile() has covered the deadline. */
  reap(): number;
  /** 0.2.0: purges stored responses older than replayWindowSeconds. */
  purgeExpiredResponses(): number;
  /** 0.2.0: best-effort owner (payer) of a pay transaction, from its calldata. Never used for authorisation. */
  payerOf(txHash: string): Promise<string | null>;
  /** 0.2.0: the redacted structured logger (events go to onEvent or stdout). */
  log(e: Record<string, unknown>): void;
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
  const replayWindow = cfg.replayWindowSeconds ?? 0;
  const x402cfg: X402Options | null = cfg.x402 === true ? {} : cfg.x402 && cfg.x402.enabled !== false ? cfg.x402 : null;
  const maxTimeout = x402cfg?.maxTimeoutSeconds ?? ttl;
  const guard = !cfg.guard ? null : {
    burst: 120, refillPerSecond: 2, maxUnpaidPerRoute: 10_000, maxQueryLength: 2048, maxQueryParams: 64, reaperIntervalSeconds: 300,
    reaperGraceSeconds: 0, maxTrackedClients: 10_000, ...(cfg.guard === true ? {} : cfg.guard),
  };
  const contract = getAddress(cfg.contract);
  const merchant = getAddress(cfg.merchant);
  // O4: built (and validated, fail-closed in production) only when x402 is enabled; turnspike/1-only deployments never use it
  const resourcePolicy: ResourceUrlPolicy | null = x402cfg
    ? createResourceUrlPolicy({ publicOrigin: x402cfg.publicOrigin, resourceUrl: x402cfg.resourceUrl, basePath: x402cfg.basePath, production: x402cfg.production })
    : null;
  const resourceUrlOf = (req: Request): CanonicalResult => resourcePolicy!.canonical(req);
  const acceptedMerchants = new Set([merchant, ...(cfg.previousMerchants ?? []).map((m) => getAddress(m))].map((a) => a.toLowerCase()));
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
  const buckets = new Map<string, { tokens: number; at: number }>();
  const now = () => Math.floor(cfg.clock ? cfg.clock() : Date.now() / 1000);
  const wallNow = () => Math.floor(Date.now() / 1000);
  const sink = cfg.onEvent ?? ((e) => { if (process.env.TURNSPIKE_LOG !== "off" && process.env.TURNPIKE_LOG !== "off") console.log(JSON.stringify(e)); });
  const emit = (e: Record<string, unknown>) => { try { sink(redactEvent(e)); } catch { /* a logging failure never fails a payment */ } };
  const fail = (res: Response, status: number, body: object) => void res.status(status).json(body);
  const needPayment = (res: Response, reason: string) => fail(res, 402, { error: "payment_required", reason });
  const np = (reason: string) => ({ error: "payment_required", reason });
  const corr = (req: Request) => (req.header("x-correlation-id") ?? "").slice(0, 64).replace(/[^\w.-]/g, "") || randomUUID();
  const lc = (s: string) => s.toLowerCase();

  /** SEC-014 rate limit (fixed window per IP). */
  function admit(req: Request): boolean {
    const ip = req.ip ?? "unknown";
    const h = hits.get(ip);
    if (!h || h.reset < now()) hits.set(ip, { n: 1, reset: now() + 60 });
    else if (++h.n > limit) return false;
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now()) hits.delete(k);
    return true;
  }

  const handler: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = corr(req);
    try {
      if (!admit(req)) return fail(res, 429, { error: "rate_limited" });

      const m = matchRule(cfg.prices, req.path);
      if (!m) return next(); // free route
      res.setHeader("x-correlation-id", correlationId);
      if (cfg.exposeHeaders !== false) exposePaymentHeaders(res);
      const { rule } = m;
      // Invalid input is refused before anything is charged, on both the challenge and the redemption path.
      if (rule.validate) {
        const bad = await rule.validate(req);
        if (bad) return fail(res, 400, { error: "invalid_request", reason: bad });
      }
      const resourceId = resourceIdFor(req, rule);
      const header = req.header("x-payment");
      if (!header) return await issueChallenge(req, res, resourceId, m.pattern, rule, correlationId);

      // ---- 1. parse the proof
      let proof;
      try {
        if (header.length > 2048) throw new Error("too long");
        proof = proofSchema.parse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
      } catch {
        return needPayment(res, "malformed_proof");
      }
      // ---- 2-4. authenticate, bind to this resource and transaction, verify on chain and commit. Nothing is revealed or
      // changed before every check passes.
      const out = await processProof(proof, resourceId, "settle", correlationId, "turnspike/1");
      if (out.kind === "storage_unavailable") return fail(res, 503, { error: "storage_unavailable" });
      if (out.kind === "rpc_unavailable") return fail(res, 503, { error: "rpc_unavailable" });
      if (out.kind === "pending") return fail(res, 202, { status: "pending", why: out.why, confirmations: out.confirmations, required: confirmations, retryAfter });
      if (out.kind === "refused") return fail(res, out.status, out.body);

      // ---- 5. deliver: take the fenced lease, run the handler, persist the response, then send it
      const requestId = out.row.requestId;
      const cur = store.get(requestId)!;
      if (cur.state === "DELIVERED") return replay(res, cur, correlationId);
      const leaseToken = store.claimDelivery(requestId, lease);
      if (!leaseToken) return fail(res, 202, { status: "pending", why: "delivering", retryAfter });
      emit({ evt: "delivery_started", correlationId, requestId, txHash: cur.txHash });
      runDelivery(req, res, next, requestId, leaseToken, correlationId);
    } catch (e) {
      if (isSqliteError(e)) return fail(res, 503, { error: "storage_unavailable" });
      next(e);
    }
  };

  /**
   * The proof checks shared by both protocols. `settle` commits (the turnspike/1 redemption path, and x402 settle); `check`
   * runs the same checks without writing anything (x402 verify).
   */
  async function processProof(proof: Proof, resourceId: string, mode: "settle" | "check", correlationId: string, protocol: string): Promise<ProofOutcome> {
    const refused = (status: number, body: Record<string, unknown>, code: string, extra: { txHash?: string; payer?: string } = {}): ProofOutcome => ({ kind: "refused", status, body, code, ...extra });
    const requestId = proof.requestId.toLowerCase();
    const row = store.get(requestId);
    if (!row) return refused(402, np("unknown_request"), "unknown_request");
    const fields: ChallengeFields = { nonce: row.nonce, merchant: row.merchant, resourceId: row.resourceId, priceBase: row.priceBase, chainId: row.chainId, contract: row.contract, expiresAt: row.expiresAt };
    if (computeRequestId(fields).toLowerCase() !== requestId) return refused(402, np("integrity"), "integrity");
    if (!verifySig(cfg.hmacSecrets, requestId, fields, proof.sig)) return refused(402, np("bad_signature"), "bad_signature");
    // A store shared by several merchants (or a copied database) must never let one merchant settle another's challenge.
    if (!acceptedMerchants.has(lc(row.merchant)) || lc(row.contract) !== lc(contract) || row.chainId !== cfg.chainId) return refused(402, np("wrong_merchant"), "wrong_merchant");

    // the proof authorizes only its own resource and only its own transaction
    if (row.resourceId !== resourceId) return refused(403, { error: "wrong_resource" }, "wrong_resource");
    if (row.txHash && row.txHash.toLowerCase() !== proof.txHash.toLowerCase()) return refused(409, { error: "already_redeemed", reason: "different_tx" }, "different_tx");

    // already settled (replay of a delivered response, or a delivery in progress)
    if (row.state === "DELIVERED" || row.state === "PAID_CONFIRMED" || row.state === "DELIVERING") return { kind: "settled", row };
    if (row.state === "REJECTED") {
      return refused(402, np("rejected"), row.txHash ? "paid_too_late" : "rejected", { txHash: row.txHash ?? undefined, payer: row.payer ?? undefined });
    }
    if (row.state !== "ISSUED" && row.state !== "PAID_PENDING") return refused(402, np("rejected"), "rejected");

    // verify on chain (also the recovery path for a proof that arrives late or after a gateway restart)
    if (mode === "settle" && row.state === "ISSUED") store.transition(requestId, ["ISSUED"], "PAID_PENDING", {}, "proof_submitted");
    const v = await verifyPayment(providers, row, proof.txHash, opts);
    if (v.kind === "rpc_unavailable") return { kind: "rpc_unavailable" };
    if (v.kind === "pending") return { kind: "pending", why: v.why, confirmations: v.confirmations, required: confirmations, txHash: proof.txHash.toLowerCase() };
    if (v.kind === "rejected") {
      // A terminal REJECTED is reserved for a verified payment that missed the payment deadline (recorded as PAID_LATE).
      // Every other refusal concerns only the transaction presented, so the row stays open and a correct transaction can
      // still be presented.
      if (mode === "settle") {
        if (v.reason === "paid_too_late" && v.txRecord) {
          store.transition(requestId, ["PAID_PENDING"], "REJECTED", { txHash: proof.txHash.toLowerCase(), payer: v.txRecord.payer, agent: v.txRecord.agent, blockNumber: v.txRecord.blockNumber, disposition: "PAID_LATE" }, v.reason);
          emit({ evt: "payment_paid_late", correlationId, requestId, txHash: proof.txHash.toLowerCase(), protocol });
        }
        emit({ evt: "payment_rejected", correlationId, requestId, reason: v.reason });
      }
      return refused(402, np(v.reason), v.reason, { txHash: proof.txHash.toLowerCase(), payer: v.txRecord?.payer });
    }
    if (mode === "check") {
      // read-only: a transaction already bound to another request would fail the UNIQUE constraint on commit
      const other = store.db.prepare("SELECT requestId FROM payments WHERE txHash = ? AND requestId <> ?").get(proof.txHash.toLowerCase(), requestId);
      if (other) return refused(409, { error: "already_redeemed", reason: "tx_reused" }, "tx_reused", { txHash: proof.txHash.toLowerCase(), payer: v.payer });
      return { kind: "settled", row: { ...row, state: "PAID_CONFIRMED", txHash: proof.txHash.toLowerCase(), blockNumber: v.blockNumber, payer: v.payer, agent: v.agent } };
    }
    try {
      store.transition(requestId, ["PAID_PENDING"], "PAID_CONFIRMED", { txHash: proof.txHash.toLowerCase(), blockNumber: v.blockNumber, payer: v.payer, agent: v.agent }, "verified");
    } catch (e) {
      if (isSqliteError(e) && !/UNIQUE/i.test(String((e as Error)?.message))) throw e;
      return refused(409, { error: "already_redeemed", reason: "tx_reused" }, "tx_reused", { payer: v.payer }); // txHash UNIQUE: tx already backs another request
    }
    return { kind: "settled", row: store.get(requestId)! };
  }

  async function issueChallenge(req: Request, res: Response, resourceId: string, route: string, rule: PriceRule, correlationId: string) {
    // O4 (x402 only): the canonical resource URL is computed before anything is written; a non-canonical target is refused
    const canonical = x402cfg ? resourceUrlOf(req) : null;
    if (canonical && !canonical.ok) {
      emit({ evt: "challenge_refused", correlationId, reason: canonical.reason, route });
      return fail(res, canonical.status, canonical.status === 400 ? { error: "invalid_request", reason: canonical.reason } : { error: canonical.reason });
    }
    if (guard) {
      // query limits: a long or parameter-heavy query string is refused before anything is written
      const q = req.originalUrl.indexOf("?") >= 0 ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : "";
      if (q.length > guard.maxQueryLength) return fail(res, 414, { error: "query_too_long", max: guard.maxQueryLength });
      if (q && [...new URLSearchParams(q).keys()].length > guard.maxQueryParams) return fail(res, 400, { error: "too_many_query_params", max: guard.maxQueryParams });
      // per-client token bucket on issuance
      const key = (guard.clientKey ? guard.clientKey(req) : req.ip) ?? "unknown";
      const t = Date.now() / 1000;
      const b = buckets.get(key) ?? { tokens: guard.burst, at: t };
      b.tokens = Math.min(guard.burst, b.tokens + (t - b.at) * guard.refillPerSecond);
      b.at = t;
      if (b.tokens < 1) {
        buckets.set(key, b);
        const wait = Math.max(1, Math.ceil((1 - b.tokens) / Math.max(guard.refillPerSecond, 1e-9)));
        res.setHeader("retry-after", String(wait));
        emit({ evt: "challenge_refused", correlationId, reason: "challenge_quota", route });
        return fail(res, 429, { error: "rate_limited", reason: "challenge_quota", retryAfter: wait });
      }
      // cap on live unpaid rows per route
      if (store.countLiveUnpaid(route, paymentGrace, now()) >= guard.maxUnpaidPerRoute) {
        res.setHeader("retry-after", String(retryAfter));
        emit({ evt: "challenge_refused", correlationId, reason: "route_capacity", route });
        return fail(res, 503, { error: "challenge_capacity", retryAfter });
      }
      b.tokens -= 1;
      buckets.set(key, b);
      if (buckets.size > guard.maxTrackedClients) for (const [k, v] of buckets) if (v.tokens >= guard.burst - 1e-9 || buckets.size > guard.maxTrackedClients) buckets.delete(k);
    }
    if (rule.preflight) {
      const reason = await rule.preflight(req);
      if (reason) return fail(res, 503, { error: reason }); // nothing charged, no challenge
    }
    const f: ChallengeFields = { nonce: newNonce(), merchant, resourceId, priceBase: BigInt(rule.priceBase).toString(), chainId: cfg.chainId, contract, expiresAt: now() + ttl };
    const requestId = computeRequestId(f);
    store.insert({ requestId, ...f, route, mount: req.baseUrl ?? "" });
    const sig = sign(cfg.hmacSecrets[0], requestId, f);
    emit({ evt: "challenge_issued", correlationId, requestId, resourceId, priceBase: f.priceBase, x402: !!x402cfg });
    res.setHeader("cache-control", "no-store");
    if (x402cfg && canonical?.ok) {
      // the same signed row, as an x402 v2 PaymentRequired (custom scheme turnspike-allowance)
      const requirement = x402Requirement(
        { chainId: cfg.chainId, contract, token, merchant, priceBase: f.priceBase, resourceId, maxTimeoutSeconds: maxTimeout },
        { requestId, sig, expiresAt: f.expiresAt, paymentDeadline: f.expiresAt + paymentGrace },
      );
      const url = canonical.url;
      res.setHeader("PAYMENT-REQUIRED", encodeX402Header(x402PaymentRequired({ url, description: x402cfg.description, mimeType: x402cfg.mimeType }, [requirement])));
    }
    res.status(402).json({
      error: "payment_required", protocol: PROTOCOL, requestId, sig, priceBase: f.priceBase, token,
      contract, merchant, chainId: cfg.chainId, resourceId, expiresAt: f.expiresAt, paymentDeadline: f.expiresAt + paymentGrace,
    });
  }

  function replay(res: Response, row: PaymentRow, correlationId?: string) {
    if (row.responsePurgedAt || (replayWindow > 0 && (row.deliveredAt ?? row.updatedAt) + replayWindow < wallNow())) {
      if (!row.responsePurgedAt) store.purgeResponse(row.requestId);
      emit({ evt: "replay_window_expired", correlationId, requestId: row.requestId });
      res.setHeader("cache-control", "no-store");
      return fail(res, 410, { error: "replay_window_expired" });
    }
    const s = store.storedResponse(row);
    for (const [k, v] of Object.entries(s.headers)) res.setHeader(k, v);
    res.setHeader("content-type", s.type);
    res.setHeader("x-turnspike-replay", "1");
    emit({ evt: "replay", correlationId, requestId: row.requestId, status: s.status });
    res.status(s.status).end(s.body);
  }

  /**
   * Runs the downstream handler against a buffering response. The response is written to SQLite (synchronously, fsync'd)
   * BEFORE any byte reaches the client, so a client never holds data the database does not know about. If the handler fails or
   * returns a non-2xx status the lease is released, the payment stays PAID_CONFIRMED and the same proof can retry.
   * The lease is renewed every lease/3 seconds while the handler runs. If renewal fails (the lease lapsed and another
   * process took over), this run's output is discarded: the other holder owns the stored response.
   */
  function runDelivery(req: Request, res: Response, next: NextFunction, requestId: string, leaseToken: string, correlationId: string) {
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

  const reap = () => (guard ? store.reapIssued({ paymentGraceSeconds: paymentGrace, graceSeconds: guard.reaperGraceSeconds, nowSeconds: now() }) : store.reapIssued({ paymentGraceSeconds: paymentGrace, nowSeconds: now() }));
  let reaper: ReturnType<typeof setInterval> | null = null;
  if (guard && guard.reaperIntervalSeconds > 0) {
    reaper = setInterval(() => {
      try {
        const n = reap();
        if (n) emit({ evt: "reaped", rows: n });
      } catch { /* storage closed or busy: next run */ }
    }, guard.reaperIntervalSeconds * 1000);
    reaper.unref?.();
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
        store.transition(m.requestId, ["PAID_PENDING"], "REJECTED", { txHash: m.txHash, payer: v.txRecord.payer, agent: v.txRecord.agent, blockNumber: v.txRecord.blockNumber, disposition: "PAID_LATE" }, "reconciled_paid_too_late");
        emit({ evt: "payment_paid_late", requestId: m.requestId, txHash: m.txHash, source: "reconcile" });
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
    if (reaper) clearInterval(reaper);
    for (const p of providers) p.destroy();
    if (!cfg.store) store.close();
  };

  Object.defineProperty(mw, "info", {
    enumerable: true,
    value: Object.freeze({
      chainId: cfg.chainId, network: caip2(cfg.chainId), contract, token, merchant, confirmations, challengeTtlSeconds: ttl,
      paymentGraceSeconds: paymentGrace, maxTimeoutSeconds: maxTimeout, replayWindowSeconds: replayWindow, x402: !!x402cfg,
      resourceUrlConfigured: !!resourcePolicy && resourcePolicy.mode !== "dev",
      resourceUrlMode: resourcePolicy?.mode ?? null, production: resourcePolicy?.production ?? false,
    } satisfies TurnspikeInfo),
  });
  Object.defineProperty(mw, "resourcePolicy", { enumerable: true, value: resourcePolicy });
  mw.describe = async (req) => {
    const m = matchRule(cfg.prices, req.path);
    if (!m) return { kind: "free" };
    if (m.rule.validate) {
      const bad = await m.rule.validate(req);
      if (bad) return { kind: "invalid", status: 400, body: { error: "invalid_request", reason: bad } };
    }
    if (!resourcePolicy) throw new Error("describe() needs the middleware created with x402 enabled");
    const c = resourceUrlOf(req);
    if (!c.ok) return { kind: "invalid", status: c.status, body: c.status === 400 ? { error: "invalid_request", reason: c.reason } : { error: c.reason } };
    return {
      kind: "priced", route: m.pattern, resourceId: resourceIdFor(req, m.rule), priceBase: BigInt(m.rule.priceBase).toString(),
      resourceUrl: c.url, resourceUrlTrusted: c.trusted, resourcePathAndQuery: c.pathAndQuery,
    };
  };
  mw.admit = admit;
  const parseProof = (p: unknown): Proof | null => { const r = proofSchema.safeParse(p); return r.success ? r.data : null; };
  mw.settleProof = async (p, resourceId, meta = {}) => {
    const proof = parseProof(p);
    if (!proof) return { kind: "refused", code: "malformed_proof", status: 402, body: np("malformed_proof") };
    try {
      return await processProof(proof, resourceId, "settle", meta.correlationId ?? randomUUID(), meta.protocol ?? "x402");
    } catch (e) {
      if (isSqliteError(e)) return { kind: "storage_unavailable" };
      throw e;
    }
  };
  mw.checkProof = async (p, resourceId) => {
    const proof = parseProof(p);
    if (!proof) return { kind: "refused", code: "malformed_proof", status: 402, body: np("malformed_proof") };
    try {
      return await processProof(proof, resourceId, "check", randomUUID(), "x402");
    } catch (e) {
      if (isSqliteError(e)) return { kind: "storage_unavailable" };
      throw e;
    }
  };
  mw.deliver = async (req, res, requestId, next, meta = {}) => {
    const correlationId = meta.correlationId ?? corr(req);
    try {
      res.setHeader("x-correlation-id", correlationId);
      if (cfg.exposeHeaders !== false) exposePaymentHeaders(res);
      const rid = String(requestId).toLowerCase();
      const row = store.get(rid);
      if (!row) return needPayment(res, "unknown_request");
      const m = matchRule(cfg.prices, req.path);
      if (!m || resourceIdFor(req, m.rule) !== row.resourceId) return fail(res, 403, { error: "wrong_resource" });
      // R1 (x402 only: deliver() is called by x402Seller, never by the turnspike/1 X-PAYMENT path): the row is also bound to the mount prefix it was issued under.
      if (row.mount != null && row.mount !== (req.baseUrl ?? "")) return fail(res, 403, { error: "wrong_resource" });
      if (row.state === "DELIVERED") return replay(res, row, correlationId);
      if (row.state !== "PAID_CONFIRMED" && row.state !== "DELIVERING") return needPayment(res, "not_settled");
      const leaseToken = store.claimDelivery(rid, lease);
      if (!leaseToken) return fail(res, 202, { status: "pending", why: "delivering", retryAfter });
      emit({ evt: "delivery_started", correlationId, requestId: rid, txHash: row.txHash, protocol: meta.protocol ?? "x402" });
      runDelivery(req, res, next, rid, leaseToken, correlationId);
    } catch (e) {
      if (isSqliteError(e)) return fail(res, 503, { error: "storage_unavailable" });
      next(e);
    }
  };
  mw.paidUndelivered = (o = {}) => store.paidUndelivered({ staleSeconds: o.staleSeconds });
  mw.reap = reap;
  mw.purgeExpiredResponses = () => (replayWindow > 0 ? store.purgeExpiredResponses(replayWindow, wallNow()) : 0);
  mw.payerOf = (txHash) => payerFromTx(providers, contract, txHash);
  mw.log = emit;
  return mw;
}

/** @deprecated Former product spelling, kept so existing integrations keep compiling. Use `turnspike`. */
export const turnpike = turnspike;
/** @deprecated Use `TurnspikeConfig`. */
export type TurnpikeConfig = TurnspikeConfig;
