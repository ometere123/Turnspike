import { randomUUID } from "node:crypto";
import { Contract, Interface, Provider, Signer, getAddress, id as keccakId, keccak256 } from "ethers";
import { ALLOWANCE_ABI, Challenge, Network, PROTOCOL, Proof, challengeSchema, encodeProof, formatUnits } from "./protocol";
import { Journal, JournalRecord, JournalState, MemoryJournal, NonceLease, swappable } from "./journal";

const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);

/** A destination the agent is allowed to pay: requests to `origin` may be paid only to `merchant`. */
export interface TrustedPayee { origin: string; merchant: string; maxPriceBase?: bigint }

export interface SpendingPolicy {
  /** Explicit allowlist. A 402 from any other origin, or naming any other merchant, is refused. Required. */
  payees: TrustedPayee[];
  /** Hard ceiling per request, in token base units (QUSDC: 6 decimals, 1000 = 0.001). Required. */
  maxPriceBase: bigint;
  /** Ceiling on the gas cost of one payment, in wei of the native coin. Default 0.002 QIE. */
  maxGasCostWei?: bigint;
  /** Refuse to pay when the agent's native balance would drop below this after gas. Default 0. */
  minGasReserveWei?: bigint;
  /** Refuse challenges that expire sooner than this many seconds from now (not enough time to mine). Default 20. */
  minSecondsToExpiry?: number;
}

/** Everything known about a payment before it is made. Passed to `approve` and returned by dry runs. */
export interface Quote {
  url: string;
  origin: string;
  method: string;
  merchant: string;
  resourceId: string;
  requestId: string;
  priceBase: bigint;
  price: string; // formatted, e.g. "0.001"
  symbol: string;
  chainId: number;
  contract: string;
  token: string;
  expiresAt: number;
  owner: string;
  agent: string;
  ownerBalanceBase: bigint;
  remainingTodayBase: bigint;
  perCallCapBase: bigint;
  gasEstimate: bigint;
  gasPriceWei: bigint;
  gasCostWei: bigint;
  agentGasBalanceWei: bigint;
}

export type ErrorCode =
  | "invalid_challenge" | "unsupported_protocol" | "untrusted_destination" | "wrong_network" | "price_above_max" | "challenge_expired"
  | "not_authorized_agent" | "paused" | "merchant_not_allowed" | "over_per_call_cap" | "over_daily_cap" | "insufficient_balance"
  | "insufficient_gas" | "gas_cost_above_max" | "declined" | "already_paid" | "tx_reverted" | "tx_timeout" | "rpc_unavailable"
  | "gateway_unavailable" | "redeem_rejected" | "redeem_timeout" | "request_failed" | "payment_pending" | "idempotency_conflict";

export interface PaymentInfo { requestId: string; txHash?: string; blockNumber?: number; priceBase: bigint; merchant: string; explorerUrl?: string }

export type PaidFetchResult =
  | { ok: true; kind: "free"; response: Response }
  | { ok: true; kind: "paid"; response: Response; payment: PaymentInfo; replayed: boolean }
  | { ok: true; kind: "dry_run"; quote: Quote }
  /**
   * `paid: true` means QUSDC left the owner's account. A blockchain payment cannot be reversed because a later HTTP step
   * failed; keep the idempotency key and call resume() later to collect the resource.
   */
  /**
   * `maybePaid: true` (with `paid: false`) means the outcome is not known yet: a transaction may have been sent, or another
   * call holds this key and may be paying. Never treat it as "not paid": call resume() with the same key later.
   */
  | { ok: false; error: ErrorCode; message: string; paid: boolean; maybePaid?: boolean; payment?: PaymentInfo; quote?: Quote; detail?: unknown };

export interface ClientOptions {
  /** The authorized AGENT signer (never the owner's key). Any ethers Signer: keystore wallet, KMS, HSM, remote signer. */
  signer: Signer;
  /** Owner whose allowance account funds payments. */
  owner: string;
  network: Network;
  policy: SpendingPolicy;
  /** Called with the quote before any transaction. Return false to decline. Default: approve anything inside the policy. */
  approve?: (q: Quote) => boolean | Promise<boolean>;
  /** Persists payment progress. Default in-memory (no restart safety). */
  journal?: Journal;
  confirmations?: number; // default 2
  txTimeoutMs?: number; // default 120 000
  redeemTimeoutMs?: number; // default 120 000
  /**
   * Expected block interval, used for the payment-deadline margin (S7). Default 3600 ms (QIE). A challenge carrying
   * `paymentDeadline` is paid only when now + one block (mining) + `confirmations` blocks + `deadlineSafetySeconds` is
   * not after the deadline; otherwise the call fails with `challenge_expired` and nothing is sent.
   */
  expectedBlockTimeMs?: number;
  /** Extra seconds of margin before the payment deadline (S7). Default 10. */
  deadlineSafetySeconds?: number;
  /**
   * A key reserved by a call that never recorded a challenge (it crashed before the 402 arrived) may be taken over after
   * this many seconds. Default 300. The takeover is fenced: the original call can no longer record a challenge.
   */
  reservationTimeoutSeconds?: number;
  /** Injected fetch (tests, proxies). Default global fetch. */
  fetch?: typeof fetch;
  /** Structured events for logging. Never receives keys or proof sigs. */
  onEvent?: (e: Record<string, unknown>) => void;
}

export interface FetchOptions {
  /** Inspect the challenge and the quote, run every check, broadcast nothing. */
  dryRun?: boolean;
  /** Stable key for this logical purchase. With a persistent journal it makes the call safe to repeat after a crash. */
  idempotencyKey?: string;
  /** Lower ceiling for this call only. */
  maxPriceBase?: bigint;
}

/** What `payChallenge` needs to know about the request the challenge was issued for. */
export interface PayContext {
  /** The URL that was actually fetched (after any redirect handling). Its origin is checked against the payee allowlist. */
  url: string;
  method: string;
  /**
   * Hash of the request body, if any. Any stable hash works; keccak256 hex of the body bytes makes the purchase record
   * interchangeable with one written by `fetch` for the same request. Part of the purchase fingerprint.
   */
  bodyHash?: string;
  /** Stable key for this logical purchase (S1). One key pays at most one challenge unless its record is `failed`. */
  purchaseKey: string;
  /** Lower ceiling for this payment only. */
  maxPriceBase?: bigint;
}

/**
 * Result of `payChallenge`. `ok: true` carries a proof of a payment confirmed with `confirmations` blocks; present it to
 * the seller, then call `markProofPresented` and, once the resource arrived, `markDelivered`. `resumed: true` means the
 * purchase was already recorded under the key (a retry, a restart or a concurrent call) and no new payment was started
 * by this call unless the recorded one had never been sent.
 * Failures follow the `fetch` rules: `paid: true` means QUSDC moved; `maybePaid: true` means the outcome is unknown and
 * the same key must be retried later, never a new purchase. Only neither flag means nothing was or can be charged.
 * On `idempotency_conflict`, `paid`, `maybePaid` and `proof` describe the purchase that already holds the key.
 */
export type PayChallengeResult =
  | { ok: true; proof: Proof; payment: PaymentInfo; resumed: boolean }
  | { ok: false; error: ErrorCode; message: string; paid: boolean; maybePaid?: boolean; quote?: Quote; proof?: Proof; payment?: PaymentInfo };

/** One record handled by `recoverPending`. `result` is null when the record was deliberately left alone (see `note`). */
export interface RecoveredPurchase {
  key: string;
  /** State before recovery. */
  before: JournalState;
  /** State after recovery, as now stored in the journal. */
  after?: JournalState;
  result: PayChallengeResult | null;
  note?: string;
}

export interface RecoverOptions {
  /**
   * Also pay recorded challenges that were never sent (`challenged`), after re-running every buyer-side check and
   * `approve`. Default false: recovery settles what may already have been paid and starts nothing new.
   */
  payUnsent?: boolean;
}

/**
 * Internal result: a fetch result, or (in proof-only mode) a confirmed payment whose proof the caller will present.
 * The public `fetch` and `resume` never run in proof-only mode, so they never see the `proof` kind.
 */
type Outcome = PaidFetchResult | { ok: true; kind: "proof"; payment: PaymentInfo; proof: Proof };

/**
 * Marks a RequestInit as proof-only: every internal path that would present the proof over HTTP stops after
 * confirmation and returns the proof instead. It rides on `init` because `init` already flows through every path
 * (stale-writer handling, resume, retries), so no path can forget it and fall back to HTTP redemption.
 */
const PROOF_ONLY = Symbol("turnspike.proofOnly");
const proofOnlyInit = (): RequestInit => ({ [PROOF_ONLY]: true }) as RequestInit;
const isProofOnly = (init: RequestInit) => (init as Record<symbol, unknown>)[PROOF_ONLY] === true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const lc = (s: string) => s.toLowerCase();

function decodeRevert(e: any): string | null {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data ?? e?.revert?.data;
  if (e?.revert?.name) return e.revert.name;
  try { const p = iface.parseError(data); return p?.name ?? null; } catch { return null; }
}

/**
 * Errors that prove the node never accepted the transaction. Anything else (timeouts, dropped connections, nonce or
 * replacement complaints) is ambiguous: the transaction may already be in a mempool.
 */
const DEFINITIVE_SEND_ERRORS = new Set(["CALL_EXCEPTION", "INSUFFICIENT_FUNDS", "ACTION_REJECTED", "INVALID_ARGUMENT", "UNSUPPORTED_OPERATION"]);
function definitelyNotSent(e: any, revertName: string | null): boolean {
  return revertName !== null || DEFINITIVE_SEND_ERRORS.has(String(e?.code));
}

/** Fingerprint of one logical request (method, normalized URL, body), so a key cannot be reused for another resource. */
function fingerprint(method: string, url: string, body: unknown): string | null {
  let b: string;
  if (body === undefined || body === null) b = "";
  else if (typeof body === "string") b = keccakId(body);
  else if (body instanceof URLSearchParams) b = keccakId(body.toString());
  else if (body instanceof Uint8Array) b = keccak256(body);
  else if (body instanceof ArrayBuffer) b = keccak256(new Uint8Array(body));
  else return null; // streams, FormData, Blob: cannot be hashed without consuming them
  return fingerprintOf(method, url, b);
}
/** The fingerprint from an already-hashed body ("" for none). Shared by fetch and payChallenge so their keys agree. */
const fingerprintOf = (method: string, url: string, bodyHash: string) => keccakId(`${method.toUpperCase()} ${new URL(url).href} ${bodyHash}`);

function sameRequest(rec: JournalRecord, fp: string, method: string, url: string): boolean {
  if (rec.fingerprint) return rec.fingerprint === fp;
  // Records written by 0.1.0 have no fingerprint and did not record the body. Be conservative: accept only a body-less
  // GET or HEAD for the same URL, the only requests where "no body" is known to match. Anything else is a conflict;
  // resume(key) without a body still collects such a purchase explicitly.
  const m = method.toUpperCase();
  return (m === "GET" || m === "HEAD") && rec.method.toUpperCase() === m && new URL(rec.url).href === new URL(url).href
    && fp === fingerprint(m, url, undefined);
}

/** Serializes writes per journal inside this process when the journal has no atomic swap (0.1.0-style journals). */
const localLocks = new WeakMap<Journal, Promise<unknown>>();
/** Compare-and-set on the record revision (see Journal.swap). */
async function swapRecord(journal: Journal, rec: JournalRecord, expectRev: number | null): Promise<boolean> {
  if (journal.swap) return journal.swap(rec, expectRev);
  const prev = localLocks.get(journal) ?? Promise.resolve();
  const run = prev.then(async () => {
    const ok = swappable(await journal.get(rec.key), expectRev);
    if (ok) await journal.put(rec);
    return ok;
  });
  localLocks.set(journal, run.catch(() => undefined));
  return run;
}

/**
 * True when two records describe the same purchase attempt. Records from this version carry an immutable `attempt`;
 * 0.1.0 records fall back to the challenge requestId. Anything that cannot be proven the same is treated as different.
 */
function samePurchase(a: JournalRecord, b: JournalRecord): boolean {
  if (a.attempt || b.attempt) return !!a.attempt && a.attempt === b.attempt;
  return !!a.challenge && !!b.challenge && lc(a.challenge.requestId) === lc(b.challenge.requestId);
}

/** Progress order. `failed` is not on it: facts learned from the chain (broadcast, confirmed, delivered) override it. */
const RANK: Record<JournalState, number> = { failed: -1, reserved: 0, challenged: 1, paying: 2, broadcast: 3, confirmed: 4, proof_presented: 5, delivered: 6 };

/** True when two challenges are the same payment request (every field that decides who is paid, how much, and for what). */
function sameChallenge(a: Challenge, b: Challenge): boolean {
  return lc(a.requestId) === lc(b.requestId) && lc(a.sig) === lc(b.sig) && a.priceBase === b.priceBase && lc(a.merchant) === lc(b.merchant)
    && lc(a.contract) === lc(b.contract) && lc(a.token) === lc(b.token) && a.chainId === b.chainId && a.resourceId === b.resourceId;
}

const REVERT_CODE: Record<string, ErrorCode> = {
  NotOwnerAgent: "not_authorized_agent", Paused: "paused", MerchantNotAllowed: "merchant_not_allowed", CapExceeded: "over_per_call_cap",
  DailyCapExceeded: "over_daily_cap", InsufficientBalance: "insufficient_balance", RequestAlreadyUsed: "already_paid",
};

/**
 * Buyer-side Turnspike client for autonomous agents.
 *
 * Security defaults: it never pays a 402 unless the request origin AND the merchant in the challenge are on the explicit
 * payee allowlist, the chain, contract and token match the trusted network, and the price is within the policy. It checks
 * the owner's on-chain policy, balance and the agent's gas before broadcasting, so a refusal costs nothing.
 */
export class TurnspikeClient {
  private readonly o: Required<Pick<ClientOptions, "confirmations" | "txTimeoutMs" | "redeemTimeoutMs">> & ClientOptions;
  private readonly provider: Provider;
  private readonly journal: Journal;
  private readonly vault: Contract;
  private readonly http: typeof fetch;

  constructor(opts: ClientOptions) {
    if (!opts.signer.provider) throw new Error("signer must be connected to a provider");
    if (!opts.policy?.payees?.length) throw new Error("policy.payees is required: an agent must never pay arbitrary 402 responses");
    if (opts.policy.maxPriceBase === undefined || opts.policy.maxPriceBase <= 0n) throw new Error("policy.maxPriceBase is required");
    this.o = { confirmations: 2, txTimeoutMs: 120_000, redeemTimeoutMs: 120_000, ...opts };
    this.provider = opts.signer.provider;
    this.journal = opts.journal ?? new MemoryJournal();
    this.vault = new Contract(opts.network.contract, ALLOWANCE_ABI as unknown as string[], opts.signer);
    this.http = opts.fetch ?? fetch;
  }

  private emit(e: Record<string, unknown>) { this.o.onEvent?.(e); }
  private explorer(tx?: string) { return tx ? `${this.o.network.explorer}/tx/${tx}` : undefined; }
  private fail(error: ErrorCode, message: string, extra: Partial<Extract<PaidFetchResult, { ok: false }>> = {}): PaidFetchResult {
    this.emit({ evt: "payment_failed", error, message });
    return { ok: false, error, message, paid: false, ...extra };
  }

  /**
   * Conditional write: succeeds only if nobody has written the record since `rec` was read (same revision). Every
   * decision that is not a chain fact (paying, failed, challenged, takeover, release) is written this way, so a worker
   * holding a stale copy can never overwrite newer progress.
   */
  private async commit(rec: JournalRecord): Promise<boolean> {
    const expect = rec.rev ?? 0;
    const next: JournalRecord = { ...rec, rev: expect + 1, updatedAt: now() };
    if (!(await swapRecord(this.journal, next, expect))) return false;
    rec.rev = next.rev; rec.updatedAt = next.updatedAt;
    return true;
  }

  /**
   * Records a fact observed on chain or from the seller (broadcast, confirmed, delivered). It only ever moves a record
   * forward: if another worker already recorded the same or later progress, that newer record is kept and adopted.
   */
  private async advance(rec: JournalRecord, state: "broadcast" | "confirmed" | "proof_presented" | "delivered", patch: Partial<JournalRecord>): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const cur = await this.journal.get(rec.key);
      // The key now belongs to a newer attempt (this one was closed and the key reused). This attempt's fact must not be
      // written into, or taken from, that record: carry on with this attempt's own in-memory copy and leave the journal.
      if (cur && !samePurchase(cur, rec)) { Object.assign(rec, patch, { state }); this.emit({ evt: "attempt_superseded", key: rec.key, state }); return; }
      if (cur && RANK[cur.state] >= RANK[state]) { Object.assign(rec, cur); return; }
      const base = cur ?? rec;
      const next: JournalRecord = { ...base, ...patch, state, rev: (base.rev ?? 0) + 1, updatedAt: now() };
      if (await swapRecord(this.journal, next, cur ? cur.rev ?? 0 : null)) { Object.assign(rec, next); return; }
    }
    throw new Error(`journal record ${rec.key} is under heavy contention; call resume() with the key`);
  }

  /** Called when a conditional write lost: report what the newer record says instead of acting on a stale copy. */
  private async stale(rec: JournalRecord, init: RequestInit, quote?: Quote): Promise<Outcome> {
    const cur = await this.journal.get(rec.key);
    if (cur && !samePurchase(cur, rec)) {
      // The key was reused by a newer attempt. Never return that attempt's resource or proof for this one. This attempt's
      // own outcome cannot be read from the journal any more, so it is reported conservatively.
      const c = rec.challenge;
      return this.fail("payment_pending", `purchase ${rec.key} was superseded by a newer attempt; this attempt's outcome${rec.txHash ? ` (tx ${rec.txHash})` : ""} must be checked on chain`, {
        maybePaid: true, quote, ...(c ? { payment: { requestId: c.requestId, txHash: rec.txHash, priceBase: BigInt(c.priceBase), merchant: c.merchant, explorerUrl: this.explorer(rec.txHash) } } : {}),
      });
    }
    if (cur && RANK[cur.state] >= RANK.broadcast) return this.resumeRecord(cur, init);
    if (cur?.state === "failed") return this.fail("request_failed", `another worker closed purchase ${rec.key} (${cur.error ?? "failed"}); nothing was paid under it`, { quote });
    return this.fail("payment_pending", `another worker is handling purchase ${rec.key}; call resume() with the key later`, { maybePaid: true, quote });
  }

  /** Fetches a URL; if it answers with a trusted Turnspike 402, pays within policy and returns the paid response. */
  async fetch(url: string, init: RequestInit = {}, fo: FetchOptions = {}): Promise<PaidFetchResult> {
    return asFetchResult(await this.fetchImpl(url, init, fo));
  }

  /**
   * Continues the purchase attempt recorded under the key (after a crash, timeout or gateway outage). It never pays that
   * attempt's challenge twice; a key whose record was marked failed and reused belongs to the newer attempt.
   */
  async resume(idempotencyKey: string, init: RequestInit = {}): Promise<PaidFetchResult> {
    return asFetchResult(await this.resumeImpl(idempotencyKey, init));
  }

  private async fetchImpl(url: string, init: RequestInit, fo: FetchOptions): Promise<Outcome> {
    const method = (init.method ?? "GET").toUpperCase();
    const fp = fingerprint(method, url, init.body);
    if (!fo.idempotencyKey) return this.purchase(url, init, fo, method, fp, null);
    const key = fo.idempotencyKey;
    if (fp === null) return this.fail("idempotency_conflict", "an idempotency key needs a string, URLSearchParams or byte body so the request can be fingerprinted");
    const existing = async (prev: JournalRecord): Promise<Outcome> => {
      if (!sameRequest(prev, fp, method, url)) {
        return this.fail("idempotency_conflict", `idempotency key ${key} already belongs to a different request (${prev.method} ${prev.url}); nothing was paid`);
      }
      return this.resumeRecord(prev, init, fo.maxPriceBase);
    };
    const prev = await this.journal.get(key);
    if (prev && prev.state !== "failed") return existing(prev);
    // A failed record is replaced only at the exact revision read, and revisions keep increasing across replacements,
    // so a stale copy from an earlier attempt can never match the new record.
    // Claim the key atomically BEFORE asking for a challenge. Two concurrent calls with one key would otherwise each get
    // a different requestId, and the contract's replay key cannot stop two different requestIds from both being paid.
    // Only the call that wins this swap may ever record a challenge under the key.
    const reserved: JournalRecord = {
      key, url, method, state: "reserved", owner: getAddress(this.o.owner), agent: await this.o.signer.getAddress(),
      fingerprint: fp, rev: (prev?.rev ?? 0) + 1, attempt: randomUUID(), updatedAt: now(),
    };
    if (!(await swapRecord(this.journal, reserved, prev ? prev.rev ?? 0 : null))) {
      const cur = await this.journal.get(key);
      return cur ? existing(cur) : this.fail("request_failed", "the journal refused the key reservation");
    }
    return this.purchase(url, init, fo, method, fp, reserved);
  }

  /**
   * Requests the resource and, on a trusted 402, pays. With a reservation, the challenge is recorded only if this call
   * still holds the key; every outcome that pays nothing releases the key.
   */
  private async purchase(url: string, init: RequestInit, fo: FetchOptions, method: string, fp: string | null, reserved: JournalRecord | null): Promise<Outcome> {
    const release = async (why: string) => {
      if (reserved) await this.commit({ ...reserved, state: "failed", error: why }); // no-op if the key was taken over
    };
    const r = await this.purchaseInner(url, init, fo, method, fp, reserved);
    if (r.release) await release(r.release);
    return r.result;
  }

  private async purchaseInner(url: string, init: RequestInit, fo: FetchOptions, method: string, fp: string | null, reserved: JournalRecord | null): Promise<{ result: Outcome; release?: string }> {
    const done = (result: Outcome) => ({ result, release: result.ok ? (result.kind === "paid" || result.kind === "proof" ? undefined : result.kind) : (result as any).error as string });
    let res: Response;
    try { res = await this.http(url, init); } catch (e: any) { return done(this.fail("gateway_unavailable", `request failed: ${e?.message ?? e}`)); }
    if (res.status !== 402) return done({ ok: true, kind: "free", response: res });

    const quoteOrErr = await this.quote(url, method, res, fo.maxPriceBase);
    if ("error" in quoteOrErr) return done(quoteOrErr.error);
    const { quote, challenge } = quoteOrErr;
    if (fo.dryRun) return done({ ok: true, kind: "dry_run", quote });
    if (this.o.approve && !(await this.o.approve(quote))) return done(this.fail("declined", "the approve callback declined this payment", { quote }));

    const rec: JournalRecord = {
      key: reserved?.key ?? `${method} ${url} ${challenge.requestId}`, url, method, state: "challenged", challenge,
      owner: quote.owner, agent: quote.agent, updatedAt: now(), ...(fp ? { fingerprint: fp } : {}),
      rev: reserved ? reserved.rev : 0, attempt: reserved?.attempt ?? randomUUID(),
    };
    if (reserved) {
      // Succeeds only against the exact reserved revision this call wrote: a takeover bumps the revision and fences it out.
      if (!(await this.commit(rec))) {
        // The key was taken over (this call was presumed dead). The new holder decides; this call pays nothing.
        return { result: this.fail("payment_pending", "another call took over this idempotency key; this call sent nothing. Call resume() with the key later", { maybePaid: true, quote }) };
      }
    } else {
      rec.rev = 1;
      if (!(await swapRecord(this.journal, rec, null))) return { result: this.fail("request_failed", "the journal already holds this challenge", { quote }) };
    }
    return { result: await this.payAndRedeem(rec, init, quote) };
  }

  private async resumeImpl(idempotencyKey: string, init: RequestInit): Promise<Outcome> {
    const rec = await this.journal.get(idempotencyKey);
    if (!rec) return this.fail("request_failed", "no journal record for that key");
    if (init.body !== undefined && init.body !== null) {
      const fp = fingerprint(rec.method, rec.url, init.body);
      if (fp === null || !sameRequest(rec, fp, rec.method, rec.url)) {
        return this.fail("idempotency_conflict", "the body given to resume() differs from the body of the recorded purchase; nothing was paid");
      }
    }
    return this.resumeRecord(rec, init);
  }

  // ---- protocol-neutral payment API (used by @turnspike-qie/x402) ----

  /**
   * Pays one already-received challenge and returns its proof, without any HTTP: the caller (the x402 layer) presents the
   * proof. It runs every buyer-side check `fetch` runs (payee allowlist on the origin of `ctx.url` and the challenge's
   * merchant, network, contract and token, price ceilings, expiry margin, the owner's on-chain policy, gas, `approve`),
   * records the purchase under `ctx.purchaseKey` with the same revision-fenced journal machinery, pays with a journal
   * nonce lease when the journal offers one, and waits for `confirmations`.
   *
   * One key, one purchase: if the key already holds a purchase that is not `failed`, the same challenge is resumed (its
   * proof is returned once confirmed; an unresolved one returns `maybePaid`), and a different challenge is refused with
   * `idempotency_conflict` and never paid. The key is reusable only after its record is `failed`.
   */
  async payChallenge(challenge: Challenge, ctx: PayContext): Promise<PayChallengeResult> {
    const parsed = challengeSchema.safeParse(challenge);
    if (!parsed.success) return toPayResult(this.fail("invalid_challenge", `not a Turnspike challenge: ${parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}`), false);
    const c = parsed.data;
    if (!ctx || typeof ctx.purchaseKey !== "string" || ctx.purchaseKey.length === 0) return toPayResult(this.fail("request_failed", "payChallenge needs a non-empty purchaseKey; nothing was paid"), false);
    if (typeof ctx.method !== "string" || !ctx.method) return toPayResult(this.fail("request_failed", "payChallenge needs the request method; nothing was paid"), false);
    try { new URL(ctx.url); } catch { return toPayResult(this.fail("request_failed", "payChallenge needs the absolute URL that was fetched; nothing was paid"), false); }
    const method = ctx.method.toUpperCase();
    const fp = fingerprintOf(method, ctx.url, (ctx.bodyHash ?? "").toLowerCase());
    const prev = await this.journal.get(ctx.purchaseKey);
    if (prev && prev.state !== "failed") return this.payExisting(prev, c, ctx, method, fp);
    return this.payNew(prev ?? null, c, ctx, method, fp);
  }

  /**
   * Starts a new purchase attempt for `c` under the key. `prev` is the record that was read: absent, `failed`, or an
   * abandoned reservation being taken over. The challenge is recorded only against exactly that state (no record, or
   * that revision), so of two concurrent callers only one records; the other continues with whatever was recorded.
   */
  private async payNew(prev: JournalRecord | null, c: Challenge, ctx: PayContext, method: string, fp: string): Promise<PayChallengeResult> {
    const q = await this.evaluate(ctx.url, method, c, ctx.maxPriceBase);
    if ("error" in q) return toPayResult(q.error, false);
    if (this.o.approve && !(await this.o.approve(q.quote))) return toPayResult(this.fail("declined", "the approve callback declined this payment", { quote: q.quote }), false);
    const rec: JournalRecord = {
      key: ctx.purchaseKey, url: ctx.url, method, state: "challenged", challenge: c, owner: q.quote.owner, agent: q.quote.agent,
      fingerprint: fp, rev: (prev?.rev ?? 0) + 1, attempt: randomUUID(), updatedAt: now(),
    };
    if (!(await swapRecord(this.journal, rec, prev ? prev.rev ?? 0 : null))) {
      const cur = await this.journal.get(ctx.purchaseKey);
      if (cur && cur.state !== "failed" && cur.state !== "reserved") return this.payExisting(cur, c, ctx, method, fp);
      return toPayResult(this.fail("payment_pending", `purchase ${ctx.purchaseKey} changed while this call recorded its challenge; this call sent nothing. Retry with the key`, { maybePaid: true, quote: q.quote }), false);
    }
    this.emit({ evt: "challenge_recorded", key: rec.key, requestId: c.requestId });
    return toPayResult(await this.payAndRedeem(rec, proofOnlyInit(), q.quote), false);
  }

  /** The key already holds a purchase that is not failed: continue it if it is this challenge, refuse it otherwise. */
  private async payExisting(prev: JournalRecord, c: Challenge, ctx: PayContext, method: string, fp: string): Promise<PayChallengeResult> {
    const conflict = (why: string): PayChallengeResult => {
      // Describe the purchase that holds the key, so the caller can re-present its proof instead of paying again (S2).
      const paid = RANK[prev.state] >= RANK.confirmed;
      this.emit({ evt: "payment_failed", error: "idempotency_conflict", message: why });
      return {
        ok: false, error: "idempotency_conflict", message: `${why}; nothing was paid by this call`, paid,
        ...(paid ? {} : { maybePaid: true }),
        ...(paid && prev.txHash && prev.challenge ? { proof: { requestId: prev.challenge.requestId, txHash: prev.txHash, sig: prev.challenge.sig } } : {}),
      };
    };
    if (!sameRequest(prev, fp, method, ctx.url)) return conflict(`purchase key ${ctx.purchaseKey} already belongs to a different request (${prev.method} ${prev.url})`);
    if (prev.state === "reserved") {
      // A fetch() call claimed the key and has not recorded a challenge, so nothing is paid under it yet. While it may
      // still be running, wait; once abandoned, take it over by recording this challenge against the reserved revision
      // (which also fences the original call out, exactly like a fetch takeover).
      if (now() - prev.updatedAt < (this.o.reservationTimeoutSeconds ?? 300)) {
        return toPayResult(this.fail("payment_pending", `another call is purchasing under key ${prev.key}; retry with the key later`, { maybePaid: true }), true);
      }
      this.emit({ evt: "reservation_taken_over", key: prev.key });
      return this.payNew(prev, c, ctx, method, fp);
    }
    if (!prev.challenge || !sameChallenge(prev.challenge, c)) {
      return conflict(`purchase key ${ctx.purchaseKey} already holds a payment for requestId ${prev.challenge?.requestId ?? "(none)"}, not ${c.requestId}`);
    }
    return toPayResult(await this.resumeRecord(prev, proofOnlyInit(), ctx.maxPriceBase), true);
  }

  /** Records that the proof of the confirmed purchase under the key was presented to the seller. Forward-only. */
  async markProofPresented(purchaseKey: string, requestId?: string): Promise<boolean> { return this.markFact(purchaseKey, "proof_presented", requestId); }

  /** Records that the seller delivered the resource for the confirmed purchase under the key. Forward-only. */
  async markDelivered(purchaseKey: string, requestId?: string): Promise<boolean> { return this.markFact(purchaseKey, "delivered", requestId); }

  /**
   * Returns false, writing nothing, when the key holds no confirmed payment or (with `requestId`) holds a different
   * attempt: a proof cannot have been presented, nor a resource delivered, for a payment that is not confirmed.
   */
  private async markFact(key: string, state: "proof_presented" | "delivered", requestId?: string): Promise<boolean> {
    const rec = await this.journal.get(key);
    if (!rec?.challenge || RANK[rec.state] < RANK.confirmed) return false;
    if (requestId !== undefined && lc(requestId) !== lc(rec.challenge.requestId)) return false;
    await this.advance(rec, state, {});
    this.emit({ evt: state, key, requestId: rec.challenge.requestId });
    return true;
  }

  /**
   * Purchases of this client's owner and agent that are not finished (`failed` and `delivered` are finished). Needs a
   * journal with `list()` (MemoryJournal and FileJournal have one).
   */
  async pendingPurchases(): Promise<JournalRecord[]> {
    if (!this.journal.list) throw new Error("this journal cannot list its records (no list()); pendingPurchases and recoverPending need one");
    const owner = lc(getAddress(this.o.owner)), agent = lc(await this.o.signer.getAddress());
    return (await this.journal.list()).filter((r) => r.state !== "failed" && r.state !== "delivered" && lc(r.owner) === owner && lc(r.agent) === agent);
  }

  /**
   * Startup recovery (S3): settles every unfinished purchase of this client from the chain, one at a time, and returns
   * each one's proof or status. No HTTP: present the returned proofs (x402 layer), or call `resume(key, init)` for
   * purchases made with `fetch`. It confirms broadcast payments, finds payments whose hash was never recorded (isUsed,
   * the recorded nonce, the Paid log), and re-sends only under the existing resume rules (the recorded nonce is reused,
   * so at most one submission can mine). It closes reservations abandoned for `reservationTimeoutSeconds` (nothing can
   * have been paid under them) and expired never-sent challenges, and leaves fresh never-sent challenges alone unless
   * `payUnsent` is set.
   */
  async recoverPending(opts: RecoverOptions = {}): Promise<RecoveredPurchase[]> {
    const out: RecoveredPurchase[] = [];
    // Sequential on purpose: each record may wait for confirmations or re-send at its own nonce, and handling them in
    // order keeps the agent's nonces contiguous.
    for (const rec of await this.pendingPurchases()) {
      const before = rec.state; // read now: resuming updates `rec` in place
      let result: PayChallengeResult | null = null;
      let note: string | undefined;
      try {
        if (rec.state === "reserved") {
          if (now() - rec.updatedAt < (this.o.reservationTimeoutSeconds ?? 300)) note = "reserved by a call that may still be running; left alone";
          else if (await this.commit({ ...rec, state: "failed", error: "abandoned_reservation" })) note = "abandoned reservation closed; nothing was paid under it";
          else note = "the reservation changed during recovery; left alone";
        } else if (rec.state === "challenged" && this.fresh(rec.challenge!) && !opts.payUnsent) {
          note = "challenge recorded but never sent; left alone (payUnsent pays it)";
        } else {
          result = toPayResult(await this.resumeRecord(rec, proofOnlyInit()), true);
        }
      } catch (e: any) {
        // One unreadable record must not stop recovery of the others. Its outcome is unknown, so it is not "not paid".
        result = { ok: false, error: "request_failed", message: `recovery of ${rec.key} failed: ${e?.message ?? e}; retry later`, paid: false, maybePaid: true };
      }
      out.push({ key: rec.key, before, after: (await this.journal.get(rec.key))?.state, result, ...(note ? { note } : {}) });
    }
    return out;
  }

  /** True when the challenge still leaves enough time to mine a payment before it expires. */
  private fresh(c: Challenge): boolean {
    if (c.expiresAt - now() < (this.o.policy.minSecondsToExpiry ?? 20)) return false;
    return this.deadlineReachable(c);
  }

  /**
   * S7: the payment must be mined by the challenge's paymentDeadline (seller time). Refuse when the expected mining time,
   * the confirmations and a safety margin do not fit before it. Challenges without a deadline (older gateways) pass.
   */
  private deadlineReachable(c: Challenge): boolean {
    if (c.paymentDeadline === undefined) return true;
    const blockMs = this.o.expectedBlockTimeMs ?? 3600;
    const needMs = blockMs + this.o.confirmations * blockMs + (this.o.deadlineSafetySeconds ?? 10) * 1000;
    return Date.now() + needMs <= c.paymentDeadline * 1000;
  }

  private async quote(url: string, method: string, res: Response, maxOverride?: bigint): Promise<{ quote: Quote; challenge: Challenge } | { error: PaidFetchResult }> {
    const p = this.o.policy, n = this.o.network;
    let raw: unknown;
    try { raw = await res.json(); } catch { return { error: this.fail("invalid_challenge", "402 body is not JSON") }; }
    const parsed = challengeSchema.safeParse(raw);
    if (!parsed.success) return { error: this.fail("invalid_challenge", "402 body is not a Turnspike challenge", { detail: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message) }) };
    return this.evaluate(url, method, parsed.data, maxOverride);
  }

  /**
   * Every buyer-side check on a challenge: payee allowlist, network, price ceilings, expiry, and the owner's current on-chain
   * policy, balance and the agent's gas. Runs for new challenges and again before paying a challenge taken from the journal.
   */
  private async evaluate(url: string, method: string, c: Challenge, maxOverride?: bigint): Promise<{ quote: Quote; challenge: Challenge } | { error: PaidFetchResult }> {
    const p = this.o.policy, n = this.o.network;
    if (c.protocol && c.protocol !== PROTOCOL) return { error: this.fail("unsupported_protocol", `challenge protocol ${c.protocol} is not ${PROTOCOL}`) };

    const origin = new URL(url).origin;
    const payee = p.payees.find((t) => new URL(t.origin).origin === origin && lc(t.merchant) === lc(c.merchant));
    if (!payee) return { error: this.fail("untrusted_destination", `refusing to pay ${c.merchant} for ${origin}: not on the payee allowlist`) };
    if (c.chainId !== n.chainId || lc(c.contract) !== lc(n.contract) || lc(c.token) !== lc(n.token)) {
      return { error: this.fail("wrong_network", `challenge names chain ${c.chainId}, contract ${c.contract}, token ${c.token}; trusted is chain ${n.chainId}, ${n.contract}, ${n.token}`) };
    }
    const price = BigInt(c.priceBase);
    const ceiling = [p.maxPriceBase, payee.maxPriceBase, maxOverride].filter((x): x is bigint => x !== undefined).reduce((a, b) => (b < a ? b : a));
    if (price > ceiling) return { error: this.fail("price_above_max", `price ${formatUnits(price, n.decimals)} exceeds the maximum ${formatUnits(ceiling, n.decimals)}`) };
    if (price === 0n) return { error: this.fail("invalid_challenge", "zero price") };
    if (!this.fresh(c)) return { error: this.fail("challenge_expired", "challenge expires too soon to pay safely") };

    try {
      const net = await this.provider.getNetwork();
      if (net.chainId !== BigInt(n.chainId)) return { error: this.fail("wrong_network", `provider is on chain ${net.chainId}, expected ${n.chainId}`) };
      const owner = getAddress(this.o.owner);
      const agent = await this.o.signer.getAddress();
      const [acct, spent, allowed, used, gasBal, fee] = await Promise.all([
        this.vault.account(owner), this.vault.spentToday(owner), this.vault.allowedMerchant(owner, c.merchant), this.vault.isUsed(c.merchant, c.requestId),
        this.provider.getBalance(agent), this.provider.getFeeData(),
      ]);
      const base = { url, origin, method, merchant: getAddress(c.merchant), resourceId: c.resourceId, requestId: c.requestId, priceBase: price, price: formatUnits(price, n.decimals), symbol: "QUSDC", chainId: c.chainId, contract: c.contract, token: c.token, expiresAt: c.expiresAt, owner, agent };
      const remaining = (acct.dailyCap as bigint) > (spent as bigint) ? (acct.dailyCap as bigint) - (spent as bigint) : 0n;
      const partial = { ...base, ownerBalanceBase: acct.balance as bigint, remainingTodayBase: remaining, perCallCapBase: acct.perCallCap as bigint, agentGasBalanceWei: gasBal };
      if (lc(acct.agent) !== lc(agent)) return { error: this.fail("not_authorized_agent", `the owner's authorized agent is ${acct.agent}, this signer is ${agent}`) };
      if (acct.paused) return { error: this.fail("paused", "the owner has paused payments") };
      if (!allowed) return { error: this.fail("merchant_not_allowed", `merchant ${c.merchant} is not on the owner's on-chain allowlist`) };
      if (used) return { error: this.fail("already_paid", "this requestId is already paid on chain") };
      if (price > (acct.perCallCap as bigint)) return { error: this.fail("over_per_call_cap", `price exceeds the owner's per-call cap ${formatUnits(acct.perCallCap, n.decimals)}`) };
      if (price > remaining) return { error: this.fail("over_daily_cap", `price exceeds what is left of today's cap (${formatUnits(remaining, n.decimals)})`) };
      if (price > (acct.balance as bigint)) return { error: this.fail("insufficient_balance", `owner balance ${formatUnits(acct.balance, n.decimals)} is below the price`) };
      const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
      let gasEstimate: bigint;
      try { gasEstimate = await this.vault.pay.estimateGas(owner, c.merchant, c.requestId, price); } catch (e) {
        const name = decodeRevert(e);
        return { error: this.fail(name && REVERT_CODE[name] ? REVERT_CODE[name] : "tx_reverted", `the payment would revert${name ? `: ${name}` : ""}`) };
      }
      const gasCost = gasEstimate * gasPrice;
      const quote: Quote = { ...partial, gasEstimate, gasPriceWei: gasPrice, gasCostWei: gasCost };
      if (gasCost > (p.maxGasCostWei ?? 2_000_000_000_000_000n)) return { error: this.fail("gas_cost_above_max", `gas cost ${gasCost} wei exceeds the maximum`, { quote }) };
      if (gasBal < gasCost + (p.minGasReserveWei ?? 0n)) return { error: this.fail("insufficient_gas", `agent has ${gasBal} wei, needs ${gasCost} for gas plus the reserve`, { quote }) };
      return { quote, challenge: c };
    } catch (e: any) {
      return { error: this.fail("rpc_unavailable", `chain read failed: ${e?.shortMessage ?? e?.message ?? e}`) };
    }
  }

  /**
   * Sends the payment for `rec` and redeems it. `prior` is true when an earlier submission for this record may still be
   * waiting in a mempool: then the new transaction must reuse that nonce (so at most one of the two can ever mine) and no
   * refusal may mark the record failed, because the earlier one could still charge.
   */
  private async payAndRedeem(rec: JournalRecord, init: RequestInit, quote: Quote, prior = false): Promise<Outcome> {
    const c = rec.challenge!;
    const unresolved = (why: string): PaidFetchResult => this.fail("payment_pending", `${why}; an earlier submission may still be pending. Call resume() with key ${rec.key} later`, { maybePaid: true, quote });
    // The journal's nonce lease, when the journal coordinates nonces (S6). What the allocator is told on release decides
    // whether the nonce can be handed out again: only when nothing can have been broadcast with it. For a resend, an
    // earlier submission may sit in a mempool at this nonce, so it is released as "sent" unless proven otherwise.
    let lease: NonceLease | null = null;
    let leaseSent = prior;
    const settleLease = async (sent: boolean) => {
      if (!lease) return;
      const l = lease; lease = null;
      try { await l.release({ sent }); } catch (e: any) {
        // Not fatal: the reservation ends when the chain passes the nonce, its holder exits, or its TTL ends.
        this.emit({ evt: "nonce_release_failed", key: rec.key, nonce: l.nonce, message: String(e?.message ?? e) });
      }
    };
    try {
      try {
        // Record the nonce and head BEFORE broadcasting, so a crash after broadcast can be recovered without paying again.
        const next = await this.provider.getTransactionCount(rec.agent, "pending");
        if (prior && next !== rec.nonce) return unresolved(`the agent's next nonce is ${next}, not the recorded ${rec.nonce}`);
        if (this.journal.allocateNonce) {
          // A resend claims its recorded nonce so no other worker is handed it meanwhile; a new payment takes the lowest
          // nonce no other process holds, instead of the chain's pending count, which every process would read alike.
          lease = await this.journal.allocateNonce(rec.agent, next, prior ? { nonce: rec.nonce } : undefined);
          rec.nonce = lease.nonce;
        } else {
          rec.nonce = next;
        }
        rec.fromBlock = await this.provider.getBlockNumber();
        rec.state = "paying";
      } catch (e: any) {
        return this.fail("rpc_unavailable", `could not prepare the payment: ${e?.shortMessage ?? e?.message ?? e}`, { quote, ...(prior ? { maybePaid: true } : {}) });
      }
      // Only one worker can move this revision to "paying": a concurrent fetch or resume holding the same copy loses here
      // and sends nothing.
      if (!(await this.commit(rec))) return this.stale(rec, init, quote);
      // The approve callback and the chain reads take time. Check expiry again immediately before sending, so a slow approval
      // can never pay a challenge the seller will refuse. Nothing has been sent yet, so this refusal is final.
      if (!this.fresh(c)) {
        if (prior) return unresolved("the challenge expired before a new payment could be sent");
        rec.state = "failed"; rec.error = "expired_before_payment";
        if (!(await this.commit(rec))) return this.stale(rec, init, quote);
        return this.fail("challenge_expired", "the challenge expired before the payment could be sent; nothing was paid", { quote });
      }
      let txHash: string;
      try {
        const tx = await this.vault.pay(rec.owner, c.merchant, c.requestId, BigInt(c.priceBase), { nonce: rec.nonce, gasLimit: (quote.gasEstimate * 12n) / 10n });
        txHash = tx.hash;
      } catch (e: any) {
        const name = decodeRevert(e);
        const why = name ?? String(e?.shortMessage ?? e?.message ?? e);
        if (definitelyNotSent(e, name) && !prior) {
          // The node refused it (revert, no funds, signer refused): nothing entered the chain at this nonce.
          // Written only if no other worker has progressed this record since; otherwise its newer state wins (for example a
          // competing payment of the same requestId that succeeded).
          await settleLease(false);
          rec.state = "failed"; rec.error = why;
          if (!(await this.commit(rec))) return this.stale(rec, init, quote);
          return this.fail(name && REVERT_CODE[name] ? REVERT_CODE[name] : "tx_reverted", `pay was refused: ${why}`, { quote });
        }
        // Timeout or connection loss during submission: the transaction may have been accepted. Keep the record in "paying",
        // so no new challenge can be paid under this key; resume() settles it from the nonce and the contract's Paid events.
        await settleLease(true);
        rec.error = `submission outcome unknown: ${why}`;
        await this.commit(rec); // a note only; the record stays "paying" whoever wins
        this.emit({ evt: "payment_uncertain", requestId: c.requestId, key: rec.key });
        return {
          ok: false, error: "payment_pending", paid: false, maybePaid: true, quote,
          message: `the payment may have been sent (${why}); call resume() with key ${rec.key} to settle it, and do not start a new purchase for this request`,
          payment: { requestId: c.requestId, priceBase: BigInt(c.priceBase), merchant: c.merchant },
        };
      }
      leaseSent = true;
      await settleLease(true); // in a mempool now: blocked for others until the chain's pending nonce passes it
      // Broadcast succeeded. If recording the hash fails, let it throw: the record stays "paying" and resume() recovers
      // the payment from the chain. Marking it failed here would invite a second payment.
      await this.advance(rec, "broadcast", { txHash, nonce: rec.nonce, fromBlock: rec.fromBlock });
      this.emit({ evt: "payment_broadcast", requestId: c.requestId, txHash });
      return this.confirmAndRedeem(rec, init);
    } finally {
      // Every path that returned before sending (lost the paying CAS, expired, preparation failed) sent nothing new.
      await settleLease(leaseSent);
    }
  }

  private async confirmAndRedeem(rec: JournalRecord, init: RequestInit): Promise<Outcome> {
    const c = rec.challenge!;
    const info = (): PaymentInfo => ({ requestId: c.requestId, txHash: rec.txHash, blockNumber: rec.blockNumber, priceBase: BigInt(c.priceBase), merchant: c.merchant, explorerUrl: this.explorer(rec.txHash) });
    if (rec.state === "broadcast") {
      let receipt;
      try { receipt = await this.provider.waitForTransaction(rec.txHash!, this.o.confirmations, this.o.txTimeoutMs); } catch (e: any) {
        if (String(e?.code) === "TIMEOUT") return { ok: false, error: "tx_timeout", message: "payment not confirmed in time; call resume() later", paid: false, maybePaid: true, payment: info() };
        if (e?.receipt?.status === 0) receipt = e.receipt; else return { ok: false, error: "rpc_unavailable", message: `${e?.shortMessage ?? e?.message ?? e}; the payment was sent, call resume() later`, paid: false, maybePaid: true, payment: info() };
      }
      if (!receipt) return { ok: false, error: "tx_timeout", message: "payment not confirmed in time; call resume() later", paid: false, maybePaid: true, payment: info() };
      if (receipt.status !== 1) {
        // A revert can mean a competing transaction for the same requestId already paid it. Check before closing.
        try {
          if (await this.vault.isUsed(c.merchant, c.requestId)) {
            const paidTx = await this.findPaidTx(rec);
            if (!paidTx) return { ok: false, error: "payment_pending", message: "requestId is paid on chain but the transaction was not found yet; retry resume()", paid: true, payment: info() };
            // This attempt's requestId is paid by paidTx. Record it if this copy is current; otherwise continue with the
            // in-memory copy (advance() keeps it away from any other attempt's record).
            rec.txHash = paidTx;
            await this.commit(rec);
            return this.confirmAndRedeem(rec, init);
          }
        } catch (e: any) {
          return { ok: false, error: "rpc_unavailable", message: `${e?.shortMessage ?? e?.message ?? e}; call resume() later`, paid: false, maybePaid: true, payment: info() };
        }
        rec.state = "failed"; rec.error = "reverted";
        if (!(await this.commit(rec))) return this.stale(rec, init);
        return { ok: false, error: "tx_reverted", message: "the pay transaction reverted on chain (gas was spent, no QUSDC moved)", paid: false, payment: info() };
      }
      await this.advance(rec, "confirmed", { blockNumber: receipt.blockNumber });
      this.emit({ evt: "payment_confirmed", requestId: c.requestId, txHash: rec.txHash, blockNumber: receipt.blockNumber });
    }
    return this.redeem(rec, init, info);
  }

  private async redeem(rec: JournalRecord, init: RequestInit, info: () => PaymentInfo): Promise<Outcome> {
    // Proof-only (payChallenge, recoverPending): the payment is confirmed; the caller presents the proof itself.
    if (isProofOnly(init)) return { ok: true, kind: "proof", payment: info(), proof: { requestId: rec.challenge!.requestId, txHash: rec.txHash!, sig: rec.challenge!.sig } };
    const header = encodeProof({ requestId: rec.challenge!.requestId, txHash: rec.txHash!, sig: rec.challenge!.sig });
    const deadline = Date.now() + this.o.redeemTimeoutMs;
    let delay = 1000;
    let last = "";
    while (Date.now() < deadline) {
      let res: Response;
      try {
        res = await this.http(rec.url, { ...init, method: rec.method, headers: { ...(init.headers as Record<string, string> | undefined), "x-payment": header } });
      } catch (e: any) {
        last = `gateway unreachable: ${e?.message ?? e}`;
        await sleep(delay); delay = Math.min(delay * 2, 15_000); continue;
      }
      if (res.status >= 200 && res.status < 300 && res.status !== 202) {
        await this.advance(rec, "delivered", {});
        this.emit({ evt: "delivered", requestId: rec.challenge!.requestId, status: res.status });
        return { ok: true, kind: "paid", response: res, payment: info(), replayed: res.headers.get("x-turnspike-replay") === "1" };
      }
      if (res.status === 202 || res.status === 503 || res.status === 429 || res.status >= 500) {
        const body: any = await res.json().catch(() => ({}));
        last = `${res.status} ${body.why ?? body.error ?? ""}`.trim();
        const hinted = Number(body.retryAfter ?? res.headers.get("retry-after") ?? 0) * 1000;
        await sleep(Math.max(hinted, delay)); delay = Math.min(delay * 2, 15_000); continue;
      }
      const body: any = await res.json().catch(() => ({}));
      return { ok: false, error: "redeem_rejected", message: `the gateway refused the proof: ${res.status} ${body.reason ?? body.error ?? ""}`.trim(), paid: true, payment: info(), detail: body };
    }
    return { ok: false, error: last.startsWith("gateway unreachable") ? "gateway_unavailable" : "redeem_timeout", message: `paid but not yet delivered (${last}); call resume() with the same key`, paid: true, payment: info() };
  }

  /** Pays a journal challenge that was never sent, after re-running every buyer-side check and the approve callback. */
  private async payRecorded(rec: JournalRecord, init: RequestInit, maxOverride?: bigint, prior = false): Promise<Outcome> {
    const q = await this.evaluate(rec.url, rec.method, rec.challenge!, maxOverride);
    if ("error" in q) return q.error;
    if (lc(q.quote.agent) !== lc(rec.agent) || lc(q.quote.owner) !== lc(rec.owner)) {
      return this.fail("not_authorized_agent", "the signer or owner differs from the recorded purchase", { quote: q.quote });
    }
    if (this.o.approve && !(await this.o.approve(q.quote))) return this.fail("declined", "the approve callback declined this payment", { quote: q.quote });
    return this.payAndRedeem(rec, init, q.quote, prior);
  }

  private async resumeRecord(rec: JournalRecord, init: RequestInit, maxOverride?: bigint): Promise<Outcome> {
    if (rec.state === "reserved" && isProofOnly(init)) {
      // Taking over a reservation means fetching a challenge over HTTP, which proof-only callers never do.
      return this.fail("payment_pending", `another call is purchasing under key ${rec.key}; retry with the key later`, { maybePaid: true });
    }
    if (rec.state === "reserved") {
      // Another call claimed this key and has not recorded a challenge yet, so nothing has been paid under it so far, but
      // that call may still pay. After the timeout it is presumed dead and the key is taken over; the swap fences it out.
      const age = now() - rec.updatedAt;
      if (age < (this.o.reservationTimeoutSeconds ?? 300)) {
        return this.fail("payment_pending", `another call is purchasing under key ${rec.key}; call resume() with the key later`, { maybePaid: true });
      }
      // Conditional on the exact reserved revision that was read: if the original holder recorded its challenge in the
      // meantime (which bumps the revision), the takeover fails and the original purchase stands.
      const taken: JournalRecord = { ...rec, attempt: randomUUID() }; // a new attempt: the abandoned one never had a challenge
      if (!(await this.commit(taken))) {
        return this.fail("payment_pending", `key ${rec.key} changed hands during takeover; call resume() with the key later`, { maybePaid: true });
      }
      this.emit({ evt: "reservation_taken_over", key: rec.key });
      return this.purchase(rec.url, { ...init, method: rec.method }, { maxPriceBase: maxOverride }, rec.method, rec.fingerprint ?? null, taken);
    }
    const c = rec.challenge!;
    const info = (): PaymentInfo => ({ requestId: c.requestId, txHash: rec.txHash, blockNumber: rec.blockNumber, priceBase: BigInt(c.priceBase), merchant: c.merchant, explorerUrl: this.explorer(rec.txHash) });
    this.emit({ evt: "resume", key: rec.key, state: rec.state });
    if (rec.state === "delivered" || rec.state === "proof_presented" || rec.state === "confirmed") return this.redeem(rec, init, info);
    if (rec.state === "broadcast") return this.confirmAndRedeem(rec, init);
    if (rec.state === "challenged") {
      // Nothing was broadcast. Do not pay a challenge that is about to expire or has expired: the seller would reject a payment
      // mined after the deadline and the money would be spent for nothing.
      if (!this.fresh(c)) {
        rec.state = "failed"; rec.error = "expired_before_payment";
        if (!(await this.commit(rec))) return this.stale(rec, init);
        return this.fail("challenge_expired", "the challenge expired before a payment was made; nothing was paid");
      }
      // Nothing was ever sent for this record, so a refusal by today's policy is final for it.
      const r = await this.payRecorded(rec, init, maxOverride);
      if (!r.ok && !r.paid && !r.maybePaid && rec.state === "challenged" && r.error !== "rpc_unavailable") {
        rec.state = "failed"; rec.error = r.error;
        if (!(await this.commit(rec))) return this.stale(rec, init);
      }
      return r;
    }
    if (rec.state === "paying") {
      // A crash happened between recording the nonce and recording the transaction hash. Find out what happened on chain.
      try {
        const used: boolean = await this.vault.isUsed(c.merchant, c.requestId);
        if (used) {
          const tx = await this.findPaidTx(rec);
          if (!tx) return { ok: false, error: "payment_pending", message: "requestId is paid on chain but the transaction was not found yet; retry resume()", paid: true, payment: info() };
          await this.advance(rec, "broadcast", { txHash: tx });
          return this.confirmAndRedeem(rec, init);
        }
        const mined = await this.provider.getTransactionCount(rec.agent, "latest");
        const pending = await this.provider.getTransactionCount(rec.agent, "pending");
        if (rec.nonce !== undefined && pending > rec.nonce && mined <= rec.nonce) {
          return { ok: false, error: "payment_pending", message: "a transaction from the recorded nonce is still pending; retry resume() later", paid: false, maybePaid: true, payment: info() };
        }
        // The pay may have mined between the first isUsed read and the nonce reads. Read it again before deciding.
        if (await this.vault.isUsed(c.merchant, c.requestId)) return this.resumeRecord(rec, init, maxOverride);
        // If the recorded nonce was consumed by a transaction that did not pay this request (a revert, another transaction),
        // this record can never be charged now, and only then is a refusal final. Otherwise a submission might still be
        // waiting in some mempool, so the record stays "paying".
        const nonceSpent = rec.nonce !== undefined && mined > rec.nonce;
        if (!this.fresh(c)) {
          if (nonceSpent) {
            rec.state = "failed"; rec.error = "expired_before_payment";
            if (!(await this.commit(rec))) return this.stale(rec, init);
            return this.fail("challenge_expired", "the challenge expired before a payment was made; nothing was paid");
          }
          // Expired, but a submission at the recorded nonce could still mine and charge. This is not "not paid": it stays
          // unresolved until that nonce is consumed (by this payment or by any later transaction from the agent).
          return this.fail("payment_pending", `the challenge has expired but an earlier submission at nonce ${rec.nonce} is unresolved; call resume() with key ${rec.key} later`, { maybePaid: true, payment: info() });
        }
        // Still unpaid and in time: re-run every buyer-side check before sending. A hidden earlier submission shares the
        // recorded nonce with the new one (see payAndRedeem), so at most one of them can mine.
        const r = await this.payRecorded(rec, init, maxOverride, !nonceSpent);
        if (!r.ok && !r.paid && !nonceSpent) return { ...r, maybePaid: true };
        if (!r.ok && !r.paid && !r.maybePaid && nonceSpent && rec.state === "paying" && r.error !== "rpc_unavailable" && r.error !== "payment_pending") {
          rec.state = "failed"; rec.error = r.error;
          if (!(await this.commit(rec))) return this.stale(rec, init);
        }
        return r;
      } catch (e: any) {
        return this.fail("rpc_unavailable", `chain read failed while settling an earlier submission: ${e?.shortMessage ?? e?.message ?? e}`, { maybePaid: true });
      }
    }
    return this.fail("request_failed", `journal record is in state ${rec.state}`);
  }

  private async findPaidTx(rec: JournalRecord): Promise<string | null> {
    const ev = iface.getEvent("Paid")!;
    const pad = (a: string) => "0x" + lc(a).replace(/^0x/, "").padStart(64, "0");
    const logs = await this.provider.getLogs({ address: this.o.network.contract, topics: [ev.topicHash, pad(rec.owner), pad(rec.agent), pad(rec.challenge!.merchant)], fromBlock: rec.fromBlock ?? 0, toBlock: "latest" });
    for (const l of logs) {
      const p = iface.parseLog({ topics: [...l.topics], data: l.data });
      if (p && lc(String(p.args.requestId)) === lc(rec.challenge!.requestId)) return l.transactionHash;
    }
    return null;
  }
}

/** Maps an internal outcome to the payChallenge result. */
function toPayResult(o: Outcome, resumed: boolean): PayChallengeResult {
  if (o.ok && o.kind === "proof") return { ok: true, proof: o.proof, payment: o.payment, resumed };
  // Proof-only paths never redeem over HTTP, so no other success kind can arrive here; never report one as "not paid".
  if (o.ok) return { ok: false, error: "request_failed", message: `internal error: unexpected ${o.kind} outcome`, paid: false, maybePaid: true };
  return { ok: false, error: o.error, message: o.message, paid: o.paid, ...(o.maybePaid ? { maybePaid: true } : {}), ...(o.quote ? { quote: o.quote } : {}), ...(o.payment ? { payment: o.payment } : {}) };
}

/** Narrows an internal outcome for fetch/resume, which never run in proof-only mode. */
function asFetchResult(o: Outcome): PaidFetchResult {
  if (o.ok && o.kind === "proof") throw new Error("internal error: proof-only outcome on the fetch path");
  return o;
}

/** Stable idempotency key helper for a logical purchase (method, URL and an optional body). */
export const idempotencyKey = (method: string, url: string, body?: string) => keccakId(`${method.toUpperCase()} ${url} ${body ?? ""}`);
