import Database from "better-sqlite3";

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
  responseBody: string | null;
  responseStatus: number | null;
  responseType: string | null;
  createdAt: number;
  updatedAt: number;
}

type NewRow = Pick<PaymentRow, "requestId" | "nonce" | "resourceId" | "merchant" | "priceBase" | "chainId" | "contract" | "expiresAt">;

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
    `);
    const cols = (this.db.prepare("PRAGMA table_info(payments)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("agent")) this.db.exec("ALTER TABLE payments ADD COLUMN agent TEXT");
    if (!cols.includes("leaseUntil")) this.db.exec("ALTER TABLE payments ADD COLUMN leaseUntil INTEGER");
  }

  private now() {
    return Math.floor(Date.now() / 1000);
  }

  insert(r: NewRow) {
    const t = this.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO payments (requestId,nonce,resourceId,merchant,priceBase,chainId,contract,expiresAt,state,createdAt,updatedAt)
           VALUES (@requestId,@nonce,@resourceId,@merchant,@priceBase,@chainId,@contract,@expiresAt,'ISSUED',${t},${t})`,
        )
        .run(r);
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
   * Takes the delivery lease. Succeeds for a PAID_CONFIRMED row, or for a DELIVERING row whose lease has lapsed
   * (the previous handler run crashed or hung). Exactly one caller wins, even across processes sharing the file.
   */
  claimDelivery(requestId: string, leaseSeconds: number): boolean {
    return this.db.transaction(() => {
      const row = this.get(requestId);
      if (!row) return false;
      const t = this.now();
      const free = row.state === "PAID_CONFIRMED" || (row.state === "DELIVERING" && (row.leaseUntil ?? 0) < t);
      if (!free) return false;
      this.db.prepare("UPDATE payments SET state='DELIVERING', leaseUntil=?, updatedAt=? WHERE requestId=?").run(t + leaseSeconds, t, requestId);
      this.log(requestId, row.state, "DELIVERING", row.state === "DELIVERING" ? "lease_expired_retry" : "claimed");
      return true;
    })();
  }

  /** Persists the response durably. Callers must do this BEFORE sending the response to the client. */
  completeDelivery(requestId: string, body: string, status: number, type: string): boolean {
    return this.transition(requestId, ["DELIVERING"], "DELIVERED", { responseBody: body, responseStatus: status, responseType: type, leaseUntil: null }, "handler_ok");
  }

  releaseDelivery(requestId: string, why: string): boolean {
    return this.transition(requestId, ["DELIVERING"], "PAID_CONFIRMED", { leaseUntil: null }, why);
  }

  /** Deletes challenges that were never paid (no transaction attached) and are older than maxAgeSeconds. Paid rows are never deleted. */
  purgeUnpaid(maxAgeSeconds = 86_400): number {
    const r = this.db.prepare("DELETE FROM payments WHERE state IN ('ISSUED','PAID_PENDING','EXPIRED') AND txHash IS NULL AND createdAt < ?").run(this.now() - maxAgeSeconds);
    return r.changes;
  }

  log(requestId: string, from: State | null, to: State, detail: string) {
    this.db.prepare("INSERT INTO events (requestId,fromState,toState,detail,at) VALUES (?,?,?,?,?)").run(requestId, from, to, detail, this.now());
    // NFR-005 structured log
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
