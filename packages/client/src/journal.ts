import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Challenge } from "./protocol";

export type JournalState = "challenged" | "paying" | "broadcast" | "confirmed" | "delivered" | "failed";

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
  challenge: Challenge;
  owner: string;
  agent: string;
  nonce?: number; // agent account nonce used for the pay transaction
  fromBlock?: number; // chain head before broadcast, for log lookup on recovery
  txHash?: string;
  blockNumber?: number;
  error?: string;
  updatedAt: number;
}

export interface Journal {
  get(key: string): Promise<JournalRecord | undefined>;
  put(rec: JournalRecord): Promise<void>;
}

export class MemoryJournal implements Journal {
  private m = new Map<string, JournalRecord>();
  async get(key: string) { const r = this.m.get(key); return r ? structuredClone(r) : undefined; }
  async put(rec: JournalRecord) { this.m.set(rec.key, structuredClone(rec)); }
}

/**
 * A JSON file journal. Each write goes to a temporary file that is then renamed over the old one, so a crash leaves either
 * the previous or the new version, never a torn file. Suitable for one process; use your own Journal (database, KV store)
 * when several processes share an agent key.
 */
export class FileJournal implements Journal {
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  private read(): Record<string, JournalRecord> {
    if (!existsSync(this.path)) return {};
    return JSON.parse(readFileSync(this.path, "utf8"));
  }
  async get(key: string) { return this.read()[key]; }
  async put(rec: JournalRecord) {
    const all = this.read();
    all[rec.key] = rec;
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
  async list(): Promise<JournalRecord[]> { return Object.values(this.read()); }
}
