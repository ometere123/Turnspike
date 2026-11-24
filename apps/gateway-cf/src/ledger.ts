import { DurableObject } from "cloudflare:workers";
import { computeRequestId, type ChallengeFields } from "./challenge";
import type { FoundPayment, Payer } from "./chain";

export type State = "ISSUED" | "PAID_PENDING" | "PAID_CONFIRMED" | "DELIVERING" | "DELIVERED" | "EXPIRED" | "REJECTED";
export type PaymentRow = {
  requestId: string; nonce: string; resourceId: string; merchant: string; priceBase: string; chainId: number; contract: string; expiresAt: number;
  state: State; txHash: string | null; blockNumber: number | null; payer: string | null; agent: string | null;
  leaseUntil: number | null; leaseToken: string | null; createdAt: number; updatedAt: number;
};
export type Stored = { status: number; type: string; headers: Record<string, string>; body: ArrayBuffer };
export type ExportRow = Omit<PaymentRow, "leaseUntil" | "leaseToken"> & { response: { status: number; type: string; headers: Record<string, string>; bodyBase64: string } | null };
export type Orphan = { requestId: string; txHash: string; blockNumber: number; payer: string; amountBase: string };

const now = () => Math.floor(Date.now() / 1000);
const hex32 = /^0x[0-9a-f]{64}$/;
const STATES: State[] = ["ISSUED", "PAID_PENDING", "PAID_CONFIRMED", "DELIVERING", "DELIVERED", "EXPIRED", "REJECTED"];

/**
 * The payment record of one merchant. All of it lives in this object's SQLite storage; nothing authoritative is in memory.
 * Every public method that changes state is synchronous from its first read to its last write, so no other request can run
 * in between (Durable Objects interleave only at an await), and multi-statement changes are in transactionSync as well.
 * One object per merchant on purpose: a transaction hash must back at most one request, and only one place can decide that.
 */
export class Ledger extends DurableObject<Env> {
  private sql: SqlStorage;
  private hits = new Map<string, { n: number; reset: number }>(); // best-effort rate limit; losing it on eviction is harmless

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      // Additive only. A row is written once for an unpaid challenge, which is what most rows are.
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS payments (
          requestId TEXT PRIMARY KEY, nonce TEXT NOT NULL, resourceId TEXT NOT NULL, merchant TEXT NOT NULL, priceBase TEXT NOT NULL,
          chainId INTEGER NOT NULL, contract TEXT NOT NULL, expiresAt INTEGER NOT NULL, state TEXT NOT NULL, txHash TEXT, blockNumber INTEGER,
          payer TEXT, agent TEXT, leaseUntil INTEGER, leaseToken TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
        ) WITHOUT ROWID;
        CREATE UNIQUE INDEX IF NOT EXISTS payments_tx ON payments(txHash) WHERE txHash IS NOT NULL;
        CREATE TABLE IF NOT EXISTS responses (requestId TEXT PRIMARY KEY, status INTEGER NOT NULL, type TEXT NOT NULL, headers TEXT NOT NULL, body BLOB NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, requestId TEXT NOT NULL, fromState TEXT, toState TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS orphans (requestId TEXT PRIMARY KEY, txHash TEXT NOT NULL, blockNumber INTEGER NOT NULL, payer TEXT NOT NULL, agent TEXT NOT NULL, amountBase TEXT NOT NULL, seenAt INTEGER NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
      `);
    });
  }

  private row(requestId: string): PaymentRow | null {
    return (this.sql.exec<PaymentRow>("SELECT * FROM payments WHERE requestId = ?", requestId).toArray()[0]) ?? null;
  }
  private meta(k: string): string | null {
    return this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0]?.v ?? null;
  }
  private setMeta(k: string, v: string) { this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v); }

  private move(requestId: string, from: State[], to: State, set: Partial<PaymentRow>, detail: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const r = this.row(requestId);
      if (!r || !from.includes(r.state)) return false;
      const keys = Object.keys(set) as (keyof PaymentRow)[];
      this.sql.exec(`UPDATE payments SET state = ?, updatedAt = ?${keys.map((k) => `, ${k} = ?`).join("")} WHERE requestId = ?`, to, now(), ...keys.map((k) => set[k] as string | number | null), requestId);
      this.sql.exec("INSERT INTO events (requestId, fromState, toState, detail, at) VALUES (?, ?, ?, ?, ?)", requestId, r.state, to, detail, now());
      return true;
    });
  }

  get(requestId: string): PaymentRow | null { return this.row(requestId); }

  /**
   * Records a new challenge. A daily budget keeps unpaid traffic from using up the account's write quota: paid requests must
   * always be able to write. The caller is refused, never charged, when the budget or its own rate is exceeded.
   */
  issue(f: ChallengeFields & { requestId: string }, client: string, limits: { perMinute: number; perDay: number }): "ok" | "rate_limited" | "budget" {
    const t = now();
    const h = this.hits.get(client);
    if (!h || h.reset < t) this.hits.set(client, { n: 1, reset: t + 60 });
    else if (++h.n > limits.perMinute) return "rate_limited";
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.reset < t) this.hits.delete(k);
    const day = String(Math.floor(t / 86_400));
    const [d, n] = (this.meta("issued") ?? "").split(":");
    const used = d === day ? Number(n) : 0;
    if (used >= limits.perDay) return "budget";
    this.ctx.storage.transactionSync(() => {
      this.setMeta("issued", `${day}:${used + 1}`);
      this.sql.exec("INSERT INTO payments (requestId, nonce, resourceId, merchant, priceBase, chainId, contract, expiresAt, state, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?)",
        f.requestId, f.nonce, f.resourceId, f.merchant, f.priceBase, f.chainId, f.contract, f.expiresAt, t, t);
    });
    return "ok";
  }

  proofSeen(requestId: string): void { this.move(requestId, ["ISSUED", "EXPIRED"], "PAID_PENDING", {}, "proof_submitted"); }

  /** Attaches a verified payment. A transaction hash can back one request only. Repeating the same answer is harmless. */
  confirm(requestId: string, txHash: string, p: Payer, detail: string): "ok" | "tx_reused" | "conflict" {
    return this.ctx.storage.transactionSync(() => {
      const other = this.sql.exec<{ requestId: string }>("SELECT requestId FROM payments WHERE txHash = ?", txHash).toArray()[0];
      if (other && other.requestId !== requestId) return "tx_reused";
      const r = this.row(requestId);
      if (!r) return "conflict";
      if (r.txHash) return r.txHash === txHash ? "ok" : "conflict";
      if (!this.move(requestId, ["ISSUED", "PAID_PENDING", "EXPIRED"], "PAID_CONFIRMED", { txHash, blockNumber: p.blockNumber, payer: p.payer, agent: p.agent }, detail)) return "conflict";
      this.sql.exec("DELETE FROM orphans WHERE requestId = ?", requestId);
      return "ok";
    });
  }

  /** Terminal: verified, but mined after the deadline. Kept for ever with its transaction, so it can be settled by hand. */
  rejectLate(requestId: string, txHash: string, p: Payer): boolean {
    const other = this.sql.exec<{ requestId: string }>("SELECT requestId FROM payments WHERE txHash = ?", txHash).toArray()[0];
    if (other && other.requestId !== requestId) return false;
    return this.move(requestId, ["ISSUED", "PAID_PENDING", "EXPIRED"], "REJECTED", { txHash, blockNumber: p.blockNumber, payer: p.payer, agent: p.agent }, "paid_too_late");
  }

  /** Takes the delivery lease and returns its fencing token, or null while someone else holds a live one. */
  claim(requestId: string, leaseSeconds: number): string | null {
    const r = this.row(requestId);
    if (!r) return null;
    const free = r.state === "PAID_CONFIRMED" || (r.state === "DELIVERING" && (r.leaseUntil ?? 0) < now());
    if (!free) return null;
    const token = crypto.randomUUID();
    return this.move(requestId, [r.state], "DELIVERING", { leaseUntil: now() + leaseSeconds, leaseToken: token }, r.state === "DELIVERING" ? "lease_expired_retry" : "claimed") ? token : null;
  }

  /** Stores the response for the current lease holder only. The Worker sends nothing before this returns true. */
  complete(requestId: string, token: string, s: Stored): boolean {
    return this.ctx.storage.transactionSync(() => {
      const r = this.row(requestId);
      if (!r || r.state !== "DELIVERING" || r.leaseToken !== token) return false;
      this.sql.exec("INSERT INTO responses (requestId, status, type, headers, body) VALUES (?, ?, ?, ?, ?)", requestId, s.status, s.type, JSON.stringify(s.headers), s.body);
      return this.move(requestId, ["DELIVERING"], "DELIVERED", { leaseUntil: null, leaseToken: null }, "handler_ok");
    });
  }

  release(requestId: string, token: string, why: string): boolean {
    const r = this.row(requestId);
    if (!r || r.state !== "DELIVERING" || r.leaseToken !== token) return false;
    return this.move(requestId, ["DELIVERING"], "PAID_CONFIRMED", { leaseUntil: null, leaseToken: null }, why);
  }

  response(requestId: string): Stored | null {
    const r = this.sql.exec<{ status: number; type: string; headers: string; body: ArrayBuffer }>("SELECT status, type, headers, body FROM responses WHERE requestId = ?", requestId).toArray()[0];
    return r ? { ...r, headers: JSON.parse(r.headers) as Record<string, string> } : null;
  }

  orphan(requestId: string): Orphan | null {
    return this.sql.exec<Orphan>("SELECT requestId, txHash, blockNumber, payer, amountBase FROM orphans WHERE requestId = ?", requestId).toArray()[0] ?? null;
  }

  /** Public history: settled rows only, newest first, no signatures and no response bodies. */
  recent(limit: number): Pick<PaymentRow, "requestId" | "state" | "txHash" | "blockNumber" | "resourceId" | "priceBase" | "payer" | "updatedAt">[] {
    return this.sql.exec<Pick<PaymentRow, "requestId" | "state" | "txHash" | "blockNumber" | "resourceId" | "priceBase" | "payer" | "updatedAt">>(
      "SELECT requestId, state, txHash, blockNumber, resourceId, priceBase, payer, updatedAt FROM payments WHERE txHash IS NOT NULL ORDER BY blockNumber DESC LIMIT ?", Math.min(50, Math.max(1, limit))).toArray();
  }

  stats(own: string[]) {
    const mine = new Set(own.map((a) => a.toLowerCase()));
    const rows = this.sql.exec<{ payer: string | null; agent: string | null }>("SELECT payer, agent FROM payments WHERE txHash IS NOT NULL AND state = 'DELIVERED'").toArray();
    const ext = rows.filter((r) => !(r.payer && mine.has(r.payer.toLowerCase())) && !(r.agent && mine.has(r.agent.toLowerCase()))).length;
    const one = (q: string, ...a: number[]) => this.sql.exec<{ c: number }>(q, ...a).one().c;
    const open = one("SELECT COUNT(*) c FROM payments WHERE txHash IS NOT NULL AND state IN ('PAID_CONFIRMED','DELIVERING') AND updatedAt < ?", now() - 86_400);
    const late = one("SELECT COUNT(*) c FROM payments WHERE txHash IS NOT NULL AND state = 'REJECTED'");
    return { delivered: rows.length, deliveredOwn: rows.length - ext, deliveredExternal: ext, paidUndelivered24h: open + late, paidUnrecorded: one("SELECT COUNT(*) c FROM orphans"), reconciledBlock: Number(this.meta("reconciledBlock") ?? 0) || null, reconciledAt: Number(this.meta("reconciledAt") ?? 0) || null };
  }

  reconciledBlock(): number | null { return Number(this.meta("reconciledBlock") ?? 0) || null; }

  /** Which of these on-chain payments still need a decision here? Payments with no record at all are kept as orphans, never dropped. */
  triage(found: FoundPayment[]): string[] {
    const need: string[] = [];
    for (const f of found) {
      const r = this.row(f.requestId);
      if (!r) this.sql.exec("INSERT OR IGNORE INTO orphans (requestId, txHash, blockNumber, payer, agent, amountBase, seenAt) VALUES (?, ?, ?, ?, ?, ?, ?)", f.requestId, f.txHash, f.blockNumber, f.payer, f.agent, f.amountBase, now());
      else if (!r.txHash) need.push(f.requestId);
    }
    return need;
  }
  reconciled(block: number, throughTime: number): void {
    this.ctx.storage.transactionSync(() => {
      if (block <= Number(this.meta("reconciledBlock") ?? 0)) return; // an overlapping older run must not move the mark back
      this.setMeta("reconciledBlock", String(block));
      this.setMeta("reconciledThroughTime", String(throughTime));
      this.setMeta("reconciledAt", String(now()));
    });
  }

  /** Deletes unpaid challenges only: past retention, past their payment deadline, and the chain already scanned past that deadline. */
  purge(retentionSeconds: number, graceSeconds: number, max = 1000): number {
    const through = Number(this.meta("reconciledThroughTime") ?? 0);
    const ids = this.sql.exec<{ requestId: string }>("SELECT requestId FROM payments WHERE txHash IS NULL AND createdAt < ? AND expiresAt + ? < ? LIMIT ?", now() - retentionSeconds, graceSeconds, through, max).toArray();
    for (const { requestId } of ids) this.sql.exec("DELETE FROM payments WHERE requestId = ? AND txHash IS NULL", requestId);
    return ids.length;
  }

  ping(): { ok: true; payments: number } { return { ok: true, payments: this.sql.exec<{ c: number }>("SELECT COUNT(*) c FROM (SELECT 1 FROM payments LIMIT 1)").one().c }; }

  // ---- backup and restore (admin only)
  async export(after: string, limit: number): Promise<{ rows: ExportRow[]; next: string | null; orphans: Orphan[]; bookmark: string | null }> {
    const rows = this.sql.exec<PaymentRow>("SELECT * FROM payments WHERE requestId > ? ORDER BY requestId LIMIT ?", after, limit).toArray().map((r): ExportRow => {
      const s = this.response(r.requestId);
      const { leaseUntil: _a, leaseToken: _b, ...rest } = r;
      return { ...rest, response: s ? { status: s.status, type: s.type, headers: s.headers, bodyBase64: Buffer.from(s.body).toString("base64") } : null };
    });
    const orphans = after === "" ? this.sql.exec<Orphan>("SELECT requestId, txHash, blockNumber, payer, amountBase FROM orphans").toArray() : [];
    const bookmark = await this.ctx.storage.getCurrentBookmark().catch(() => null); // point-in-time recovery; not available locally
    return { rows, next: rows.length === limit ? rows[rows.length - 1]!.requestId : null, orphans, bookmark };
  }

  private keepResponse(id: string, state: State, r: ExportRow) {
    if (!r.response || state !== "DELIVERED") return;
    const b = Buffer.from(r.response.bodyBase64, "base64");
    this.sql.exec("INSERT INTO responses (requestId, status, type, headers, body) VALUES (?, ?, ?, ?, ?)", id, r.response.status, r.response.type, JSON.stringify(r.response.headers), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }

  /**
   * Adds exported rows (from this ledger or from the earlier SQLite gateway). All or nothing. A row is refused if its id does
   * not match its own contents, if it is for another merchant, contract or chain, or if a different record already exists.
   * An in-progress delivery comes back as paid and not delivered, so the next proof can finish it. Nothing is overwritten.
   */
  import(rows: ExportRow[], expect: { merchant: string; contract: string; chainId: number }): { imported: number; same: number; advanced: number; kept: number } {
    return this.ctx.storage.transactionSync(() => {
      let imported = 0, same = 0, advanced = 0, kept = 0;
      for (const r of rows) {
        const id = String(r.requestId).toLowerCase();
        const bad = (why: string): never => { throw new Error(`row ${id}: ${why}`); };
        if (!hex32.test(id) || computeRequestId(r) !== id) bad("id does not match contents");
        if (r.merchant.toLowerCase() !== expect.merchant.toLowerCase() || r.contract.toLowerCase() !== expect.contract.toLowerCase() || r.chainId !== expect.chainId) bad("other merchant, contract or chain");
        if (!STATES.includes(r.state)) bad("unknown state");
        const txHash = r.txHash ? r.txHash.toLowerCase() : null;
        if (txHash && !hex32.test(txHash)) bad("malformed transaction hash");
        const state: State = r.state === "DELIVERING" ? "PAID_CONFIRMED" : r.state;
        if ((state === "PAID_CONFIRMED" || state === "DELIVERED" || state === "REJECTED") && !txHash) bad("paid state without a transaction");
        if (state === "DELIVERED" && !r.response) bad("delivered without a stored response");
        const have = this.row(id);
        if (have) {
          if (have.state === state && have.txHash === txHash) { same++; continue; }
          // A later copy may know more than the first one did (a quote paid in between). A record only ever moves forward, and
          // never to another transaction. A refused, finished or currently leased record is never changed here.
          const step = (st: State) => ({ ISSUED: 0, PAID_PENDING: 1, PAID_CONFIRMED: 2, DELIVERED: 3 } as Partial<Record<State, number>>)[st];
          const a = step(have.state), b = step(state);
          if (a === undefined || b === undefined || (have.txHash && txHash && have.txHash !== txHash)) return bad("a different record already exists");
          if (a >= b) { kept++; continue; }
          this.sql.exec("UPDATE payments SET state = ?, txHash = ?, blockNumber = ?, payer = ?, agent = ?, updatedAt = ? WHERE requestId = ?", state, txHash, r.blockNumber, r.payer, r.agent, r.updatedAt, id);
          this.keepResponse(id, state, r);
          this.sql.exec("INSERT INTO events (requestId, fromState, toState, detail, at) VALUES (?, ?, ?, 'imported', ?)", id, have.state, state, now());
          advanced++;
          continue;
        }
        this.sql.exec("INSERT INTO payments (requestId, nonce, resourceId, merchant, priceBase, chainId, contract, expiresAt, state, txHash, blockNumber, payer, agent, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id, r.nonce, r.resourceId, r.merchant, r.priceBase, r.chainId, r.contract, r.expiresAt, state, txHash, r.blockNumber, r.payer, r.agent, r.createdAt, r.updatedAt);
        this.keepResponse(id, state, r);
        this.sql.exec("DELETE FROM orphans WHERE requestId = ?", id);
        this.sql.exec("INSERT INTO events (requestId, fromState, toState, detail, at) VALUES (?, NULL, ?, 'imported', ?)", id, state, now());
        imported++;
      }
      return { imported, same, advanced, kept };
    });
  }
}
