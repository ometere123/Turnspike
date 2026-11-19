import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Challenge } from "./protocol";

/**
 * `reserved`: an idempotency key is claimed by one call, no challenge yet, nothing can have been paid.
 * `challenged`: a challenge is recorded under the key; from here on, every path pays only this challenge's requestId.
 */
export type JournalState = "reserved" | "challenged" | "paying" | "broadcast" | "confirmed" | "delivered" | "failed";

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
}

export function swappable(cur: JournalRecord | undefined, expectRev: number | null): boolean {
  if (expectRev === null) return !cur || cur.state === "failed";
  return !!cur && (cur.rev ?? 0) === expectRev;
}

export class MemoryJournal implements Journal {
  private m = new Map<string, JournalRecord>();
  async get(key: string) { const r = this.m.get(key); return r ? structuredClone(r) : undefined; }
  async put(rec: JournalRecord) { this.m.set(rec.key, structuredClone(rec)); }
  /** Atomic: the check and the write run without an intervening await. */
  async swap(rec: JournalRecord, expectRev: number | null) {
    if (!swappable(this.m.get(rec.key), expectRev)) return false;
    this.m.set(rec.key, structuredClone(rec));
    return true;
  }
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const HOST = hostname();

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}

export interface FileJournalOptions {
  /** How long to wait for the lock before failing (the operation fails; nothing is stolen). Default 60 000 ms. */
  lockWaitMs?: number;
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
 */
export class FileJournal implements Journal {
  private readonly lockWaitMs: number;
  constructor(private path: string, opts: FileJournalOptions = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.lockWaitMs = opts.lockWaitMs ?? 60_000;
  }
  private read(): Record<string, JournalRecord> {
    if (!existsSync(this.path)) return {};
    return JSON.parse(readFileSync(this.path, "utf8"));
  }
  private write(all: Record<string, JournalRecord>) {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
  private tryCreate(file: string, body: string): boolean {
    try { const fd = openSync(file, "wx"); try { writeFileSync(fd, body); } finally { closeSync(fd); } return true; } catch (e: any) {
      if (e?.code === "EEXIST") return false;
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
}
