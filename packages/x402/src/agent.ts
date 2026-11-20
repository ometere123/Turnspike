import { keccak256, toUtf8Bytes } from "ethers";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { Network } from "@x402/core/types";
import {
  ErrorCodes, b64json, callContext, caip2, challengeRequirementsSchema, challengeToRequirement, unb64json, type CallContext, type ChallengeRequirements,
} from "./common";
import { TurnspikeAllowanceClient, type PayChallengeClient } from "./scheme/client";

/** Minimal view of the client's journal (read-only use: the recorded challenge and state of a purchase key). */
export interface JournalReader {
  get(key: string): Promise<{ state: string; challenge?: any; txHash?: string } | undefined>;
}

/** x402 data the client journal does not hold: the requirement accepted and the PAYMENT-SIGNATURE sent, per purchase key. */
export interface ProofStore {
  get(key: string): Promise<ProofRecord | undefined>;
  put(rec: ProofRecord): Promise<void>;
}
export interface ProofRecord { key: string; url: string; method: string; resource?: unknown; accepted?: ChallengeRequirements; header?: string; updatedAt: number }

export class MemoryProofStore implements ProofStore {
  private m = new Map<string, ProofRecord>();
  async get(k: string) { const r = this.m.get(k); return r ? structuredClone(r) : undefined; }
  async put(r: ProofRecord) { this.m.set(r.key, structuredClone(r)); }
}

/** JSON file proof store (atomic rename). Holds payment proofs: protect it like the client journal. One process per file. */
export class FileProofStore implements ProofStore {
  constructor(private readonly path: string) {}
  private read(): Record<string, ProofRecord> {
    const fs = require("node:fs") as typeof import("node:fs");
    return fs.existsSync(this.path) ? JSON.parse(fs.readFileSync(this.path, "utf8")) : {};
  }
  async get(k: string) { return this.read()[k]; }
  async put(r: ProofRecord) {
    const fs = require("node:fs") as typeof import("node:fs");
    const all = this.read(); all[r.key] = r;
    const tmp = `${this.path}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
    fs.renameSync(tmp, this.path);
  }
}

export interface CreateX402FetchOptions {
  /** TurnspikeClient (0.2.0): payChallenge, markProofPresented, markDelivered. */
  client: PayChallengeClient;
  /** The journal given to the client, read to resume a purchase key without asking for a new challenge. */
  journal: JournalReader;
  /** Owner and agent addresses: part of the default purchase key. */
  owner: string;
  agent: string;
  /** Trusted chain and token (x402 registration and spend controls). */
  network: { chainId: number; token: string };
  /** Per-payment ceiling for the x402 spend controls (the client's policy still applies). */
  maxPriceBase?: bigint;
  proofStore?: ProofStore;
  fetch?: typeof fetch;
  /** Re-presentation of a paid proof: attempts (default 8), first delay (1000 ms), cap (15 000 ms), total (120 000 ms). */
  retry?: { attempts?: number; baseDelayMs?: number; maxDelayMs?: number; totalMs?: number };
  /** maxTimeoutSeconds assumed when rebuilding a lost `accepted` from the journal. Default 300 (the seller default). */
  maxTimeoutSeconds?: number;
  maxRedirects?: number;
  onEvent?: (e: Record<string, unknown>) => void;
}

export interface PayOptions {
  /** Distinguishes deliberate repeat purchases of the same request. */
  intent?: string;
  /** Explicit purchase key (overrides the derived one). */
  purchaseKey?: string;
  maxPriceBase?: bigint;
}

export type X402FetchResult =
  | { ok: true; kind: "free" | "paid"; response: Response; purchaseKey: string; resumed: boolean; transaction?: string }
  | { ok: false; error: string; message: string; paid: boolean; maybePaid: boolean; purchaseKey: string; status?: number; proof?: { requestId: string; txHash: string; sig: string } };

export class X402AgentError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UNRESOLVED = new Set(["challenged", "paying", "broadcast", "confirmed", "proof_presented", "delivered"]);

/** URL normalisation for the purchase key: lowercase scheme/host, default port dropped, no fragment, sorted query. */
export function normaliseUrl(u: string): string {
  const x = new URL(u);
  x.hash = "";
  const pairs = [...x.searchParams.entries()].sort(([a, b], [c, d]) => (a === c ? (b < d ? -1 : b > d ? 1 : 0) : a < c ? -1 : 1));
  x.search = pairs.length ? "?" + new URLSearchParams(pairs).toString() : "";
  return x.toString();
}

/** keccak256 hex of the body bytes ("" for none); null when the body cannot be hashed without consuming it. */
export function bodyHashOf(body: unknown): string | null {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return keccak256(toUtf8Bytes(body));
  if (body instanceof URLSearchParams) return keccak256(toUtf8Bytes(body.toString()));
  if (body instanceof Uint8Array) return keccak256(body);
  if (body instanceof ArrayBuffer) return keccak256(new Uint8Array(body));
  return null;
}

/** Default purchase key: keccak(method, normalised URL, body hash, owner, agent [, intent]). */
export function purchaseKeyOf(method: string, url: string, bodyHash: string, owner: string, agent: string, intent?: string): string {
  return "x402:" + keccak256(toUtf8Bytes(JSON.stringify([method.toUpperCase(), normaliseUrl(url), bodyHash, owner.toLowerCase(), agent.toLowerCase(), intent ?? ""])));
}

/**
 * Safe agent entry point for x402 v2 (custom scheme turnspike-allowance). Wraps the official @x402/fetch wrapper with the
 * registered client scheme, and adds what a stock x402 integration lacks:
 *  - payee binding: redirects are followed manually and only within the origin; the policy URL is the URL actually
 *    fetched; PaymentRequired.resource.url must have that origin;
 *  - one purchase key per logical purchase (S1): derived by default, so a naive retry resumes instead of paying again;
 *  - after a payment exists for the key it never asks for a new challenge (S2, S5): it re-presents the same
 *    PAYMENT-SIGNATURE with bounded backoff, and reports `maybePaid` when the outcome is unknown.
 */
export function createX402Fetch(o: CreateX402FetchOptions) {
  const store = o.proofStore ?? new MemoryProofStore();
  const baseFetch = o.fetch ?? fetch;
  const emit = (e: Record<string, unknown>) => { try { o.onEvent?.(e); } catch { /* ignore */ } };
  const network = caip2(o.network.chainId) as Network;
  const retry = { attempts: 8, baseDelayMs: 1000, maxDelayMs: 15_000, totalMs: 120_000, ...(o.retry ?? {}) };

  /** fetch with manual, same-origin-only redirects. Records the final URL and the PAYMENT-SIGNATURE before sending. */
  async function transport(ctx: CallContext, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let req = new Request(input as any, init);
    const origin = new URL(req.url).origin;
    for (let hop = 0; ; hop++) {
      const sig = req.headers.get("payment-signature");
      if (sig) {
        ctx.paymentHeader = sig;
        const prev = await store.get(ctx.purchaseKey);
        await store.put({ ...(prev ?? { key: ctx.purchaseKey, method: ctx.method }), key: ctx.purchaseKey, url: ctx.url, method: ctx.method, header: sig, updatedAt: Date.now() });
      }
      const res = await baseFetch(new Request(req, { redirect: "manual" }));
      if (sig) {
        try { await o.client.markProofPresented(ctx.purchaseKey, (unb64json<any>(sig) as any)?.payload?.requestId); } catch { /* journal note only */ }
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, req.url);
        if (next.origin !== origin) throw new X402AgentError("cross_origin_redirect", `refusing redirect from ${origin} to ${next.origin}`);
        if (hop >= (o.maxRedirects ?? 3)) throw new X402AgentError("too_many_redirects", "redirect limit");
        req = new Request(next.toString(), req);
        continue;
      }
      if (!sig && res.status === 402) ctx.url = req.url; // bind the payee policy to the URL actually fetched
      return res;
    }
  }

  async function headerFor(ctx: CallContext, proof: { requestId: string; txHash: string; sig: string }): Promise<string | null> {
    const rec = await store.get(ctx.purchaseKey);
    if (rec?.header) {
      const p = unb64json<any>(rec.header);
      if (p?.payload?.requestId?.toLowerCase() === proof.requestId.toLowerCase()) return rec.header;
    }
    let accepted = rec?.accepted && rec.accepted.extra.requestId.toLowerCase() === proof.requestId.toLowerCase() ? rec.accepted : undefined;
    if (!accepted) {
      const j = await o.journal.get(ctx.purchaseKey);
      if (!j?.challenge || j.challenge.requestId.toLowerCase() !== proof.requestId.toLowerCase()) return null;
      accepted = challengeRequirementsSchema.parse(challengeToRequirement(j.challenge, o.maxTimeoutSeconds ?? 300));
    }
    const header = b64json({ x402Version: 2, resource: rec?.resource ?? { url: ctx.url }, accepted, payload: { requestId: proof.requestId, txHash: proof.txHash, sig: proof.sig } });
    await store.put({ ...(rec ?? { key: ctx.purchaseKey, url: ctx.url, method: ctx.method }), accepted, header, updatedAt: Date.now() } as ProofRecord);
    return header;
  }

  /** Re-presents one PAYMENT-SIGNATURE with bounded backoff. Never requests a new challenge. */
  async function present(ctx: CallContext, header: string, init: RequestInit, resumed: boolean): Promise<X402FetchResult> {
    const proof = (unb64json<any>(header) as any).payload;
    const start = Date.now();
    let delay = retry.baseDelayMs;
    let last = "";
    for (let i = 0; i < retry.attempts && Date.now() - start < retry.totalMs; i++) {
      if (i > 0) { await sleep(delay); delay = Math.min(delay * 2, retry.maxDelayMs); }
      let res: Response;
      try {
        const h = new Headers(init.headers as any);
        h.delete("x-payment");
        h.set("payment-signature", header);
        res = await transport(ctx, ctx.url, { ...init, method: ctx.method, headers: h });
      } catch (e) {
        if (e instanceof X402AgentError) return { ok: false, error: e.code, message: e.message, paid: true, maybePaid: false, purchaseKey: ctx.purchaseKey, proof };
        last = `transport: ${(e as Error)?.message ?? e}`;
        emit({ evt: "x402.agent.retry", reason: "transport" });
        continue;
      }
      const prHdr = res.headers.get("payment-response");
      let pr: any = null;
      try { pr = prHdr ? unb64json(prHdr) : null; } catch { /* ignore */ }
      if (res.status >= 200 && res.status < 300 && res.status !== 202) {
        try { await o.client.markDelivered(ctx.purchaseKey, proof.requestId); } catch { /* note only */ }
        return { ok: true, kind: "paid", response: res, purchaseKey: ctx.purchaseKey, resumed, transaction: pr?.transaction };
      }
      const retryable = res.status === 202 || res.status === 429 || res.status >= 500
        || (res.status === 402 && pr && !pr.success && (pr.errorReason === ErrorCodes.settlementPending || pr.errorReason === ErrorCodes.unexpectedSettleError));
      last = `${res.status} ${pr?.errorReason ?? ""}`.trim();
      if (!retryable) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, error: res.status === 410 ? "replay_window_expired" : "redeem_rejected", message: `the seller refused the proof: ${last}`, paid: true, maybePaid: false, purchaseKey: ctx.purchaseKey, status: res.status, proof };
      }
      await res.body?.cancel().catch(() => {});
      emit({ evt: "x402.agent.retry", reason: last });
    }
    return { ok: false, error: "redeem_timeout", message: `paid but not delivered yet (${last}); call again with the same key`, paid: true, maybePaid: false, purchaseKey: ctx.purchaseKey, proof };
  }

  return async function pay(input: string | URL, init: RequestInit = {}, po: PayOptions = {}): Promise<X402FetchResult> {
    const url = new URL(String(input)).toString();
    const method = (init.method ?? "GET").toUpperCase();
    const bodyHash = bodyHashOf(init.body);
    if (bodyHash === null && !po.purchaseKey) {
      return { ok: false, error: "unhashable_body", message: "stream/FormData/Blob bodies need an explicit purchaseKey; nothing was paid", paid: false, maybePaid: false, purchaseKey: "" };
    }
    const purchaseKey = po.purchaseKey ?? purchaseKeyOf(method, url, bodyHash ?? "", o.owner, o.agent, po.intent);
    const ctx: CallContext = { url, method, bodyHash: bodyHash ?? "", purchaseKey, maxPriceBase: po.maxPriceBase };
    const notPaid = (error: string, message: string): X402FetchResult => ({ ok: false, error, message, paid: false, maybePaid: false, purchaseKey });

    // ---- 1. a purchase already exists under the key: resume it, never ask for a new challenge
    const prior = await store.get(purchaseKey);
    if (prior?.header) { ctx.url = prior.url; return present(ctx, prior.header, init, true); }
    const rec = await o.journal.get(purchaseKey);
    if (rec?.state === "reserved") return { ok: false, error: "payment_pending", message: "another call holds this purchase key", paid: false, maybePaid: true, purchaseKey };
    if (rec && UNRESOLVED.has(rec.state) && rec.challenge) {
      if (prior?.url) ctx.url = prior.url;
      const r = await o.client.payChallenge(rec.challenge, { url: ctx.url, method, bodyHash: bodyHash || undefined, purchaseKey, maxPriceBase: po.maxPriceBase });
      const proof = r.ok ? r.proof : r.proof;
      if (!proof) return { ok: false, error: (r as any).error, message: (r as any).message, paid: !!(r as any).paid, maybePaid: !!(r as any).maybePaid || !(r as any).paid, purchaseKey };
      const h = await headerFor(ctx, proof);
      if (!h) return { ok: false, error: "proof_unpresentable", message: "the recorded payment cannot be matched to a requirement", paid: true, maybePaid: false, purchaseKey, proof };
      return present(ctx, h, init, true);
    }

    // ---- 2. fresh purchase through the official x402 fetch wrapper
    const xc = new x402Client();
    xc.register(network, new TurnspikeAllowanceClient(o.client));
    xc.setSpendControls({ allowedAssets: [{ network, asset: o.network.token, ...(o.maxPriceBase !== undefined ? { maxAmountPerPayment: o.maxPriceBase.toString() } : {}) }] });
    xc.onBeforePaymentCreation(async (c) => {
      const ru = (c.paymentRequired as any)?.resource?.url;
      let ro = "";
      try { ro = new URL(String(ru)).origin; } catch { /* invalid */ }
      if (ro !== new URL(ctx.url).origin) return { abort: true, reason: `PaymentRequired.resource.url origin ${ro || "(none)"} is not the fetched origin` };
      await store.put({ key: purchaseKey, url: ctx.url, method, resource: c.paymentRequired.resource, updatedAt: Date.now() });
    });
    xc.onAfterPaymentCreation(async (c) => {
      const prev = await store.get(purchaseKey);
      await store.put({ ...(prev ?? { key: purchaseKey, url: ctx.url, method }), accepted: c.paymentPayload.accepted as any, updatedAt: Date.now() });
    });
    const wrapped = wrapFetchWithPayment((i, n) => transport(ctx, i as any, n), xc);
    let res: Response | null = null;
    let thrown: unknown = null;
    try {
      res = await callContext.run(ctx, () => wrapped(url, init));
    } catch (e) { thrown = e; }

    if (res && !ctx.paymentHeader) return { ok: true, kind: "free", response: res, purchaseKey, resumed: false };
    if (res && res.status >= 200 && res.status < 300 && res.status !== 202) {
      const pr = res.headers.get("payment-response");
      try { await o.client.markDelivered(purchaseKey); } catch { /* note */ }
      let tx: string | undefined;
      try { tx = pr ? (unb64json<any>(pr) as any).transaction : undefined; } catch { /* ignore */ }
      return { ok: true, kind: "paid", response: res, purchaseKey, resumed: false, transaction: tx };
    }
    if (res) await res.body?.cancel().catch(() => {});
    // ---- 3. a payment exists: re-present the same proof (S2/S5)
    if (ctx.paymentHeader) return present(ctx, ctx.paymentHeader, init, false);
    const r = ctx.result as any;
    if (r && !r.ok) {
      if (r.proof) {
        const h = await headerFor(ctx, r.proof);
        if (h) return present(ctx, h, init, true);
      }
      return { ok: false, error: r.error, message: r.message, paid: !!r.paid, maybePaid: !!r.maybePaid, purchaseKey, ...(r.proof ? { proof: r.proof } : {}) };
    }
    if (thrown instanceof X402AgentError) return notPaid(thrown.code, thrown.message);
    if (thrown) return notPaid("payment_not_created", String((thrown as Error)?.message ?? thrown).slice(0, 300));
    return notPaid("unexpected", "no response");
  };
}
