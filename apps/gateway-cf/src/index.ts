import { computeRequestId, newNonce, sameSecret, sha256, sign, verifySig, type ChallengeFields } from "./challenge";
import { ChainUnavailable, isUsedOnChain, scanPaid, verifyPayment, withFailover, type ChainConfig } from "./chain";
import type { ExportRow, Ledger, PaymentRow, Stored } from "./ledger";
import { resolve, type Resource } from "./resources";

export { Ledger } from "./ledger";

const PROTOCOL = "turnspike/1";
const RETRY_AFTER = 4;
const MAX_RESPONSE = 1_048_576;
const hex32 = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const FREE = ["/healthz", "/readyz", "/v1/config", "/v1/stats", "/v1/history", "/v1/payments/:requestId", "/demo/status"];

interface Settings extends ChainConfig { token: string; ttl: number; retention: number; lease: number; perDay: number; perMinute: number; own: string[]; origins: string[]; payments: boolean; secrets: string[]; fromBlock: number }

/** Validated on every request from bindings (cheap string work). Throws with what is wrong instead of running half configured. */
export function settings(env: Env): Settings {
  const bad: string[] = [];
  const addr = (k: "CONTRACT" | "TOKEN" | "MERCHANT") => { if (!address.test(env[k])) bad.push(k); return env[k]; };
  const int = (k: "CHAIN_ID" | "CONFIRMATIONS" | "CHALLENGE_TTL_SECONDS" | "PAYMENT_GRACE_SECONDS" | "RETENTION_SECONDS" | "LEASE_SECONDS" | "CHALLENGES_PER_DAY" | "RATE_LIMIT_PER_MINUTE" | "RECONCILE_FROM_BLOCK", min: number) => {
    const n = Number(env[k]);
    if (!Number.isInteger(n) || n < min) bad.push(k);
    return n;
  };
  const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const optional = env as unknown as Record<string, string | undefined>;
  const payments = String(env.PAYMENTS_ENABLED) === "true";
  const secrets = [optional.HMAC_SECRET, optional.HMAC_SECRET_PREVIOUS].filter((s): s is string => !!s);
  if (payments && !secrets.length) bad.push("HMAC_SECRET");
  if (secrets.some((s) => s.length < 32)) bad.push("HMAC_SECRET length");
  const urls = list(env.RPC_URLS);
  if (!urls.length) bad.push("RPC_URLS");
  const s: Settings = {
    urls, chainId: int("CHAIN_ID", 1), contract: addr("CONTRACT"), token: addr("TOKEN"), merchant: addr("MERCHANT"), confirmations: int("CONFIRMATIONS", 1),
    graceSeconds: int("PAYMENT_GRACE_SECONDS", 0), ttl: int("CHALLENGE_TTL_SECONDS", 30), retention: int("RETENTION_SECONDS", 3600), lease: int("LEASE_SECONDS", 5),
    perDay: int("CHALLENGES_PER_DAY", 1), perMinute: int("RATE_LIMIT_PER_MINUTE", 1), fromBlock: int("RECONCILE_FROM_BLOCK", 0),
    own: list(env.OWN_ADDRESSES), origins: list(env.ALLOWED_ORIGINS), payments, secrets,
  };
  if (bad.length) throw new Error("invalid configuration: " + bad.join(", "));
  return s;
}

const log = (e: Record<string, unknown>) => console.log(JSON.stringify(e)); // never proofs, signatures, secrets or bodies
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
const needPayment = (reason: string) => json({ error: "payment_required", reason }, 402);
const ledgerOf = (env: Env): DurableObjectStub<Ledger> => env.LEDGER.getByName(env.LEDGER_NAME);

/** Storage did not answer. The caller must not conclude anything about payment or delivery. */
class StorageUnavailable extends Error {}
async function store<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    log({ evt: "storage_error", message: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    throw new StorageUnavailable();
  }
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    let cfg: Settings;
    try { cfg = settings(env); } catch (e) {
      log({ evt: "config_error", message: e instanceof Error ? e.message : "unknown" });
      return json({ error: "misconfigured" }, 500);
    }
    const origin = req.headers.get("origin");
    const cors: Record<string, string> = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", vary: "Origin" };
    if (origin && (cfg.origins.includes("*") || cfg.origins.includes(origin))) {
      Object.assign(cors, { "access-control-allow-origin": origin, "access-control-allow-headers": "x-payment,content-type,x-correlation-id", "access-control-allow-methods": "GET,OPTIONS", "access-control-expose-headers": "retry-after,x-correlation-id,x-turnspike-replay" });
    }
    const correlationId = (req.headers.get("x-correlation-id") ?? "").slice(0, 64).replace(/[^\w.-]/g, "") || crypto.randomUUID();
    let res: Response;
    try {
      res = req.method === "OPTIONS" ? new Response(null, { status: 204 }) : await route(req, url, env, ctx, cfg, correlationId);
    } catch (e) {
      if (e instanceof StorageUnavailable) res = json({ error: "storage_unavailable", retryAfter: RETRY_AFTER }, 503, { "retry-after": String(RETRY_AFTER) });
      else if (e instanceof ChainUnavailable) res = json({ error: "rpc_unavailable", retryAfter: RETRY_AFTER }, 503, { "retry-after": String(RETRY_AFTER) });
      else {
        log({ evt: "unhandled_error", correlationId, message: e instanceof Error ? e.message.slice(0, 300) : "unknown" });
        res = json({ error: "internal" }, 500); // never echo internals
      }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    out.headers.set("x-correlation-id", correlationId);
    return out;
  },

  async scheduled(_c, env): Promise<void> {
    const cfg = settings(env);
    const ledger = ledgerOf(env);
    try { log({ evt: "reconciled", ...(await reconcile(cfg, ledger)) }); } catch (e) { log({ evt: "reconcile_failed", message: e instanceof Error ? e.message : "unknown" }); }
    log({ evt: "purged", rows: await ledger.purge(cfg.retention, cfg.graceSeconds) });
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, url: URL, env: Env, ctx: ExecutionContext, cfg: Settings, correlationId: string): Promise<Response> {
  const path = url.pathname;
  const ledger = ledgerOf(env);
  if (path.startsWith("/admin/")) return admin(req, url, env, cfg, ledger);
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET, OPTIONS" });

  if (path === "/") return json({ service: "turnspike-gateway", runtime: "cloudflare", payments: cfg.payments, endpoints: [...FREE, "/v1/block-summary (402)", "/v1/address/:address (402)", "/v1/qusdc-activity/:address?blocks=N (402)"] });
  if (path === "/healthz") return json({ ok: true });
  if (path === "/readyz") {
    const storage = await ledger.ping().then(() => true, () => false);
    const rpc = await withFailover(cfg, (r) => r.head()).then((head) => ({ ok: true, head }), () => ({ ok: false, head: null }));
    return json({ ok: storage && rpc.ok, storage, rpc: rpc.ok, head: rpc.head, payments: cfg.payments }, storage && rpc.ok ? 200 : 503);
  }
  if (path === "/v1/config") {
    return json({ chainId: cfg.chainId, contract: cfg.contract, token: cfg.token, merchant: cfg.merchant, priceBase: "1000", priceAddressBase: "1000", priceActivityBase: "2000", confirmations: cfg.confirmations, demoEnabled: false, paymentsEnabled: cfg.payments, explorer: env.EXPLORER });
  }
  if (path === "/v1/stats") return json(await store(ledger.stats(cfg.own)));
  if (path === "/v1/history") return json({ payments: await store(ledger.recent(Number(url.searchParams.get("limit") ?? 20) || 20)) });
  if (path === "/demo/status") return json({ enabled: false });
  const status = /^\/v1\/payments\/(0x[0-9a-fA-F]{64})$/.exec(path);
  if (status) {
    const id = status[1]!.toLowerCase();
    const row = await store(ledger.get(id));
    if (row) return json({ state: row.state, txHash: row.txHash, expiresAt: row.expiresAt });
    // No record here is not evidence of no payment: ask the chain before saying so.
    const o = await store(ledger.orphan(id));
    if (o) return json({ state: "PAID_UNRECORDED", txHash: o.txHash, expiresAt: 0 });
    if (await isUsedOnChain(cfg, id)) return json({ state: "PAID_UNRECORDED", txHash: null, expiresAt: 0 });
    return json({ error: "unknown_request", paidOnChain: false }, 404);
  }

  const r = resolve(url);
  if (!r) return json({ error: "not_found" }, 404);
  if ("invalid" in r) return json({ error: "invalid_request", reason: r.invalid }, 400); // before any price is quoted
  const header = req.headers.get("x-payment");
  return header === null ? challenge(req, env, cfg, ledger, r, correlationId) : redeem(header, ctx, cfg, ledger, r, correlationId);
}

async function challenge(req: Request, _env: Env, cfg: Settings, ledger: DurableObjectStub<Ledger>, r: Resource, correlationId: string): Promise<Response> {
  if (!cfg.payments) return json({ error: "payments_disabled", message: "This gateway does not accept payments. Do not send one." }, 503);
  const f: ChallengeFields = { nonce: newNonce(), merchant: cfg.merchant, resourceId: r.resourceId, priceBase: r.priceBase, chainId: cfg.chainId, contract: cfg.contract, expiresAt: Math.floor(Date.now() / 1000) + cfg.ttl };
  const requestId = computeRequestId(f);
  const client = sha256(req.headers.get("cf-connecting-ip") ?? "unknown").slice(0, 16); // no raw addresses are kept
  const done = await store(ledger.issue({ requestId, ...f }, client, { perMinute: cfg.perMinute, perDay: cfg.perDay }));
  if (done === "rate_limited") return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  if (done === "budget") return json({ error: "challenge_budget_exhausted", message: "No new quotes today. Paid requests are still served." }, 503, { "retry-after": "3600" });
  log({ evt: "challenge_issued", correlationId, requestId, resourceId: r.resourceId, priceBase: r.priceBase });
  return json({ error: "payment_required", protocol: PROTOCOL, requestId, sig: sign(cfg.secrets[0]!, requestId, f), priceBase: f.priceBase, token: cfg.token, contract: f.contract, merchant: f.merchant, chainId: f.chainId, resourceId: f.resourceId, expiresAt: f.expiresAt, paymentDeadline: f.expiresAt + cfg.graceSeconds }, 402);
}

function parseProof(header: string): { requestId: string; txHash: string; sig: string } | null {
  try {
    if (header.length > 2048) return null;
    const p: unknown = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (typeof p !== "object" || p === null || Object.keys(p).sort().join() !== "requestId,sig,txHash") return null;
    const { requestId, txHash, sig } = p as Record<string, unknown>;
    if (typeof requestId !== "string" || typeof txHash !== "string" || typeof sig !== "string" || !hex32.test(requestId) || !hex32.test(txHash) || !/^[0-9a-fA-F]{64}$/.test(sig)) return null;
    return { requestId: requestId.toLowerCase(), txHash: txHash.toLowerCase(), sig };
  } catch { return null; }
}

function replay(s: Stored | null): Response {
  if (!s) throw new StorageUnavailable(); // DELIVERED without a body must never turn into a second charge or an empty success
  return new Response(s.body, { status: s.status, headers: { ...s.headers, "content-type": s.type, "x-turnspike-replay": "1" } });
}

async function redeem(header: string, ctx: ExecutionContext, cfg: Settings, ledger: DurableObjectStub<Ledger>, r: Resource, correlationId: string): Promise<Response> {
  // 1. Authenticate the proof. Nothing is revealed or changed before every check below passes.
  const proof = parseProof(header);
  if (!proof) return needPayment("malformed_proof");
  const { requestId, txHash } = proof;
  const row = await store(ledger.get(requestId));
  if (!row) {
    // Not known here. If the chain says it was paid, this gateway lost or never had the record: never answer "unpaid".
    if ((await store(ledger.orphan(requestId))) || (await isUsedOnChain(cfg, requestId))) return json({ error: "payment_unrecorded", message: "Paid on chain, but this gateway has no record of the request. Keep the proof; do not pay again.", retryAfter: 60 }, 503, { "retry-after": "60" });
    return needPayment("unknown_request");
  }
  const f: ChallengeFields = { nonce: row.nonce, merchant: row.merchant, resourceId: row.resourceId, priceBase: row.priceBase, chainId: row.chainId, contract: row.contract, expiresAt: row.expiresAt };
  if (computeRequestId(f) !== requestId) return needPayment("integrity");
  if (!cfg.secrets.length) return json({ error: "payments_disabled" }, 503);
  if (!verifySig(cfg.secrets, requestId, f, proof.sig)) return needPayment("bad_signature");
  // 2. A proof authorizes its own resource and its own transaction only.
  if (row.resourceId !== r.resourceId) return json({ error: "wrong_resource" }, 403);
  if (row.txHash && row.txHash !== txHash) return json({ error: "already_redeemed", reason: "different_tx" }, 409);
  // 3. Replay of a delivered response.
  if (row.state === "DELIVERED") return replay(await store(ledger.response(requestId)));
  if (row.state === "REJECTED") return needPayment("rejected");
  // 4. Verify on chain. Accepted even when new payments are switched off: what was paid must stay redeemable.
  if (!row.txHash) {
    if (row.state !== "PAID_PENDING") await store(ledger.proofSeen(requestId));
    const v = await verifyPayment(cfg, row, txHash);
    if (v.kind === "rpc_unavailable") return json({ error: "rpc_unavailable", retryAfter: RETRY_AFTER }, 503, { "retry-after": String(RETRY_AFTER) });
    if (v.kind === "pending") return json({ status: "pending", why: v.why, confirmations: v.confirmations, required: cfg.confirmations, retryAfter: RETRY_AFTER }, 202);
    if (v.kind === "rejected") {
      if (v.late) await store(ledger.rejectLate(requestId, txHash, v.late));
      log({ evt: "payment_rejected", correlationId, requestId, reason: v.reason });
      return needPayment(v.reason);
    }
    const done = await store(ledger.confirm(requestId, txHash, v, "verified"));
    if (done === "tx_reused") return json({ error: "already_redeemed", reason: "tx_reused" }, 409);
    if (done === "conflict") return json({ status: "pending", why: "state_changed", retryAfter: RETRY_AFTER }, 202);
  }
  // 5. Deliver: take the fenced lease, run the handler, store the response, then send it. It finishes even if the caller leaves.
  const work = deliver(cfg, ledger, requestId, r, correlationId);
  ctx.waitUntil(work.catch(() => {}));
  return work;
}

async function deliver(cfg: Settings, ledger: DurableObjectStub<Ledger>, requestId: string, r: Resource, correlationId: string): Promise<Response> {
  const token = await store(ledger.claim(requestId, cfg.lease));
  if (!token) {
    const now: PaymentRow | null = await store(ledger.get(requestId));
    if (now?.state === "DELIVERED") return replay(await store(ledger.response(requestId)));
    return json({ status: "pending", why: "delivering", retryAfter: RETRY_AFTER }, 202);
  }
  log({ evt: "delivery_started", correlationId, requestId });
  let body: ArrayBuffer;
  try {
    const value = await r.run(cfg, AbortSignal.timeout(Math.max(1, cfg.lease - 10) * 1000));
    body = new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
    if (body.byteLength > MAX_RESPONSE) throw new Error("response_too_large");
  } catch (e) {
    const why = e instanceof ChainUnavailable ? "rpc_unavailable" : e instanceof Error ? e.message.slice(0, 80) : "handler_failed";
    await store(ledger.release(requestId, token, why)); // paid and not delivered: the same proof can try again
    log({ evt: "delivery_failed", correlationId, requestId, reason: why });
    return json({ error: "delivery_failed", reason: e instanceof ChainUnavailable ? "rpc_unavailable" : "handler_failed", retryAfter: RETRY_AFTER }, 503, { "retry-after": String(RETRY_AFTER) });
  }
  const s: Stored = { status: 200, type: "application/json; charset=utf-8", headers: { "cache-control": "private, no-store" }, body };
  if (!(await store(ledger.complete(requestId, token, s)))) {
    // The lease was taken over. The other holder owns the stored response; this one is discarded.
    const cur = await store(ledger.get(requestId));
    if (cur?.state === "DELIVERED") return replay(await store(ledger.response(requestId)));
    return json({ status: "pending", why: "delivering", retryAfter: RETRY_AFTER }, 202);
  }
  log({ evt: "delivered", correlationId, requestId, bytes: body.byteLength });
  return new Response(body, { status: 200, headers: { ...s.headers, "content-type": s.type } });
}

/** Finds payments that reached the chain without a proof reaching this gateway. Safe to run twice at once. */
async function reconcile(cfg: Settings, ledger: DurableObjectStub<Ledger>) {
  const from = ((await ledger.reconciledBlock()) ?? Math.max(0, cfg.fromBlock - 1)) + 1;
  const scan = await scanPaid(cfg, from);
  const need = new Set(await ledger.triage(scan.found));
  let recovered = 0, late = 0, undecided = 0;
  for (const f of scan.found) {
    if (!need.has(f.requestId)) continue;
    const row = await ledger.get(f.requestId);
    if (!row) continue;
    const v = await verifyPayment(cfg, row, f.txHash);
    if (v.kind === "ok") { if ((await ledger.confirm(f.requestId, f.txHash, v, "reconciled")) === "ok") recovered++; }
    else if (v.kind === "rejected" && v.late) { if (await ledger.rejectLate(f.requestId, f.txHash, v.late)) late++; }
    else if (v.kind !== "rejected") undecided++;
  }
  // Only move the mark when every payment found was decided, so an RPC failure half way is retried from the same place.
  if (!undecided && scan.toBlock >= from) await ledger.reconciled(scan.toBlock, scan.throughTime);
  return { from, to: scan.toBlock, found: scan.found.length, recovered, late, undecided, complete: scan.complete };
}

async function admin(req: Request, url: URL, env: Env, cfg: Settings, ledger: DurableObjectStub<Ledger>): Promise<Response> {
  const token = (env as unknown as Record<string, string | undefined>).ADMIN_TOKEN;
  const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token || token.length < 32 || !given || !sameSecret(token, given)) return json({ error: "not_found" }, 404); // absent unless configured
  if (req.method === "GET" && url.pathname === "/admin/export") return json(await store(ledger.export(url.searchParams.get("after") ?? "", 200)));
  if (req.method === "POST" && url.pathname === "/admin/reconcile") return json(await reconcile(cfg, ledger));
  if (req.method === "POST" && url.pathname === "/admin/import") {
    if (Number(req.headers.get("content-length") ?? Infinity) > 8_000_000) return json({ error: "too_large" }, 413);
    const body = await req.json<{ rows?: ExportRow[] }>().catch(() => null);
    if (!body || !Array.isArray(body.rows) || body.rows.length > 500) return json({ error: "invalid_request" }, 400);
    try { return json(await ledger.import(body.rows, { merchant: cfg.merchant, contract: cfg.contract, chainId: cfg.chainId })); } catch (e) {
      return json({ error: "refused", reason: e instanceof Error ? e.message : "unknown" }, 409); // all or nothing
    }
  }
  return json({ error: "not_found" }, 404);
}
