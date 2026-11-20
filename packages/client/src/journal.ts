import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Challenge } from "./protocol";

/**
 * `reserved`: an idempotency key is claimed by one call, no challenge yet, nothing can have been paid.
 * `challenged`: a challenge is recorded under the key; from here on, every path pays only this challenge's requestId.
 * `proof_presented`: the payment is confirmed and its proof was handed to the seller at least once (x402 flow); delivery
 * of the resource is not confirmed yet. Like `broadcast`, `confirmed` and `delivered` it is a fact and only ever moves a
 * record forward.
 */
export type JournalState = "reserved" | "challenged" | "paying" | "broadcast" | "confirmed" | "proof_presented" | "delivered" | "failed";

/**
 * What the client remembers about one purchase attempt so a restart never pays that attempt twice. Contains no private keys and no
 * response bodies. It does contain the challenge `sig`, which is the secret half of the payment proof: store it like a
 * session token (file permissions, encrypted volume, or your own secret store via a custom Journal).
 */
export interface JournalRecord {
  key: string;
  url: string;
  method: string;
  state: JournalState;
  /** Absent only in state `reserved`. */
  challenge?: Challenge;
  owner: string;
  agent: string;
  nonce?: number; // agent account nonce used for the pay transaction
  fromBlock?: number; // chain head before broadcast, for log lookup on recovery
  txHash?: string;
  blockNumber?: number;
  error?: string;
  /** Hash of method, URL and body. An idempotency key may only be reused for the same request. Absent in 0.1.0 records. */
  fingerprint?: string;
  /**
   * Revision, incremented by every write through `swap`. A write succeeds only against the exact revision the writer
   * read, so a worker holding a stale copy can never overwrite a newer state. Absent (treated as 0) in 0.1.0 records.
   */
  rev?: number;
  /**
   * Identity of one purchase attempt under this key, set when the attempt starts and never changed. A failed key can be
   * reused by a new attempt with a different requestId; this tells their facts apart. Absent in 0.1.0 records, where the
   * challenge requestId identifies the attempt instead.
   */
  attempt?: string;
  /** @deprecated unused since the revision check; kept so older records still parse. */
  lockToken?: string;
  updatedAt: number;
}

export interface Journal {
  get(key: string): Promise<JournalRecord | undefined>;
  /** Unconditional write. The client uses it only when the journal has no `swap`, inside an in-process lock. */
  put(rec: JournalRecord): Promise<void>;
  /**
   * Atomic compare-and-set on the record revision. With `expectRev` null, writes only if no record exists for the key
   * or the stored one is `failed`. Otherwise writes only if the stored record's `rev` (0 when absent) equals `expectRev`.
   * The caller passes `rec.rev = expectRev + 1`. Returns whether it wrote. Optional for compatibility with 0.1.0
   * journals; without it the client serializes writes inside one process only (see the README).
   */
  swap?(rec: JournalRecord, expectRev: number | null): Promise<boolean>;
  /** Every purchase record, for startup recovery (`TurnspikeClient.pendingPurchases` / `recoverPending`). Optional. */
  list?(): Promise<JournalRecord[]>;
  /**
   * Durable per-agent nonce allocation, so several processes sharing one agent key never pick the same nonce (S6).
   * Atomic with respect to every other journal operation. Returns the lowest nonce that is at least `chainPendingNonce`,
   * below the journal's next nonce and not reserved or recently sent by anyone (a gap left by a released reservation);
   * otherwise `max(chainPendingNonce, next)`. With `opts.nonce` it reserves exactly that nonce instead (a resend of an
   * earlier submission at its recorded nonce), taking it over from any other holder.
   * Optional: without it the client uses the chain's pending nonce directly, which is safe within one process only.
   */
  allocateNonce?(agent: string, chainPendingNonce: number, opts?: AllocateNonceOptions): Promise<NonceLease>;
}

export interface AllocateNonceOptions {
  /** Reserve exactly this nonce (re-sending an earlier submission). Any other holder's lease on it is superseded. */
  nonce?: number;
}

/** One reserved nonce. Call `release` once, as soon as the outcome of the send is known. */
export interface NonceLease {
  nonce: number;
  /**
   * `sent: true` (the default, and the conservative choice): a transaction with this nonce may have reached a node, so the
   * nonce stays blocked until the chain's pending nonce passes it (or the lease TTL ends). `sent: false`: nothing was
   * broadcast with it, so it is handed out again; otherwise every later transaction of the agent would wait behind the
   * gap. Releasing a lease that was superseded or reclaimed is a no-op.
   */
  release(opts?: { sent?: boolean }): Promise<void>;
}

/** Bookkeeping for one reserved nonce. `held`: allocated, send outcome not known yet. `sent`: may be in a mempool. */
export interface NonceEntry { nonce: number; status: "held" | "sent"; token: string; host: string; pid: number; at: number }
/** Per-agent nonce state, stored beside the purchase records (never inside them). */
export interface AgentNonceState { next: number; entries: NonceEntry[] }

/** Default lifetime of a nonce reservation before it is reclaimed even from a live holder (10 minutes). */
export const DEFAULT_NONCE_LEASE_TTL_MS = 10 * 60_000;

/**
 * The allocation rule shared by the built-in journals. Pure: no I/O; the caller holds whatever lock makes it atomic.
 * 1. Entries below `chainPending` are forgotten: the chain has consumed those nonces or holds them in its mempool.
 * 2. `held` entries whose holder process is gone, and any entry older than the TTL, are reclaimed. A `sent` entry is not
 *    reclaimed just because its process died: its transaction may still be waiting in a mempool.
 * 3. The lowest free nonce in [chainPending, next) is reused first: it is a gap that would otherwise stall every later
 *    transaction of the agent. Only then is `max(chainPending, next)` handed out.
 */
export function allocateNonceIn(
  st: AgentNonceState | undefined, chainPending: number, holder: { token: string; host: string; pid: number }, nowMs: number,
  ttlMs: number, holderGone: (e: NonceEntry) => boolean, opts: AllocateNonceOptions = {},
): { state: AgentNonceState; nonce: number } {
  if (!Number.isSafeInteger(chainPending) || chainPending < 0) throw new Error(`invalid chain pending nonce ${chainPending}`);
  const prev = st ?? { next: chainPending, entries: [] };
  let entries = prev.entries.filter((e) => e.nonce >= chainPending && nowMs - e.at <= ttlMs && !(e.status === "held" && holderGone(e)));
  let nonce: number;
  if (opts.nonce !== undefined) {
    if (!Number.isSafeInteger(opts.nonce) || opts.nonce < 0) throw new Error(`invalid nonce ${opts.nonce}`);
    nonce = opts.nonce;
    entries = entries.filter((e) => e.nonce !== nonce); // the resend owns it now; the previous holder's release is a no-op
  } else {
    const taken = new Set(entries.map((e) => e.nonce));
    const top = Math.max(chainPending, prev.next);
    nonce = top;
    for (let n = chainPending; n < top; n++) if (!taken.has(n)) { nonce = n; break; }
  }
  entries.push({ nonce, status: "held", ...holder, at: nowMs });
  return { state: { next: Math.max(prev.next, chainPending, nonce + 1), entries }, nonce };
}

/** Applies a lease release (pure). An unknown, superseded or reclaimed lease leaves the state unchanged. */
export function releaseNonceIn(st: AgentNonceState | undefined, nonce: number, token: string, sent: boolean, nowMs: number): AgentNonceState | undefined {
  if (!st) return st;
  const i = st.entries.findIndex((e) => e.nonce === nonce && e.token === token);
  if (i < 0) return st;
  const entries = [...st.entries];
  if (sent) entries[i] = { ...entries[i], status: "sent", at: nowMs };
  else entries.splice(i, 1);
  return { ...st, entries };
}

const HOST = hostname();

export function swappable(cur: JournalRecord | undefined, expectRev: number | null): boolean {
  if (expectRev === null) return !cur || cur.state === "failed";
  return !!cur && (cur.rev ?? 0) === expectRev;
}

export interface MemoryJournalOptions {
  /** Nonce reservations older than this are reclaimed. Default 10 minutes. */
  nonceLeaseTtlMs?: number;
}

export class MemoryJournal implements Journal {
  private m = new Map<string, JournalRecord>();
  private nonces = new Map<string, AgentNonceState>();
  private readonly ttlMs: number;
  constructor(opts: MemoryJournalOptions = {}) { this.ttlMs = opts.nonceLeaseTtlMs ?? DEFAULT_NONCE_LEASE_TTL_MS; }
  async get(key: string) { const r = this.m.get(key); return r ? structuredClone(r) : undefined; }
  async list() { return [...this.m.values()].map((r) => structuredClone(r)); }
  async put(rec: JournalRecord) { this.m.set(rec.key, structuredClone(rec)); }
  /** Atomic: the check and the write run without an intervening await. */
  async swap(rec: JournalRecord, expectRev: number | null) {
    if (!swappable(this.m.get(rec.key), expectRev)) return false;
    this.m.set(rec.key, structuredClone(rec));
    return true;
  }
  /** Atomic like swap. One process only, so a holder is never "gone": stale leases end by TTL alone. */
  async allocateNonce(agent: string, chainPendingNonce: number, opts?: AllocateNonceOptions): Promise<NonceLease> {
    const a = agent.toLowerCase();
    const token = randomUUID();
    const r = allocateNonceIn(this.nonces.get(a), chainPendingNonce, { token, host: HOST, pid: process.pid }, Date.now(), this.ttlMs, () => false, opts);
    this.nonces.set(a, r.state);
    return {
      nonce: r.nonce,
      release: async ({ sent = true } = {}) => {
        const s = releaseNonceIn(this.nonces.get(a), r.nonce, token, sent, Date.now());
        if (s) this.nonces.set(a, s);
      },
    };
  }
  /** Current nonce bookkeeping for an agent (diagnostics and tests). */
  async nonceState(agent: string): Promise<AgentNonceState | undefined> { const s = this.nonces.get(agent.toLowerCase()); return s ? structuredClone(s) : undefined; }
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}

export interface FileJournalOptions {
  /** How long to wait for the lock before failing (the operation fails; nothing is stolen). Default 60 000 ms. */
  lockWaitMs?: number;
  /** Nonce reservations older than this are reclaimed even from a live holder. Default 10 minutes. */
  nonceLeaseTtlMs?: number;
}

/**
 * A JSON file journal. Every read-modify-write holds an exclusive lock file (`<path>.lock`, created with O_EXCL and
 * holding the owner's host, pid and a random token), so several processes on ONE machine can share it and `swap` is
 * atomic across them. A lock is never taken away from a live process, however long it pauses: it is removed only when
 * its owner is on this host and that pid no longer exists, and that removal itself runs under a second O_EXCL lock so
 * two waiters cannot both remove it. A lock from another host, or one whose pid has been reused, is never removed: the
 * operation waits and then fails, and an operator must clear it. Not for network file systems.
 * Each write goes to a temporary file that is renamed over the old one, so a crash leaves the previous or the new
 * version, never a torn file.
 * Per-agent nonce reservations (`allocateNonce`) live in a sibling file `<path>.nonces`, written under the same lock,
 * so purchase records keep their 0.1.x shape and `get`/`list` return purchases only.
 */
export class FileJournal implements Journal {
  private readonly lockWaitMs: number;
  private readonly ttlMs: number;
  private readonly noncePath: string;
  constructor(private path: string, opts: FileJournalOptions = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.lockWaitMs = opts.lockWaitMs ?? 60_000;
    this.ttlMs = opts.nonceLeaseTtlMs ?? DEFAULT_NONCE_LEASE_TTL_MS;
    this.noncePath = `${path}.nonces`;
  }
  private read(): Record<string, JournalRecord> {
    if (!existsSync(this.path)) return {};
    return JSON.parse(readFileSync(this.path, "utf8"));
  }
  private write(all: Record<string, JournalRecord>) { this.writeAtomic(this.path, all); }
  private writeAtomic(file: string, data: unknown) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }
  private readNonces(): Record<string, AgentNonceState> {
    if (!existsSync(this.noncePath)) return {};
    return JSON.parse(readFileSync(this.noncePath, "utf8"));
  }
  private tryCreate(file: string, body: string): boolean {
    try { const fd = openSync(file, "wx"); try { writeFileSync(fd, body); } finally { closeSync(fd); } return true; } catch (e: any) {
      if (e?.code === "EEXIST") return false;
      // Windows: creating a file that another process is deleting at that moment fails with EPERM (or EBUSY) instead of
      // EEXIST. It is the same contention, so wait and retry; a real permission problem ends at the lockWaitMs deadline.
      if (process.platform === "win32" && (e?.code === "EPERM" || e?.code === "EACCES" || e?.code === "EBUSY")) return false;
      throw e;
    }
  }
  /** Removes the lock only if it still belongs to a dead process on this host, under a second exclusive lock. */
  private reapDeadOwner(lock: string) {
    const reaper = `${lock}.reap`;
    if (!this.tryCreate(reaper, JSON.stringify({ host: HOST, pid: process.pid }))) return;
    try {
      let owner: { host?: string; pid?: number };
      try { owner = JSON.parse(readFileSync(lock, "utf8")); } catch { return; } // gone, or being written: just retry
      if (owner.host === HOST && typeof owner.pid === "number" && owner.pid !== process.pid && !processAlive(owner.pid)) unlinkSync(lock);
    } finally { try { unlinkSync(reaper); } catch { /* already gone */ } }
  }
  private locked<T>(fn: () => T): T {
    const lock = `${this.path}.lock`;
    const token = randomUUID();
    const deadline = Date.now() + this.lockWaitMs;
    while (!this.tryCreate(lock, JSON.stringify({ host: HOST, pid: process.pid, token }))) {
      this.reapDeadOwner(lock);
      if (Date.now() > deadline) {
        let owner = "unknown";
        try { owner = readFileSync(lock, "utf8"); } catch { /* ignore */ }
        throw new Error(`journal lock ${lock} is held (${owner}); it is never taken from a live or remote process. Remove it only if that process is gone.`);
      }
      sleepSync(5);
    }
    try { return fn(); } finally {
      try { if (JSON.parse(readFileSync(lock, "utf8")).token === token) unlinkSync(lock); } catch { /* already gone */ }
    }
  }
  async get(key: string) { return this.locked(() => this.read()[key]); }
  async put(rec: JournalRecord) { this.locked(() => { const all = this.read(); all[rec.key] = rec; this.write(all); }); }
  async swap(rec: JournalRecord, expectRev: number | null) {
    return this.locked(() => {
      const all = this.read();
      if (!swappable(all[rec.key], expectRev)) return false;
      all[rec.key] = rec;
      this.write(all);
      return true;
    });
  }
  async list(): Promise<JournalRecord[]> { return Object.values(this.locked(() => this.read())); }
  /**
   * Atomic across processes on this machine (the same O_EXCL lock as swap). A `held` lease whose owner pid on this host
   * has exited is reclaimed: that process died between allocating the nonce and learning the outcome of its send.
   */
  async allocateNonce(agent: string, chainPendingNonce: number, opts?: AllocateNonceOptions): Promise<NonceLease> {
    const a = agent.toLowerCase();
    const token = randomUUID();
    const gone = (e: NonceEntry) => e.host === HOST && e.pid !== process.pid && !processAlive(e.pid);
    const nonce = this.locked(() => {
      const all = this.readNonces();
      const r = allocateNonceIn(all[a], chainPendingNonce, { token, host: HOST, pid: process.pid }, Date.now(), this.ttlMs, gone, opts);
      all[a] = r.state;
      this.writeAtomic(this.noncePath, all);
      return r.nonce;
    });
    return {
      nonce,
      release: async ({ sent = true } = {}) => {
        this.locked(() => {
          const all = this.readNonces();
          const s = releaseNonceIn(all[a], nonce, token, sent, Date.now());
          if (s && s !== all[a]) { all[a] = s; this.writeAtomic(this.noncePath, all); }
        });
      },
    };
  }
  /** Current nonce bookkeeping for an agent (diagnostics and tests). */
  async nonceState(agent: string): Promise<AgentNonceState | undefined> { return this.locked(() => this.readNonces()[agent.toLowerCase()]); }
}
