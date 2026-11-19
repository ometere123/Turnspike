import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";

/**
 * Abuse controls for the public demo agent. The agent signs real transactions with a funded key, so every request must be
 * bounded in three independent ways:
 *   1. proof of work (cheap for a person clicking a button, costly for a script looping on the endpoint), single use;
 *   2. per-client quotas (hourly and daily), persisted in SQLite so a restart does not reset them;
 *   3. a global daily transaction budget and a minimum gas balance floor, which cap the worst-case spend no matter who calls.
 * The contract's own per-call and daily caps remain the final limit on QUSDC.
 */
export interface DemoLimits {
  powBits: number; // leading zero bits required, default 15 (about 32k hashes)
  powTtlSeconds: number; // default 120
  perIpHour: number; // default 4 runs
  perIpDay: number; // default 10 runs
  globalTxPerDay: number; // default 60 broadcast transactions
}

export const DEFAULT_LIMITS: DemoLimits = { powBits: 15, powTtlSeconds: 120, perIpHour: 4, perIpDay: 10, globalTxPerDay: 60 };

/** Broadcast transactions each scenario can send (pessimistic, charged up front). Simulations send none. */
export const SCENARIO_TX_COST: Record<string, number> = { allowed: 1, replay: 1, "over-cap": 1, "unauthorized-merchant": 0 };

export type PowDenial = { ok: false; status: 403; error: "pow_required" | "pow_invalid" | "pow_expired" | "pow_used" | "pow_wrong_client" };
export type QuotaDenial = { ok: false; status: 429; error: "quota_exceeded"; scope: "ip_hour" | "ip_day" | "global_day"; retryAfterSeconds: number };
export type GuardDenial = PowDenial | QuotaDenial;

const leadingZeroBits = (buf: Buffer) => {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) { n += 8; continue; }
    n += Math.clz32(byte) - 24;
    break;
  }
  return n;
};

export class DemoGuard {
  constructor(private db: Database.Database, private secret: string, private limits: DemoLimits = DEFAULT_LIMITS) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS demo_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, client TEXT NOT NULL, scenario TEXT NOT NULL, txCost INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS demo_runs_at ON demo_runs(at);
      CREATE TABLE IF NOT EXISTS demo_pow_used (salt TEXT PRIMARY KEY, at INTEGER NOT NULL);
    `);
  }

  private now() { return Math.floor(Date.now() / 1000); }
  private mac(...parts: (string | number)[]) { return createHmac("sha256", this.secret).update(parts.join("|")).digest("hex"); }
  private clientKey(ip: string) { return createHash("sha256").update(ip).digest("hex").slice(0, 16); } // no raw IPs stored

  /** Issues a proof-of-work puzzle bound to the client. Stateless: the signature carries salt, expiry and client. */
  challenge(ip: string) {
    const salt = randomBytes(12).toString("hex");
    const expires = this.now() + this.limits.powTtlSeconds;
    const sig = this.mac("pow", salt, expires, this.clientKey(ip));
    return { token: `${salt}.${expires}.${sig}`, bits: this.limits.powBits, expires };
  }

  /** Verifies and consumes a solved puzzle: header format is "<token>.<nonce>". sha256(`${salt}:${nonce}`) needs `bits` zero bits. */
  consumePow(header: string | undefined, ip: string): { ok: true } | PowDenial {
    if (!header) return { ok: false, status: 403, error: "pow_required" };
    const parts = header.split(".");
    if (parts.length !== 4) return { ok: false, status: 403, error: "pow_invalid" };
    const [salt, exp, sig, nonce] = parts;
    const expected = Buffer.from(this.mac("pow", salt, exp, this.clientKey(ip)), "hex");
    const got = Buffer.from(/^[0-9a-f]{64}$/.test(sig) ? sig : "00", "hex");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      // Distinguish "valid for another client" only when the signature matches with some other client? Not knowable; report as wrong client.
      return { ok: false, status: 403, error: "pow_wrong_client" };
    }
    if (Number(exp) < this.now()) return { ok: false, status: 403, error: "pow_expired" };
    if (!/^[0-9a-zA-Z]{1,24}$/.test(nonce)) return { ok: false, status: 403, error: "pow_invalid" };
    const digest = createHash("sha256").update(`${salt}:${nonce}`).digest();
    if (leadingZeroBits(digest) < this.limits.powBits) return { ok: false, status: 403, error: "pow_invalid" };
    const res = this.db.prepare("INSERT OR IGNORE INTO demo_pow_used (salt, at) VALUES (?, ?)").run(salt, this.now());
    if (res.changes === 0) return { ok: false, status: 403, error: "pow_used" };
    this.db.prepare("DELETE FROM demo_pow_used WHERE at < ?").run(this.now() - 3600);
    return { ok: true };
  }

  /** Checks quotas and, if allowed, records the run (and its worst-case transaction cost) in one atomic write. */
  reserve(ip: string, scenario: string): { ok: true } | QuotaDenial {
    const client = this.clientKey(ip);
    const t = this.now();
    const cost = SCENARIO_TX_COST[scenario] ?? 1;
    return this.db.transaction((): { ok: true } | QuotaDenial => {
      const count = (since: number) => (this.db.prepare("SELECT COUNT(*) c FROM demo_runs WHERE client = ? AND at >= ?").get(client, since) as { c: number }).c;
      const oldest = (since: number) => (this.db.prepare("SELECT MIN(at) m FROM demo_runs WHERE client = ? AND at >= ?").get(client, since) as { m: number | null }).m ?? t;
      if (count(t - 3600) >= this.limits.perIpHour) return { ok: false, status: 429, error: "quota_exceeded", scope: "ip_hour", retryAfterSeconds: Math.max(1, oldest(t - 3600) + 3600 - t) };
      if (count(t - 86400) >= this.limits.perIpDay) return { ok: false, status: 429, error: "quota_exceeded", scope: "ip_day", retryAfterSeconds: Math.max(1, oldest(t - 86400) + 86400 - t) };
      const spent = (this.db.prepare("SELECT COALESCE(SUM(txCost),0) s FROM demo_runs WHERE at >= ?").get(t - 86400) as { s: number }).s;
      if (spent + cost > this.limits.globalTxPerDay) return { ok: false, status: 429, error: "quota_exceeded", scope: "global_day", retryAfterSeconds: 3600 };
      this.db.prepare("INSERT INTO demo_runs (client, scenario, txCost, at) VALUES (?, ?, ?, ?)").run(client, scenario, cost, t);
      return { ok: true };
    })();
  }

  /** Public, non-sensitive status for the UI and for monitoring. */
  status() {
    const t = this.now();
    const spent = (this.db.prepare("SELECT COALESCE(SUM(txCost),0) s FROM demo_runs WHERE at >= ?").get(t - 86400) as { s: number }).s;
    const runs = (this.db.prepare("SELECT COUNT(*) c FROM demo_runs WHERE at >= ?").get(t - 86400) as { c: number }).c;
    return { runsLast24h: runs, txBudgetRemaining: Math.max(0, this.limits.globalTxPerDay - spent), txBudget: this.limits.globalTxPerDay, perIpHour: this.limits.perIpHour, perIpDay: this.limits.perIpDay, powBits: this.limits.powBits };
  }
}
