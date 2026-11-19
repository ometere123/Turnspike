import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Challenge } from "./protocol";

/**
 * `reserved`: an idempotency key is claimed by one call, no challenge yet, nothing can have been paid.
 * `challenged`: a challenge is recorded under the key; from here on, every path pays only this challenge's requestId.
 */
export type JournalState = "reserved" | "challenged" | "paying" | "broadcast" | "confirmed" | "delivered" | "failed";

/**
 * What the client remembers about one paid request so a restart never pays twice. Contains no private keys and no
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
  /** Random token of the call that holds this key. Changes only through `swap`. */
  lockToken?: string;
  updatedAt: number;
}

export interface Journal {
  get(key: string): Promise<JournalRecord | undefined>;
  put(rec: JournalRecord): Promise<void>;
  /**
   * Atomic compare-and-set. Writes `rec` only if the stored record for `rec.key` is absent or failed (`expectToken` null),
   * or currently carries `lockToken === expectToken`. Returns whether it wrote. Optional for compatibility with 0.1.0
   * journals; without it the client serializes key claims inside one process only (see the README).
   */
  swap?(rec: JournalRecord, expectToken: string | null): Promise<boolean>;
}

function swappable(cur: JournalRecord | undefined, expectToken: string | null): boolean {
  if (expectToken === null) return !cur || cur.state === "failed";
  return !!cur && cur.lockToken === expectToken;
}

export class MemoryJournal implements Journal {
  private m = new Map<string, JournalRecord>();
  async get(key: string) { const r = this.m.get(key); return r ? structuredClone(r) : undefined; }
  async put(rec: JournalRecord) { this.m.set(rec.key, structuredClone(rec)); }
  /** Atomic: the check and the write run without an intervening await. */
  async swap(rec: JournalRecord, expectToken: string | null) {
    if (!swappable(this.m.get(rec.key), expectToken)) return false;
    this.m.set(rec.key, structuredClone(rec));
    return true;
  }
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * A JSON file journal. Every read-modify-write holds an exclusive lock file (`<path>.lock`, created with O_EXCL), so
 * several processes on one machine can share it and `swap` is atomic across them. Each write goes to a temporary file
 * that is renamed over the old one, so a crash leaves the previous or the new version, never a torn file. A lock file
 * older than 30 s is treated as left by a crashed process and removed. Not for network file systems without O_EXCL.
 */
export class FileJournal implements Journal {
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
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
  private locked<T>(fn: () => T): T {
    const lock = `${this.path}.lock`;
    for (let i = 0; ; i++) {
      let fd: number;
      try { fd = openSync(lock, "wx"); } catch (e: any) {
        if (e?.code !== "EEXIST") throw e;
        try { if (Date.now() - statSync(lock).mtimeMs > 30_000) unlinkSync(lock); } catch { /* raced with its owner */ }
        if (i > 3000) throw new Error(`journal lock ${lock} is held too long`);
        sleepSync(5);
        continue;
      }
      try { return fn(); } finally { closeSync(fd); try { unlinkSync(lock); } catch { /* already gone */ } }
    }
  }
  async get(key: string) { return this.locked(() => this.read()[key]); }
  async put(rec: JournalRecord) { this.locked(() => { const all = this.read(); all[rec.key] = rec; this.write(all); }); }
  async swap(rec: JournalRecord, expectToken: string | null) {
    return this.locked(() => {
      const all = this.read();
      if (!swappable(all[rec.key], expectToken)) return false;
      all[rec.key] = rec;
      this.write(all);
      return true;
    });
  }
  async list(): Promise<JournalRecord[]> { return Object.values(this.locked(() => this.read())); }
}
