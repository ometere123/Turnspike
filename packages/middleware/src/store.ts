import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

export type State = "ISSUED" | "PAID_PENDING" | "PAID_CONFIRMED" | "DELIVERING" | "DELIVERED" | "EXPIRED" | "REJECTED";

export interface PaymentRow {
  requestId: string;
  nonce: string;
  resourceId: string;
  merchant: string;
  priceBase: string;
  chainId: number;
  contract: string;
  expiresAt: number;
  state: State;
  txHash: string | null;
  blockNumber: number | null;
  payer: string | null; // the allowance owner whose funds were spent
  agent: string | null; // the agent key that called pay
  leaseUntil: number | null; // delivery lease; a crashed handler is retried only after it lapses
  leaseToken: string | null; // fencing token of the current lease holder
  responseBody: string | null;
  responseStatus: number | null;
  responseType: string | null;
  responseEncoding: "utf8" | "base64" | null; // null = legacy utf8 rows
  responseHeaders: string | null; // JSON of the allowlisted headers stored with the body
  createdAt: number;
  updatedAt: number;
  /** Price pattern the challenge was issued for (issuance quota). Null on rows written before 0.2.0. */
  route?: string | null;
  /**
   * R1: the Express mount prefix (req.baseUrl) the challenge was issued under. The resourceId is relative to the mount (so
   * turnspike/1 bodies and requestIds are unchanged); this column binds an x402 presentation to the mount as well. Null on
   * rows written before it existed (not checked).
   */
  mount?: string | null;
  /**
   * Why a row with a transaction was not delivered. `PAID_LATE`: the payment was mined after the payment deadline; the row
   * stays REJECTED (as in 0.1.x) and is listed by `paidUndelivered()` so the merchant can honour or refund it off-protocol.
   */
  disposition?: "PAID_LATE" | null;
  /** When the response was stored (DELIVERED). The replay window counts from here. */
  deliveredAt?: number | null;
  /** Set when the stored response was purged after the replay window; the proof then answers 410. */
  responsePurgedAt?: number | null;
}

type NewRow = Pick<PaymentRow, "requestId" | "nonce" | "resourceId" | "merchant" | "priceBase" | "chainId" | "contract" | "expiresAt"> & { route?: string; mount?: string };

/** A payment that moved money but has not been delivered: paid too late, or paid and stuck before delivery. */
export interface PaidUndelivered {
  requestId: string;
  kind: "PAID_LATE" | "PAID_NOT_DELIVERED";
  state: State;
  resourceId: string;
  priceBase: string;
  merchant: string;
  txHash: string;
  payer: string | null;
  agent: string | null;
  blockNumber: number | null;
  updatedAt: number;
}

export interface StoredResponse {
  status: number;
  type: string;
  body: Buffer;
  headers: Record<string, string>;
}

/**
 * SQLite store (DATA-010, DATA-011). better-sqlite3 is synchronous, so each transition below is one atomic write.
 * Migrations are additive only, so an older database file keeps working.
 */
export class Store {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL"); // a row marked DELIVERED must survive a power cut
    this.db.pragma("busy_timeout = 5000"); // several processes may share one file
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        requestId TEXT PRIMARY KEY, nonce TEXT NOT NULL, resourceId TEXT NOT NULL, merchant TEXT NOT NULL,
        priceBase TEXT NOT NULL, chainId INTEGER NOT NULL, contract TEXT NOT NULL, expiresAt INTEGER NOT NULL,
        state TEXT NOT NULL, txHash TEXT UNIQUE, blockNumber INTEGER, payer TEXT,
        responseBody TEXT, responseStatus INTEGER, responseType TEXT,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT NOT NULL, fromState TEXT, toState TEXT NOT NULL,
        detail TEXT, at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
    const cols = (this.db.prepare("PRAGMA table_info(payments)").all() as { name: string }[]).map((c) => c.name);
    for (const [c, t] of [
      ["agent", "TEXT"], ["leaseUntil", "INTEGER"], ["leaseToken", "TEXT"], ["responseEncoding", "TEXT"], ["responseHeaders", "TEXT"],
      ["route", "TEXT"], ["disposition", "TEXT"], ["deliveredAt", "INTEGER"], ["responsePurgedAt", "INTEGER"], // added in 0.2.0
      ["mount", "TEXT"], // R1
    ]) {
      if (!cols.includes(c)) this.db.exec(`ALTER TABLE payments ADD COLUMN ${c} ${t}`);
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS payments_open ON payments(state, expiresAt)");
    this.db.exec("CREATE INDEX IF NOT EXISTS payments_route_open ON payments(route, state, expiresAt)");
  }

  private now() {
    return Math.floor(Date.now() / 1000);
  }

  insert(r: NewRow) {
    const t = this.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO payments (requestId,nonce,resourceId,merchant,priceBase,chainId,contract,expiresAt,state,createdAt,updatedAt,route,mount)
           VALUES (@requestId,@nonce,@resourceId,@merchant,@priceBase,@chainId,@contract,@expiresAt,'ISSUED',${t},${t},@route,@mount)`,
        )
        .run({ ...r, route: r.route ?? null, mount: r.mount ?? null });
      this.log(r.requestId, null, "ISSUED", r.resourceId);
    })();
  }

  get(requestId: string): PaymentRow | undefined {
    return this.db.prepare("SELECT * FROM payments WHERE requestId = ?").get(requestId) as PaymentRow | undefined;
  }

  /** Atomic transition; returns false if the row is no longer in one of the allowed source states. */
  transition(requestId: string, from: State[], to: State, fields: Partial<PaymentRow> = {}, detail = ""): boolean {
    return this.db.transaction(() => {
      const row = this.get(requestId);
      if (!row || !from.includes(row.state)) return false;
      const sets = Object.keys(fields).map((k) => `${k} = @${k}`);
      this.db
        .prepare(`UPDATE payments SET state=@__to, updatedAt=@__t ${sets.length ? "," + sets.join(",") : ""} WHERE requestId=@__id`)
        .run({ ...fields, __to: to, __t: this.now(), __id: requestId });
      this.log(requestId, row.state, to, detail);
      return true;
    })();
  }

  /**
   * Takes the delivery lease and returns its fencing token, or null if someone else holds a live lease.
   * Succeeds for a PAID_CONFIRMED row, or for a DELIVERING row whose lease has lapsed (the previous handler run crashed or
   * hung). Exactly one caller wins, even across processes sharing the file. A new claim issues a new token, so a stale
   * holder can no longer complete, renew or release.
   */
  claimDelivery(requestId: string, leaseSeconds: number): string | null {
    return this.db.transaction(() => {
      const row = this.get(requestId);
      if (!row) return null;
      const t = this.now();
      const free = row.state === "PAID_CONFIRMED" || (row.state === "DELIVERING" && (row.leaseUntil ?? 0) < t);
      if (!free) return null;
      const token = randomBytes(16).toString("hex");
      this.db.prepare("UPDATE payments SET state='DELIVERING', leaseUntil=?, leaseToken=?, updatedAt=? WHERE requestId=?").run(t + leaseSeconds, token, t, requestId);
      this.log(requestId, row.state, "DELIVERING", row.state === "DELIVERING" ? "lease_expired_retry" : "claimed");
      return token;
    })();
  }

  /** Extends a lease the caller still holds. Returns false if the lease was lost (taken over after lapsing). */
  renewLease(requestId: string, token: string, leaseSeconds: number): boolean {
    const r = this.db.prepare("UPDATE payments SET leaseUntil=? WHERE requestId=? AND state='DELIVERING' AND leaseToken=?").run(this.now() + leaseSeconds, requestId, token);
    return r.changes === 1;
  }

  /** Persists the response durably, only for the current lease holder. Callers must do this BEFORE sending the response. */
  completeDelivery(requestId: string, token: string, res: StoredResponse): boolean {
    return this.db.transaction(() => {
      const row = this.get(requestId);
      if (!row || row.state !== "DELIVERING" || row.leaseToken !== token) return false;
      return this.transition(requestId, ["DELIVERING"], "DELIVERED", {
        responseBody: res.body.toString("base64"), responseEncoding: "base64", responseStatus: res.status, responseType: res.type,
        responseHeaders: JSON.stringify(res.headers), leaseUntil: null, leaseToken: null, deliveredAt: this.now(),
      }, "handler_ok");
    })();
  }

  releaseDelivery(requestId: string, token: string, why: string): boolean {
    return this.db.transaction(() => {
      const row = this.get(requestId);
      if (!row || row.state !== "DELIVERING" || row.leaseToken !== token) return false;
      return this.transition(requestId, ["DELIVERING"], "PAID_CONFIRMED", { leaseUntil: null, leaseToken: null }, why);
    })();
  }

  /** Decodes a stored response (legacy rows hold utf8 text). */
  storedResponse(row: PaymentRow): StoredResponse {
    const enc = row.responseEncoding ?? "utf8";
    return {
      status: row.responseStatus ?? 200,
      type: row.responseType ?? "application/json",
      body: Buffer.from(row.responseBody ?? "", enc),
      headers: row.responseHeaders ? JSON.parse(row.responseHeaders) : {},
    };
  }


  /** requestIds of rows with no transaction attached: what a chain reconciliation looks for. */
  unpaidIds(): Set<string> {
    return new Set((this.db.prepare("SELECT requestId FROM payments WHERE state IN ('ISSUED','PAID_PENDING','EXPIRED') AND txHash IS NULL").all() as { requestId: string }[]).map((r) => r.requestId));
  }

  getMeta(k: string): string | undefined {
    return (this.db.prepare("SELECT v FROM meta WHERE k=?").get(k) as { v: string } | undefined)?.v;
  }

  setMeta(k: string, v: string) {
    this.db.prepare("INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, v);
  }

  /**
   * Deletes challenges that were never paid, but only when all three hold:
   *  - the payment deadline (expiresAt + paymentGraceSeconds) has passed, so no valid payment can still arrive;
   *  - the chain has been reconciled past that deadline (`reconciledThroughTime`), so no valid payment was missed during an outage;
   *  - the row is older than `retentionSeconds`.
   * Rows with a transaction (paid, rejected-late, delivered) are never deleted.
   */
  purgeUnpaid(opts: { retentionSeconds?: number; paymentGraceSeconds?: number; reconciledThroughTime?: number } = {}): number {
    const retention = opts.retentionSeconds ?? 30 * 86_400;
    const grace = opts.paymentGraceSeconds ?? 60;
    const reconciled = opts.reconciledThroughTime ?? Number(this.getMeta("reconciledThroughTime") ?? 0);
    const r = this.db
      .prepare("DELETE FROM payments WHERE state IN ('ISSUED','PAID_PENDING','EXPIRED') AND txHash IS NULL AND createdAt < ? AND expiresAt + ? < ?")
      .run(this.now() - retention, grace, reconciled);
    return r.changes;
  }

  /**
   * Unpaid challenges for one price route that can still be paid (ISSUED, payment deadline not passed). This is what the
   * issuance guard caps: rows past their deadline cannot be paid any more and do not count.
   */
  countLiveUnpaid(route: string, paymentGraceSeconds: number, nowSeconds = this.now()): number {
    const r = this.db
      .prepare("SELECT COUNT(*) c FROM payments WHERE route = ? AND state = 'ISSUED' AND txHash IS NULL AND expiresAt + ? >= ?")
      .get(route, paymentGraceSeconds, nowSeconds) as { c: number };
    return r.c;
  }

  /**
   * Reaper for challenges nobody presented a proof for: deletes ISSUED rows with no transaction once
   *  - the payment deadline (expiresAt + paymentGraceSeconds) plus `graceSeconds` has passed, and
   *  - the chain has been reconciled past that deadline (`reconciledThroughTime`), so a payment mined in time but never
   *    presented has already been attached by reconcile() and cannot be lost.
   * Unlike purgeUnpaid() there is no retention period. PAID_PENDING rows (a proof was presented) are never reaped.
   */
  reapIssued(opts: { paymentGraceSeconds: number; graceSeconds?: number; reconciledThroughTime?: number; nowSeconds?: number }): number {
    const reconciled = opts.reconciledThroughTime ?? Number(this.getMeta("reconciledThroughTime") ?? 0);
    const t = opts.nowSeconds ?? this.now();
    const r = this.db
      .prepare("DELETE FROM payments WHERE state = 'ISSUED' AND txHash IS NULL AND expiresAt + ? + ? < ? AND expiresAt + ? < ?")
      .run(opts.paymentGraceSeconds, opts.graceSeconds ?? 0, t, opts.paymentGraceSeconds, reconciled);
    return r.changes;
  }

  /** Drops the stored body of a delivered row after its replay window. Later presentations of the proof answer 410. */
  purgeResponse(requestId: string): boolean {
    const r = this.db
      .prepare("UPDATE payments SET responseBody = NULL, responseHeaders = NULL, responsePurgedAt = ? WHERE requestId = ? AND state = 'DELIVERED' AND responsePurgedAt IS NULL")
      .run(this.now(), requestId);
    return r.changes === 1;
  }

  /** Purges every stored response older than the replay window. Returns how many were purged. */
  purgeExpiredResponses(replayWindowSeconds: number, nowSeconds = this.now()): number {
    const r = this.db
      .prepare("UPDATE payments SET responseBody = NULL, responseHeaders = NULL, responsePurgedAt = ? WHERE state = 'DELIVERED' AND responsePurgedAt IS NULL AND COALESCE(deliveredAt, updatedAt) + ? < ?")
      .run(nowSeconds, replayWindowSeconds, nowSeconds);
    return r.changes;
  }

  /**
   * Payments that moved money but were not delivered: rows recorded PAID_LATE (and 0.1.x rows that are REJECTED with a
   * transaction, which can only mean paid too late), plus paid rows still undelivered (PAID_CONFIRMED or DELIVERING)
   * that have not changed for `staleSeconds` (default 1 hour).
   */
  paidUndelivered(opts: { staleSeconds?: number; nowSeconds?: number } = {}): PaidUndelivered[] {
    const cutoff = (opts.nowSeconds ?? this.now()) - (opts.staleSeconds ?? 3600);
    const rows = this.db
      .prepare("SELECT * FROM payments WHERE txHash IS NOT NULL AND (state = 'REJECTED' OR (state IN ('PAID_CONFIRMED','DELIVERING') AND updatedAt < ?)) ORDER BY updatedAt")
      .all(cutoff) as PaymentRow[];
    return rows.map((r) => ({
      requestId: r.requestId, kind: r.state === "REJECTED" ? ("PAID_LATE" as const) : ("PAID_NOT_DELIVERED" as const), state: r.state,
      resourceId: r.resourceId, priceBase: r.priceBase, merchant: r.merchant, txHash: r.txHash!, payer: r.payer, agent: r.agent,
      blockNumber: r.blockNumber, updatedAt: r.updatedAt,
    }));
  }

  log(requestId: string, from: State | null, to: State, detail: string) {
    this.db.prepare("INSERT INTO events (requestId,fromState,toState,detail,at) VALUES (?,?,?,?,?)").run(requestId, from, to, detail, this.now());
    // NFR-005 structured log. Never includes proofs, sigs or response bodies.
    if (process.env.TURNSPIKE_LOG !== "off" && process.env.TURNPIKE_LOG !== "off") console.log(JSON.stringify({ evt: "payment_state", requestId, from, to, detail }));
  }

  /** Counts for the evidence page (DATA-012). Own wallets are listed separately from everyone else. */
  stats(ownAddresses: string[]) {
    const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
    const rows = this.db.prepare("SELECT payer, agent FROM payments WHERE state='DELIVERED'").all() as { payer: string | null; agent: string | null }[];
    const isOwn = (r: { payer: string | null; agent: string | null }) => (!!r.payer && own.has(r.payer.toLowerCase())) || (!!r.agent && own.has(r.agent.toLowerCase()));
    const ext = rows.filter((r) => !isOwn(r)).length;
    const cutoff = this.now() - 86400;
    const stale = this.db.prepare("SELECT COUNT(*) c FROM payments WHERE state IN ('PAID_CONFIRMED','DELIVERING') AND updatedAt < ?").get(cutoff) as { c: number };
    const late = this.db.prepare("SELECT COUNT(*) c FROM payments WHERE state='REJECTED' AND txHash IS NOT NULL").get() as { c: number };
    return { delivered: rows.length, deliveredOwn: rows.length - ext, deliveredExternal: ext, paidUndelivered24h: stale.c + late.c };
  }

  close() {
    this.db.close();
  }
}
