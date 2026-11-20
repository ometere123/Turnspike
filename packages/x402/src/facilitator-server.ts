import express, { type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { x402Facilitator } from "@x402/core/facilitator";
import { AUTH_HEADERS, canonicalRequest, createTurnspikeFacilitator, signRequest } from "./facilitator-client";
import type { SettlementBackend } from "./scheme/facilitator";
import { ErrorCodes } from "./common";

export interface FacilitatorServerOptions {
  /** The settlement backend: a turnspike middleware instance sharing the seller's store and HMAC secrets. */
  backend: SettlementBackend;
  /** Shared secrets for request authentication ([current, ...previous]); each at least 32 bytes. */
  secrets: string[];
  /** Interface to bind. Default 127.0.0.1 (never 0.0.0.0 unless you set it). */
  host?: string;
  /** Port. Default 0 (ephemeral). */
  port?: number;
  /** Accepted clock skew for the request timestamp, seconds. Default 60. Nonces are remembered for twice this. */
  maxSkewSeconds?: number;
  /** Requests per minute per client IP. Default 600. */
  rateLimitPerMinute?: number;
  /** Maximum body size. Default 64 KiB. */
  maxBodyBytes?: number;
  /** Structured event sink (redacted: no bodies, signatures or secrets). Default: the backend's logger. */
  onEvent?: (e: Record<string, unknown>) => void;
  /** Test hook: called after a settle completed, before the response is sent. Return "drop" to destroy the connection. */
  faultAfterSettle?: () => "drop" | void;
}

export interface FacilitatorServerHandle {
  url: string;
  server: Server;
  app: express.Express;
  close(): Promise<void>;
}

const anyObject = z.record(z.string(), z.unknown());
const requirementsShape = z.object({
  scheme: z.string().min(1).max(64), network: z.string().min(3).max(64), amount: z.string().regex(/^[0-9]{1,78}$/),
  asset: z.string().min(1).max(128), payTo: z.string().min(1).max(128), maxTimeoutSeconds: z.number().int().positive().max(86_400), extra: anyObject,
}).strict();
const payloadShape = z.object({
  x402Version: z.literal(2), resource: anyObject.optional(), accepted: requirementsShape, payload: anyObject, extensions: anyObject.optional(),
}).strict();
const bodySchema = z.object({ x402Version: z.literal(2), paymentPayload: payloadShape, paymentRequirements: requirementsShape }).strict();

/**
 * Standalone x402 v2 facilitator for `turnspike-allowance` (opt-in, for sellers running several instances behind one
 * facilitator; the default is the in-process LocalFacilitatorClient). It is part of the merchant, not a third party: it
 * holds the merchant's HMAC secrets through the backend and shares its store.
 *
 *  - Every request must carry an HMAC-SHA256 (shared secret) over timestamp, nonce, method, path and the exact body
 *    bytes; the timestamp must be within `maxSkewSeconds` and the nonce unseen (replay protection). Use
 *    RemoteFacilitatorClient on the resource server.
 *  - Binds to 127.0.0.1 unless told otherwise; bodies are size-limited and fully validated; per-IP rate limit;
 *    errors never leak internals (a generic 500 with no stack).
 *  - GET /supported, POST /verify (read-only), POST /settle.
 */
export async function createFacilitatorServer(o: FacilitatorServerOptions): Promise<FacilitatorServerHandle> {
  if (!o.secrets?.length || o.secrets.some((s) => Buffer.byteLength(s) < 32)) throw new Error("facilitator secrets must be at least 32 bytes each");
  const facilitator: x402Facilitator = createTurnspikeFacilitator(o.backend);
  const skew = o.maxSkewSeconds ?? 60;
  const limit = o.rateLimitPerMinute ?? 600;
  const log = (e: Record<string, unknown>) => (o.onEvent ?? o.backend.log)(e);
  const seen = new Map<string, number>(); // nonce -> expiry (ms)
  const hits = new Map<string, { n: number; reset: number }>();
  const nowS = () => Math.floor(Date.now() / 1000);

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  // per-IP fixed-window rate limit, before any parsing
  app.use((req, res, next) => {
    const ip = req.ip ?? "unknown";
    const t = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < t) hits.set(ip, { n: 1, reset: t + 60_000 });
    else if (++h.n > limit) { log({ evt: "x402.facilitator.refused", reason: "rate_limited" }); return void res.status(429).json({ error: "rate_limited" }); }
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
    next();
  });
  // raw body, so the HMAC covers the exact bytes received
  app.use(express.raw({ type: () => true, limit: o.maxBodyBytes ?? 65_536 }));
  // authentication
  app.use((req, res, next) => {
    const ts = req.header(AUTH_HEADERS.timestamp) ?? "";
    const nonce = req.header(AUTH_HEADERS.nonce) ?? "";
    const sig = req.header(AUTH_HEADERS.signature) ?? "";
    const refuse = (reason: string) => { log({ evt: "x402.facilitator.refused", reason, path: req.path }); res.status(401).json({ error: "unauthorized" }); };
    if (!/^[0-9]{1,12}$/.test(ts) || !/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return refuse("missing_or_malformed_auth");
    if (Math.abs(nowS() - Number(ts)) > skew) return refuse("stale_timestamp");
    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const canonical = canonicalRequest(ts, nonce, req.method, req.originalUrl.split("?")[0], body);
    const given = Buffer.from(sig, "hex");
    const ok = o.secrets.some((s) => { const want = Buffer.from(signRequest(s, canonical), "hex"); return want.length === given.length && timingSafeEqual(want, given); });
    if (!ok) return refuse("bad_signature");
    const t = Date.now();
    if (seen.size > 100_000) for (const [k, v] of seen) if (v < t) seen.delete(k);
    if ((seen.get(nonce) ?? 0) > t) return refuse("replayed_nonce");
    seen.set(nonce, t + 2 * skew * 1000);
    next();
  });

  const parse = (req: Request, res: Response) => {
    let raw: unknown;
    try { raw = JSON.parse((req.body as Buffer).toString("utf8")); } catch { res.status(400).json({ error: "invalid_json" }); return null; }
    const b = bodySchema.safeParse(raw);
    if (!b.success) {
      res.status(400).json({ error: ErrorCodes.invalidPayload, issues: b.error.issues.slice(0, 5).map((i) => i.path.join(".") + ": " + i.message) });
      return null;
    }
    return b.data;
  };

  app.get("/supported", (_req, res) => res.json(facilitator.getSupported()));
  app.post("/verify", async (req, res, next) => {
    try {
      const b = parse(req, res);
      if (!b) return;
      res.json(await facilitator.verify(b.paymentPayload as any, b.paymentRequirements as any));
    } catch (e) { next(e); }
  });
  app.post("/settle", async (req, res, next) => {
    try {
      const b = parse(req, res);
      if (!b) return;
      const out = await facilitator.settle(b.paymentPayload as any, b.paymentRequirements as any);
      if (o.faultAfterSettle?.() === "drop") { req.socket.destroy(); return; }
      res.json(out);
    } catch (e) { next(e); }
  });
  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  // safe error handler: no stack, no message
  app.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (e as any)?.type === "entity.too.large" ? 413 : (e as any)?.status === 400 ? 400 : 500;
    log({ evt: "x402.facilitator.error", status });
    if (!res.headersSent) res.status(status).json({ error: status === 413 ? "body_too_large" : status === 400 ? "bad_request" : "internal_error" });
  });

  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(o.port ?? 0, o.host ?? "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });
  const addr = server.address() as { address: string; port: number };
  const host = addr.address.includes(":") ? `[${addr.address}]` : addr.address;
  return {
    url: `http://${host}:${addr.port}`, server, app,
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
